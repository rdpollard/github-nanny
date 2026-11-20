import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authConfig, type Bindings } from '../worker/auth/config.ts';
import { checkRepositoryAccess, DiscoveryError } from '../worker/github/discovery.ts';
import { repositoryScopes } from '../worker/github/scopes.ts';
import type { Fetcher } from '../worker/auth/github.ts';
import { rsaFixture } from './helpers/keys.ts';

const keys = await rsaFixture();
const now = Date.UTC(2026, 10, 19, 12);
const requiredName = 'Tactics-Strategy-Dev-Environments';
const organization = { id: '5925283', login: 'stormbots', repositories: [requiredName] };
const env: Bindings = {
  APP_ORIGIN: 'https://nanny.example', GITHUB_OWNER_ID: '27035363', GITHUB_CLIENT_ID: 'Iv1_test_client',
  GITHUB_CLIENT_SECRET: 'test-client-secret-only-for-fixtures', SESSION_SECRET: 'A'.repeat(43),
  GITHUB_APP_SLUG: 'github-nanny-test', GITHUB_APP_PRIVATE_KEY: keys.pkcs1,
  GITHUB_ORGANIZATIONS: JSON.stringify([organization]),
};
const config = authConfig(env)!;
const permissions = { actions: 'read', metadata: 'read' };

function provider(options: { missing?: boolean; wrongOwner?: boolean; missingRequired?: boolean; privateRequired?: boolean; large?: boolean; personalSelected?: boolean } = {}) {
  const calls: string[] = [];
  const fetcher: Fetcher = async (input, init) => {
    const url = new URL(String(input));
    calls.push(url.href);
    assert.equal(url.origin, 'https://api.github.com');
    assert.equal(init?.redirect, 'manual');
    if (url.pathname === '/users/rdpollard/installation' || url.pathname === '/orgs/stormbots/installation') {
      const org = url.pathname.startsWith('/orgs/');
      if (org && options.missing) return Response.json({}, { status: 404 });
      return Response.json({
        id: org ? 8 : 7,
        account: { id: org ? options.wrongOwner ? 9 : 5925283 : 27035363, type: org ? 'Organization' : 'User' },
        permissions, suspended_at: null, client_id: env.GITHUB_CLIENT_ID, app_slug: env.GITHUB_APP_SLUG,
        repository_selection: org || options.personalSelected ? 'selected' : 'all',
      });
    }
    if (url.pathname === '/app/installations/7/access_tokens' || url.pathname === '/app/installations/8/access_tokens') {
      const org = url.pathname.includes('/8/');
      assert.deepEqual(JSON.parse(String(init?.body)), { permissions });
      return Response.json({ token: org ? 'test-org-token' : 'test-personal-token', expires_at: new Date(now + 3_600_000).toISOString(), permissions,
        repository_selection: org || options.personalSelected ? 'selected' : 'all' }, { status: 201 });
    }
    assert.equal(url.pathname, '/installation/repositories');
    const org = new Headers(init?.headers).get('Authorization') === 'Bearer test-org-token';
    const page = Number(url.searchParams.get('page'));
    const total = options.large ? 2000 : 1;
    const repositories = Array.from({ length: Math.min(100, total - (page - 1) * 100) }, (_, index) => ({
      id: (org ? 10_000 : 0) + (page - 1) * 100 + index + 1,
      name: org && page === 1 && index === 0 && !options.missingRequired ? requiredName : `repo-${page}-${index}`,
      private: !!(org && options.privateRequired),
      owner: { id: org ? 5925283 : 27035363, login: org ? 'stormbots' : 'rdpollard' },
    }));
    return Response.json({ total_count: total, repositories });
  };
  return { calls, fetcher };
}

test('an explicitly required organization repository can be verified alongside the personal installation', async () => {
  const upstream = provider();
  const report = await checkRepositoryAccess(env, config, 'rdpollard', { now, fetcher: upstream.fetcher });
  assert.equal(report.complete, true);
  assert.equal(report.repositoryCount, 2);
  assert.equal(report.accounts.length, 2);
  assert.equal(report.accounts[1].inventory?.selection, 'selected');
  assert.deepEqual(report.accounts[1].missingRepositories, []);
  assert.ok(report.repositories.some(repository => repository.name === `stormbots/${requiredName}`));
  assert.equal(upstream.calls.length, 6);
  assert.ok(!upstream.calls.some(url => url.includes('/actions/') || url.includes('/app/installations?')));
});

test('a missing organization installation remains an explicit gap even when all personal repositories are visible', async () => {
  const upstream = provider({ missing: true });
  const report = await checkRepositoryAccess(env, config, 'rdpollard', { now, fetcher: upstream.fetcher });
  assert.equal(report.complete, false);
  assert.equal(report.accounts[0].complete, true);
  assert.equal(report.accounts[1].reason, 'not_installed');
  assert.equal(report.accounts[1].inventory, null);
  assert.deepEqual(report.accounts[1].missingRepositories, [requiredName]);
  assert.equal(report.repositoryCount, 1);
  assert.equal(upstream.calls.length, 4);
});

test('missing or now-private required repositories and selected personal coverage cannot report complete access', async () => {
  for (const options of [{ missingRequired: true }, { privateRequired: true }, { personalSelected: true }]) {
    const report = await checkRepositoryAccess(env, config, 'rdpollard', { now, fetcher: provider(options).fetcher });
    assert.equal(report.complete, false);
    if ('personalSelected' in options) assert.equal(report.accounts[0].complete, false);
    else assert.deepEqual(report.accounts[1].missingRepositories, [requiredName]);
    if ('privateRequired' in options) assert.ok(!report.repositories.some(repository => repository.name.includes(requiredName)));
  }
});

test('organization ownership uses the configured immutable ID, not only the returned login', async () => {
  const upstream = provider({ wrongOwner: true });
  const report = await checkRepositoryAccess(env, config, 'rdpollard', { now, fetcher: upstream.fetcher });
  assert.equal(report.complete, false);
  assert.equal(report.accounts[1].reason, 'authentication');
  assert.equal(upstream.calls.length, 4);
});

test('invalid, duplicated, oversized or caller-expanded organization configuration is rejected before GitHub requests', async () => {
  const cases = [
    undefined, '', 'not-json', '{}', JSON.stringify([null]), JSON.stringify([{ ...organization, id: config.ownerId }]),
    JSON.stringify([{ ...organization, id: '9007199254740999' }]),
    JSON.stringify([organization, { ...organization, login: 'another-org' }]),
    JSON.stringify([organization, { ...organization, id: '8', login: 'STORMBOTS' }]),
    JSON.stringify([{ ...organization, repositories: [] }]),
    JSON.stringify([{ ...organization, repositories: ['../escape'] }]),
    JSON.stringify([{ ...organization, repositories: ['repo', 'REPO'] }]),
    JSON.stringify([{ ...organization, url: 'https://untrusted.example' }]),
    JSON.stringify(Array.from({ length: 5 }, (_, i) => ({ ...organization, id: String(i + 1), login: `org-${i}` }))),
    ' '.repeat(16_385) + '[]',
  ];
  for (const value of cases) {
    const upstream = provider();
    await assert.rejects(checkRepositoryAccess({ ...env, GITHUB_ORGANIZATIONS: value }, config, 'rdpollard', { now, fetcher: upstream.fetcher }),
      error => error instanceof DiscoveryError && error.reason === 'configuration');
    assert.equal(upstream.calls.length, 0);
  }
  assert.equal(repositoryScopes({ ...env, GITHUB_ORGANIZATIONS: '[]' }, config, 'rdpollard').length, 1);
});

test('one request budget applies across accounts, with no partial inventory accepted after exhaustion', async () => {
  const upstream = provider({ large: true });
  const report = await checkRepositoryAccess(env, config, 'rdpollard', { now, fetcher: upstream.fetcher });
  assert.equal(upstream.calls.length, 40);
  assert.equal(report.complete, false);
  assert.equal(report.accounts[0].inventory?.repositoryCount, 2000);
  assert.equal(report.accounts[1].inventory, null);
  assert.equal(report.accounts[1].reason, 'incomplete');
  assert.equal(report.repositoryCount, 2000);
});
