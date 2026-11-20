import type { GitHubAccountScope } from '../../shared/contracts.ts';
import type { AuthConfig, Bindings } from '../auth/config.ts';

export function repositoryScopes(env: Bindings, config: AuthConfig, login: string): GitHubAccountScope[] {
  const scopes: GitHubAccountScope[] = [{ id: config.ownerId, login, kind: 'User', requiredRepositories: [], requiresAll: true }];
  const configured = env.GITHUB_ORGANIZATIONS;
  if (typeof configured !== 'string' || configured.length > 16_384) throw new Error('Invalid repository scope');
  const raw = configured.trim();
  if (!raw) throw new Error('Invalid repository scope');
  const organizations: unknown = JSON.parse(raw);
  if (!Array.isArray(organizations) || organizations.length > 4) throw new Error('Invalid repository scope');
  const ids = new Set([config.ownerId]);
  const logins = new Set([login.toLowerCase()]);
  for (const organization of organizations) {
    if (!organization || typeof organization !== 'object' || Array.isArray(organization) ||
      Object.keys(organization).some(key => !['id', 'login', 'repositories'].includes(key)) ||
      typeof organization.id !== 'string' || !/^[1-9]\d{0,15}$/.test(organization.id) ||
      !Number.isSafeInteger(Number(organization.id)) || ids.has(organization.id) ||
      typeof organization.login !== 'string' || !/^[A-Za-z0-9-]{1,39}$/.test(organization.login) || logins.has(organization.login.toLowerCase()) ||
      !Array.isArray(organization.repositories) || organization.repositories.length < 1 || organization.repositories.length > 50 ||
      organization.repositories.some((name: unknown) => typeof name !== 'string' || !/^[A-Za-z0-9_.-]{1,100}$/.test(name))) throw new Error('Invalid repository scope');
    const requiredRepositories = organization.repositories as string[];
    if (new Set(requiredRepositories.map(name => name.toLowerCase())).size !== requiredRepositories.length) throw new Error('Invalid repository scope');
    ids.add(organization.id);
    logins.add(organization.login.toLowerCase());
    scopes.push({ id: organization.id, login: organization.login, kind: 'Organization', requiredRepositories, requiresAll: false });
  }
  return scopes;
}
