import type { DiscoveryFailure, RepositoryDiscovery } from '../../shared/contracts.ts';
import type { AuthConfig, Bindings } from '../auth/config.ts';
import type { Fetcher } from '../auth/github.ts';
import { appJwt } from './jwt.ts';

export class DiscoveryError extends Error {
  readonly reason: DiscoveryFailure;
  constructor(reason: DiscoveryFailure) {
    super('Repository discovery failed');
    this.name = 'DiscoveryError';
    this.reason = reason;
  }
}

const PAGE_SIZE = 100;
const MAX_PAGES = 20;
const MAX_BODY_BYTES = 2_097_152;

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function id(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function readPermissions(value: unknown): boolean {
  return record(value) && value.actions === 'read' && value.metadata === 'read' &&
    Object.keys(value).every(key => key === 'actions' || key === 'metadata');
}

async function json(response: Response): Promise<Record<string, unknown>> {
  if (!response.body) throw new DiscoveryError('unavailable');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let body = '';
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_BODY_BYTES) { await reader.cancel(); throw new DiscoveryError('incomplete'); }
      body += decoder.decode(next.value, { stream: true });
    }
    body += decoder.decode();
  } finally { reader.releaseLock(); }
  const result: unknown = JSON.parse(body);
  if (!record(result)) throw new DiscoveryError('unavailable');
  return result;
}

// This returns an inventory of this personal-account installation, never a
// statement about all repositories a user might access through other accounts.
export async function discoverRepositories(env: Bindings, config: AuthConfig, login: string, options: {
  fetcher?: Fetcher; now?: number;
} = {}): Promise<RepositoryDiscovery> {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now();
  let jwt: string;
  try { jwt = await appJwt(config.clientId, env.GITHUB_APP_PRIVATE_KEY ?? '', now); }
  catch { throw new DiscoveryError('setup'); }

  // The paths below are generated here. Provider-supplied links are never used
  // as request destinations, so JWTs/tokens cannot escape api.github.com.
  async function request(path: string, token: string, options: {
    body?: object; missing?: DiscoveryFailure;
  } = {}) {
    const response = await fetcher(`https://api.github.com${path}`, {
      method: options.body ? 'POST' : 'GET', redirect: 'manual', signal: AbortSignal.timeout(10_000),
      headers: {
        Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`,
        'User-Agent': 'GitHub-Nanny', 'X-GitHub-Api-Version': '2026-03-10',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401) throw new DiscoveryError('authentication');
      if (response.status === 429 || (response.status === 403 && response.headers.get('X-RateLimit-Remaining') === '0')) throw new DiscoveryError('rate_limited');
      if (response.status === 403 || response.status === 422) throw new DiscoveryError('permissions');
      if (response.status === 404 && options.missing) throw new DiscoveryError(options.missing);
      throw new DiscoveryError('unavailable');
    }
    return { data: await json(response), link: response.headers.get('Link') };
  }

  try {
    if (!/^[A-Za-z0-9-]{1,39}$/.test(login)) throw new DiscoveryError('unavailable');
    const { data: installation } = await request(`/users/${encodeURIComponent(login)}/installation`, jwt, { missing: 'not_installed' });
    if (!id(installation.id) || !record(installation.account) || !id(installation.account.id) ||
      String(installation.account.id) !== config.ownerId || installation.account.type !== 'User' ||
      (installation.client_id !== undefined && installation.client_id !== config.clientId) ||
      (config.appSlug && installation.app_slug !== config.appSlug)) throw new DiscoveryError('authentication');
    if (installation.suspended_at !== null || !readPermissions(installation.permissions)) throw new DiscoveryError('permissions');
    const selection = installation.repository_selection;
    if (selection !== 'all' && selection !== 'selected') throw new DiscoveryError('incomplete');

    const { data: access } = await request(`/app/installations/${installation.id}/access_tokens`, jwt, {
      body: { permissions: { actions: 'read', metadata: 'read' } },
    });
    if (typeof access.token !== 'string' || !access.token.length || access.token.length > 4096 ||
      typeof access.expires_at !== 'string' || !Number.isFinite(Date.parse(access.expires_at)) ||
      Date.parse(access.expires_at) <= now + 30_000 || !readPermissions(access.permissions) ||
      access.repository_selection !== selection) throw new DiscoveryError('authentication');

    const seen = new Set<number>();
    const repositories: RepositoryDiscovery['repositories'] = [];
    let total: number | null = null;
    let privateRepositoryCount = 0;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const { data, link } = await request(`/installation/repositories?per_page=${PAGE_SIZE}&page=${page}`, access.token);
      if (typeof data.total_count !== 'number' || !Number.isSafeInteger(data.total_count) || data.total_count < 0 ||
        data.total_count > MAX_PAGES * PAGE_SIZE || (total !== null && total !== data.total_count) ||
        !Array.isArray(data.repositories) || data.repositories.length > PAGE_SIZE) throw new DiscoveryError('incomplete');
      total = data.total_count;
      for (const repository of data.repositories) {
        if (!record(repository) || !id(repository.id) || seen.has(repository.id) ||
          typeof repository.name !== 'string' || !/^[A-Za-z0-9_.-]{1,100}$/.test(repository.name) ||
          typeof repository.private !== 'boolean' || !record(repository.owner) ||
          !id(repository.owner.id) || String(repository.owner.id) !== config.ownerId || typeof repository.owner.login !== 'string' ||
          !/^[A-Za-z0-9-]{1,39}$/.test(repository.owner.login)) throw new DiscoveryError('incomplete');
        seen.add(repository.id);
        if (repository.private) privateRepositoryCount++;
        else repositories.push({ id: repository.id, name: `${repository.owner.login}/${repository.name}`, url: `https://github.com/${repository.owner.login}/${repository.name}` });
      }
      if (seen.size > total) throw new DiscoveryError('incomplete');
      if (seen.size === total) {
        if (link && /rel\s*=\s*"?next\b/i.test(link)) throw new DiscoveryError('incomplete');
        return {
          checkedAt: new Date(now).toISOString(), owner: login, installationId: installation.id,
          selection, repositoryCount: total, privateRepositoryCount,
          repositories: repositories.sort((a, b) => a.name.localeCompare(b.name)),
        };
      }
      if (data.repositories.length < PAGE_SIZE) throw new DiscoveryError('incomplete');
    }
    throw new DiscoveryError('incomplete');
  } catch (error) {
    if (error instanceof DiscoveryError) throw error;
    throw new DiscoveryError('unavailable');
  }
}
