import type { GitHubAccountScope, RepositoryAccessReport, SavedMonitoringScope } from '../../shared/contracts.ts';
import type { AuthConfig, Bindings } from '../auth/config.ts';
import { repositoryScopes } from './scopes.ts';
import { resetMonitorScope } from '../monitor-store.ts';
import { WEBHOOK_RETENTION_MS } from './webhook-store.ts';

interface ScopeDocument {
  accounts: { id: string; login: string; kind: GitHubAccountScope['kind']; installationId: number; selection: 'all' | 'selected' }[];
  repositories: SavedMonitoringScope['repositories'];
}
interface ScopeRow { revision: number; config_key: string | null; verified_at: string | null; scope_json: string | null; }

function validRepository(repository: SavedMonitoringScope['repositories'][number], account: ScopeDocument['accounts'][number]): boolean {
  return Number.isSafeInteger(repository.id) && repository.id > 0 &&
    typeof repository.name === 'string' && new RegExp(`^${account.login}/[A-Za-z0-9_.-]{1,100}$`, 'i').test(repository.name) &&
    repository.url === `https://github.com/${repository.name}` &&
    repository.accountId === account.id && repository.installationId === account.installationId;
}

function readDocument(raw: string, key: string): ScopeDocument {
  const value = JSON.parse(raw) as ScopeDocument;
  const expected: GitHubAccountScope[] = JSON.parse(key).accounts;
  if (!value || !Array.isArray(value.accounts) || value.accounts.length !== expected.length ||
    !Array.isArray(value.repositories) || !value.repositories.length || value.repositories.length > 200 ||
    value.accounts.some((account, i) => !account || account.id !== expected[i].id || account.login !== expected[i].login ||
      account.kind !== expected[i].kind || !Number.isSafeInteger(account.installationId) || account.installationId <= 0 ||
      !['all', 'selected'].includes(account.selection) || (expected[i].requiresAll && account.selection !== 'all'))) throw new Error('Invalid saved scope');
  const ids = new Set<number>();
  for (const repository of value.repositories) {
    const account = repository && value.accounts.find(account => account.id === repository.accountId);
    if (!account || !validRepository(repository, account) || ids.has(repository.id)) throw new Error('Invalid saved scope');
    ids.add(repository.id);
  }
  for (const account of expected) for (const name of account.requiredRepositories) {
    if (!value.repositories.some(repository => repository.accountId === account.id &&
      repository.name.toLowerCase() === `${account.login}/${name}`.toLowerCase())) throw new Error('Invalid saved scope');
  }
  return value;
}

export class ScopeError extends Error {
  readonly reason: 'incomplete' | 'conflict';
  constructor(reason: 'incomplete' | 'conflict') { super('Monitoring scope unavailable'); this.reason = reason; }
}

// Include every server-side coverage requirement. A changed App, owner, or
// organization allowlist must not reuse a previously verified scope.
export function scopeKey(env: Bindings, config: AuthConfig, login: string): string {
  return JSON.stringify({ policy: 'public-only', clientId: config.clientId, appSlug: config.appSlug,
    accounts: repositoryScopes(env, config, login) });
}

function document(report: RepositoryAccessReport, key: string): ScopeDocument {
  const expected: GitHubAccountScope[] = JSON.parse(key).accounts;
  if (!report.complete || report.accounts.length !== expected.length ||
    !Number.isFinite(Date.parse(report.checkedAt))) throw new ScopeError('incomplete');
  const accounts: ScopeDocument['accounts'] = [];
  const repositories: ScopeDocument['repositories'] = [];
  const ids = new Set<number>();
  for (let i = 0; i < expected.length; i++) {
    const check = report.accounts[i];
    const inventory = check.inventory;
    if (JSON.stringify(check.account) !== JSON.stringify(expected[i]) || !check.complete || check.reason ||
      check.missingRepositories.length || !inventory || inventory.checkedAt !== report.checkedAt ||
      inventory.repositoryCount !== inventory.repositories.length + inventory.privateRepositoryCount ||
      (expected[i].requiresAll && inventory.selection !== 'all') ||
      !Number.isSafeInteger(inventory.installationId) || inventory.installationId <= 0) throw new ScopeError('incomplete');
    accounts.push({ id: check.account.id, login: check.account.login, kind: check.account.kind,
      installationId: inventory.installationId, selection: inventory.selection });
    // Discovery has already excluded private repositories. Persist only these
    // explicit public records, never the raw provider inventory or tokens.
    for (const repository of inventory.repositories) {
      const saved = { id: repository.id, name: repository.name, url: repository.url,
        accountId: check.account.id, installationId: inventory.installationId };
      if (ids.has(repository.id) || !validRepository(saved, accounts[i])) throw new ScopeError('incomplete');
      ids.add(repository.id);
      repositories.push(saved);
    }
  }
  // Bound the single D1 document well below the row limit. No truncated scope
  // is saved if installations grow beyond the supported first-release size.
  if (!repositories.length || repositories.length > 200) throw new ScopeError('incomplete');
  return { accounts, repositories: repositories.sort((a, b) => a.name.localeCompare(b.name)) };
}

export function verifiedScopeRepositories(report: RepositoryAccessReport, key: string): SavedMonitoringScope['repositories'] {
  return document(report, key).repositories;
}

export class MonitoringScopeStore {
  private readonly database: Cloudflare.Env['DB'];
  constructor(database: Cloudflare.Env['DB']) { this.database = database; }

  async read(key: string): Promise<SavedMonitoringScope> {
    const row = await this.database.withSession('first-primary')
      .prepare('SELECT revision, config_key, verified_at, scope_json FROM monitoring_scope WHERE singleton = 1').first<ScopeRow>();
    if (!row || !Number.isSafeInteger(row.revision) || row.revision < 0) throw new Error('Monitoring storage unavailable');
    const prepared = row.config_key === key && row.scope_json !== null;
    if (prepared && (!row.verified_at || !Number.isFinite(Date.parse(row.verified_at)))) throw new Error('Invalid saved scope');
    return { revision: row.revision, prepared, policy: 'public-only', verifiedAt: prepared ? row.verified_at : null,
      repositories: prepared ? readDocument(row.scope_json!, key).repositories : [] };
  }

  // Server callbacks have no browser session/login. Recover the saved owner
  // login only to recompute the FULL current configuration key, then use the
  // same scope validator as owner requests. Payloads cannot choose this login.
  async configured(env: Bindings, config: AuthConfig): Promise<{ key: string; scope: SavedMonitoringScope; accounts: ScopeDocument['accounts'] } | null> {
    const row = await this.database.withSession('first-primary')
      .prepare('SELECT revision, config_key, verified_at, scope_json FROM monitoring_scope WHERE singleton = 1').first<ScopeRow>();
    if (!row) throw new Error('Monitoring storage unavailable');
    if (!row.config_key) return null;
    const saved: unknown = JSON.parse(row.config_key);
    const login = saved && typeof saved === 'object' && 'accounts' in saved && Array.isArray(saved.accounts)
      ? saved.accounts[0]?.login : null;
    if (typeof login !== 'string' || !/^[A-Za-z0-9-]{1,39}$/.test(login)) throw new Error('Invalid saved scope');
    const key = scopeKey(env, config, login);
    if (key !== row.config_key) return null;
    const scope = await this.read(key);
    return scope.prepared && scope.revision === row.revision && row.scope_json
      ? { key, scope, accounts: readDocument(row.scope_json, key).accounts } : null;
  }

  async invalidate(key: string, revision: number, delivery: string, now: number): Promise<void> {
    const database = this.database.withSession('first-primary');
    const marker = crypto.randomUUID();
    const result = await database.batch([
      database.prepare(`INSERT INTO webhook_deliveries (delivery_id, scope_revision, received_at, commit_key)
        SELECT ?, 0, ?, ? FROM monitoring_scope WHERE singleton = 1 AND revision = ? AND config_key = ? AND scope_json IS NOT NULL
        ON CONFLICT(delivery_id) DO NOTHING`).bind(delivery, now, marker, revision, key),
      database.prepare(`UPDATE monitoring_scope SET revision = revision + 1,
        config_key = NULL, verified_at = NULL, scope_json = NULL WHERE singleton = 1 AND revision = ? AND config_key = ?
        AND EXISTS (SELECT 1 FROM webhook_deliveries WHERE delivery_id = ? AND commit_key = ?)`)
        .bind(revision, key, delivery, marker), ...resetMonitorScope(database),
      database.prepare(`DELETE FROM webhook_deliveries WHERE delivery_id IN
        (SELECT delivery_id FROM webhook_deliveries WHERE received_at < ? LIMIT 50)`)
        .bind(now - WEBHOOK_RETENTION_MS),
    ]);
    if (result.some(statement => !statement.success)) throw new Error('Monitoring storage unavailable');
  }

  async save(key: string, expectedRevision: number, report: RepositoryAccessReport): Promise<SavedMonitoringScope> {
    const scope = document(report, key);
    const database = this.database.withSession('first-primary');
    const result = await database.batch([database.prepare(
      'UPDATE monitoring_scope SET revision = revision + 1, config_key = ?, verified_at = ?, scope_json = ? WHERE singleton = 1 AND revision = ? RETURNING revision',
    ).bind(key, report.checkedAt, JSON.stringify(scope), expectedRevision), ...resetMonitorScope(database)]);
    // A disconnect or a newer save won while discovery was running. Never
    // silently reconnect or overwrite it with the older in-flight result.
    if (result.some(statement => !statement.success)) throw new Error('Monitoring storage unavailable');
    const row = result[0].results[0] as { revision: number } | undefined;
    if (!row) throw new ScopeError('conflict');
    return { revision: row.revision, prepared: true, policy: 'public-only', verifiedAt: report.checkedAt,
      repositories: scope.repositories };
  }

  async disconnect(): Promise<SavedMonitoringScope> {
    const database = this.database.withSession('first-primary');
    const result = await database.batch([database.prepare(
      'UPDATE monitoring_scope SET revision = revision + 1, config_key = NULL, verified_at = NULL, scope_json = NULL WHERE singleton = 1 RETURNING revision',
    ), ...resetMonitorScope(database)]);
    if (result.some(statement => !statement.success)) throw new Error('Monitoring storage unavailable');
    const row = result[0].results[0] as { revision: number } | undefined;
    if (!row) throw new Error('Monitoring storage unavailable');
    return { revision: row.revision, prepared: false, policy: 'public-only', verifiedAt: null, repositories: [] };
  }
}
