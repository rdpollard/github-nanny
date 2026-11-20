import type { ActionsCheck, ActionsCheckFailure, SavedMonitoringScope } from '../../shared/contracts.ts';
import type { AuthConfig, Bindings } from '../auth/config.ts';
import type { Fetcher } from '../auth/github.ts';
import { DiscoveryError, githubRequest, type GitHubBudget } from './client.ts';
import { checkRepositoryAccess } from './discovery.ts';
import { MonitoringScopeStore, ScopeError, scopeKey, verifiedScopeRepositories } from './scope-store.ts';
import { MonitorStore, MonitorConflict } from '../monitor-store.ts';

export const UNFINISHED_STATUSES = ['queued', 'in_progress', 'requested', 'waiting', 'pending'] as const;
type Repository = SavedMonitoringScope['repositories'][number];
type Run = ActionsCheck['runs'][number];

export class ActionsCheckError extends Error {
  readonly reason: ActionsCheckFailure;
  constructor(reason: ActionsCheckFailure) { super('Actions check unavailable'); this.reason = reason; }
}
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function positive(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0; }
function sameRepositories(a: Repository[], b: Repository[]): boolean {
  return a.length === b.length && a.every(repo => b.some(other => repo.id === other.id && repo.name === other.name &&
    repo.accountId === other.accountId && repo.installationId === other.installationId && repo.url === other.url));
}
function publicRepository(value: unknown, repo: Repository): boolean {
  return object(value) && value.id === repo.id && value.private === false && value.full_name === repo.name &&
    object(value.owner) && String(value.owner.id) === repo.accountId;
}
function run(value: unknown, repo: Repository, status: Run['status']): Run {
  if (!object(value) || !positive(value.id) || !positive(value.run_attempt) || !positive(value.workflow_id) ||
    value.status !== status || value.conclusion !== null || !publicRepository(value.repository, repo) ||
    !(value.name === null || (typeof value.name === 'string' && value.name.length <= 512)) ||
    !(value.head_branch === null || (typeof value.head_branch === 'string' && value.head_branch.length <= 1024)) ||
    typeof value.created_at !== 'string' || !Number.isFinite(Date.parse(value.created_at)) ||
    !(value.run_started_at == null || (typeof value.run_started_at === 'string' && Number.isFinite(Date.parse(value.run_started_at))))) {
    throw new ActionsCheckError('incomplete');
  }
  return { id: value.id, attempt: value.run_attempt, repository: repo.name,
    workflow: value.name || `Workflow ${value.workflow_id}`, branch: value.head_branch ?? '(no branch)', status,
    url: `https://github.com/${repo.name}/actions/runs/${value.id}/attempts/${value.run_attempt}`,
    startedAt: value.run_started_at ?? value.created_at };
}

async function repositoryRuns(repo: Repository, token: string, fetcher: Fetcher, budget: GitHubBudget): Promise<Run[]> {
  const path = `/repos/${repo.name.split('/').map(encodeURIComponent).join('/')}`;
  const metadata = await githubRequest(path, token, fetcher, budget);
  if (!publicRepository(metadata.data, repo)) throw new ActionsCheckError('scope_changed');
  const runs: Run[] = [];
  const seen = new Set<number>();
  for (const status of UNFINISHED_STATUSES) {
    let total: number | null = null;
    let count = 0;
    for (let page = 1; page <= 10; page++) {
      const { data, link } = await githubRequest(`${path}/actions/runs?status=${status}&per_page=100&page=${page}`, token, fetcher, budget);
      if (typeof data.total_count !== 'number' || !Number.isSafeInteger(data.total_count) || data.total_count < 0 ||
        data.total_count >= 1000 || (total !== null && total !== data.total_count) ||
        !Array.isArray(data.workflow_runs) || data.workflow_runs.length > 100) throw new ActionsCheckError('incomplete');
      total = data.total_count;
      for (const value of data.workflow_runs) {
        const active = run(value, repo, status);
        // Duplicates across pages/statuses, including attempts changing during
        // a scan, indicate an unstable snapshot. Never choose one silently.
        if (seen.has(active.id)) throw new ActionsCheckError('incomplete');
        seen.add(active.id);
        runs.push(active);
      }
      count += data.workflow_runs.length;
      if (count > total) throw new ActionsCheckError('incomplete');
      if (count === total) {
        if (link && /rel\s*=\s*"?next\b/i.test(link)) throw new ActionsCheckError('incomplete');
        break;
      }
      if (data.workflow_runs.length < 100) throw new ActionsCheckError('incomplete');
    }
  }
  return runs;
}

// An owner-triggered observation, not an idle decision or a monitoring loop.
// Installation tokens remain inside this request and never enter a report.
export async function checkActions(env: Bindings, config: AuthConfig, login: string, options: {
  fetcher?: Fetcher; now?: number;
} = {}): Promise<ActionsCheck> {
  if (!env.DB) throw new ActionsCheckError('unavailable');
  const fetcher = options.fetcher ?? fetch;
  const store = new MonitoringScopeStore(env.DB);
  const key = scopeKey(env, config, login);
  const saved = await store.read(key);
  if (!saved.prepared) throw new ActionsCheckError('not_prepared');
  const monitor = new MonitorStore(env.DB);
  const token = await monitor.begin(key, saved).catch(error => {
    if (error instanceof MonitorConflict) throw new ActionsCheckError('conflict');
    throw error;
  });
  const startedAt = new Date().toISOString();
  const budget: GitHubBudget = { remaining: 40, deadlineAt: Date.now() + 25_000 };
  const tokens = new Map<number, string>();
  try {
    const report = await checkRepositoryAccess(env, config, login, { ...options, budget,
      onVerified: (inventory, token) => { tokens.set(inventory.installationId, token); } });
    if (!report.complete) throw new ActionsCheckError(report.accounts.some(account => account.reason === 'rate_limited') ? 'rate_limited' : 'scope_changed');
    const verified = verifiedScopeRepositories(report, key);
    if (!sameRepositories(saved.repositories, verified)) throw new ActionsCheckError('scope_changed');
    const runs: Run[] = [];
    for (const repo of verified) {
      const token = tokens.get(repo.installationId);
      if (!token) throw new ActionsCheckError('unavailable');
      runs.push(...await repositoryRuns(repo, token, fetcher, budget));
    }
    if (new Set(runs.map(run => run.id)).size !== runs.length) throw new ActionsCheckError('incomplete');
    // Recheck visibility/identity before returning even an empty scan. A known
    // access change during the requests invalidates the entire observation.
    for (const repo of verified) {
      const { data } = await githubRequest(`/repos/${repo.name.split('/').map(encodeURIComponent).join('/')}`, tokens.get(repo.installationId)!, fetcher, budget);
      if (!publicRepository(data, repo)) throw new ActionsCheckError('scope_changed');
    }
    const current = await store.read(key);
    if (!current.prepared || current.revision !== saved.revision) throw new ActionsCheckError('conflict');
    const observation = { scopeRevision: saved.revision, startedAt, checkedAt: new Date().toISOString(),
      repositoryCount: verified.length, runs: runs.sort((a, b) => a.repository.localeCompare(b.repository) || a.id - b.id) };
    await monitor.complete(token, observation);
    return observation;
  } catch (error) {
    try { await monitor.fail(token); } catch (failure) {
      if (!(failure instanceof MonitorConflict)) throw new ActionsCheckError('unavailable');
    }
    if (error instanceof MonitorConflict) throw new ActionsCheckError('conflict');
    if (error instanceof ActionsCheckError) throw error;
    if (error instanceof ScopeError) throw new ActionsCheckError('scope_changed');
    if (error instanceof DiscoveryError) throw new ActionsCheckError(error.reason === 'rate_limited' ? 'rate_limited' : error.reason === 'incomplete' ? 'incomplete' : 'unavailable');
    throw new ActionsCheckError('unavailable');
  }
}
