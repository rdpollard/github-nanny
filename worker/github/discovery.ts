import type { DiscoveryFailure, GitHubAccountScope, RepositoryAccessReport, RepositoryAccountCheck, RepositoryDiscovery } from '../../shared/contracts.ts';
import type { AuthConfig, Bindings } from '../auth/config.ts';
import type { Fetcher } from '../auth/github.ts';
import { appJwt } from './jwt.ts';
import { repositoryScopes } from './scopes.ts';
import { DiscoveryError, githubRequest, type GitHubBudget } from './client.ts';
export { DiscoveryError } from './client.ts';

const PAGE_SIZE = 100;
const MAX_PAGES = 20;

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

// Every account must be chosen by server configuration and checked by immutable
// ID. A public App installation elsewhere does not expand the configured scope.
interface DiscoveryOptions {
  fetcher?: Fetcher; now?: number; account?: GitHubAccountScope; budget?: GitHubBudget;
  onVerified?: (inventory: RepositoryDiscovery, token: string) => void;
}
export async function discoverRepositories(env: Bindings, config: AuthConfig, login: string,
  options: DiscoveryOptions = {}): Promise<RepositoryDiscovery> {
  const now = options.now ?? Date.now();
  return discoverWithJwt(env, config, login, { ...options, now }, () => appJwt(config.clientId, env.GITHUB_APP_PRIVATE_KEY ?? '', now));
}

// Only this module can supply the lazy App identity. A complete access check
// shares it across accounts; installation tokens still remain account-specific.
async function discoverWithJwt(env: Bindings, config: AuthConfig, login: string,
  options: DiscoveryOptions, appToken: () => Promise<string>): Promise<RepositoryDiscovery> {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now();
  const account = options.account ?? { id: config.ownerId, login, kind: 'User' };
  let jwt: string;
  try { jwt = await appToken(); }
  catch { throw new DiscoveryError('setup'); }

  const budget = options.budget ?? { remaining: 22 };
  const request = (path: string, token: string, settings: { body?: object; missing?: DiscoveryFailure } = {}) =>
    githubRequest(path, token, fetcher, budget, settings);

  try {
    if (!/^[A-Za-z0-9-]{1,39}$/.test(login)) throw new DiscoveryError('unavailable');
    const { data: installation } = await request(`/${account.kind === 'Organization' ? 'orgs' : 'users'}/${encodeURIComponent(login)}/installation`, jwt, { missing: 'not_installed' });
    if (!id(installation.id) || !record(installation.account) || !id(installation.account.id) ||
      String(installation.account.id) !== account.id || installation.account.type !== account.kind ||
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
          !id(repository.owner.id) || String(repository.owner.id) !== account.id || typeof repository.owner.login !== 'string' ||
          !/^[A-Za-z0-9-]{1,39}$/.test(repository.owner.login)) throw new DiscoveryError('incomplete');
        seen.add(repository.id);
        if (repository.private) privateRepositoryCount++;
        else repositories.push({ id: repository.id, name: `${repository.owner.login}/${repository.name}`, url: `https://github.com/${repository.owner.login}/${repository.name}` });
      }
      if (seen.size > total) throw new DiscoveryError('incomplete');
      if (seen.size === total) {
        if (link && /rel\s*=\s*"?next\b/i.test(link)) throw new DiscoveryError('incomplete');
        const inventory: RepositoryDiscovery = {
          checkedAt: new Date(now).toISOString(), owner: login, installationId: installation.id,
          selection, repositoryCount: total, privateRepositoryCount,
          repositories: repositories.sort((a, b) => a.name.localeCompare(b.name)),
        };
        options.onVerified?.(inventory, access.token);
        return inventory;
      }
      if (data.repositories.length < PAGE_SIZE) throw new DiscoveryError('incomplete');
    }
    throw new DiscoveryError('incomplete');
  } catch (error) {
    if (error instanceof DiscoveryError) throw error;
    throw new DiscoveryError('unavailable');
  }
}

export async function checkRepositoryAccess(env: Bindings, config: AuthConfig, login: string, options: {
  fetcher?: Fetcher; now?: number; budget?: GitHubBudget;
  onVerified?: (inventory: RepositoryDiscovery, token: string) => void;
} = {}): Promise<RepositoryAccessReport> {
  // One verification generation shares its timestamp across every account and
  // the aggregate report, including when no test clock is supplied.
  options = { ...options, now: options.now ?? Date.now() };
  let scopes: GitHubAccountScope[];
  try { scopes = repositoryScopes(env, config, login); }
  catch { throw new DiscoveryError('configuration'); }
  const budget = options.budget ?? { remaining: 40 };
  const accounts: RepositoryAccountCheck[] = [];
  const repositoryIds = new Set<number>();
  // Request-local only: no process/global key or bearer-token cache survives a
  // scan, owner change or key rotation. Authentication failures retain behavior.
  let jwt: Promise<string> | undefined;
  const appToken = () => jwt ??= appJwt(config.clientId, env.GITHUB_APP_PRIVATE_KEY ?? '', options.now!);
  for (const account of scopes) {
    try {
      const inventory = await discoverWithJwt(env, config, account.login, { ...options, account, budget }, appToken);
      if (inventory.repositories.some(repository => repositoryIds.has(repository.id))) throw new DiscoveryError('incomplete');
      for (const repository of inventory.repositories) repositoryIds.add(repository.id);
      // Names come from the server's explicit requirements, never from a caller
      // query. A required private repository is deliberately not publishable.
      const names = new Set(inventory.repositories.map(repository => repository.name.split('/')[1].toLowerCase()));
      const missingRepositories = account.requiredRepositories.filter(name => !names.has(name.toLowerCase()));
      accounts.push({ account, inventory, reason: null, missingRepositories,
        complete: missingRepositories.length === 0 && (!account.requiresAll || inventory.selection === 'all') });
    } catch (error) {
      const reason = error instanceof DiscoveryError ? error.reason : 'unavailable';
      if (reason === 'setup') throw new DiscoveryError(reason);
      accounts.push({ account, inventory: null, reason, missingRepositories: account.requiredRepositories, complete: false });
    }
  }
  const inventories = accounts.flatMap(account => account.inventory ? [account.inventory] : []);
  return {
    checkedAt: new Date(options.now ?? Date.now()).toISOString(), complete: accounts.every(account => account.complete), accounts,
    repositoryCount: inventories.reduce((count, inventory) => count + inventory.repositoryCount, 0),
    privateRepositoryCount: inventories.reduce((count, inventory) => count + inventory.privateRepositoryCount, 0),
    repositories: inventories.flatMap(inventory => inventory.repositories).sort((a, b) => a.name.localeCompare(b.name)),
  };
}
