import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authConfig, type Bindings } from '../worker/auth/config.ts';
import { authRoute } from '../worker/auth/routes.ts';
import { SESSION_COOKIE, SESSION_SECONDS, signCookie } from '../worker/auth/cookies.ts';
import type { Fetcher } from '../worker/auth/github.ts';
import { appJwt } from '../worker/github/jwt.ts';
import { discoverRepositories, DiscoveryError } from '../worker/github/discovery.ts';
import worker from '../worker/index.ts';
import { rsaFixture, verifyAppJwt } from './helpers/keys.ts';
import type { DashboardSnapshot } from '../shared/contracts.ts';
import { memorySessions } from './helpers/sessions.ts';

const keys = await rsaFixture();
const now = Date.UTC(2026, 10, 19, 12);
const env: Bindings = {
  APP_ORIGIN: 'https://nanny.example', GITHUB_OWNER_ID: '27035363', GITHUB_CLIENT_ID: 'Iv1_test_client',
  GITHUB_CLIENT_SECRET: 'test-client-secret-only-for-fixtures', SESSION_SECRET: 'A'.repeat(43),
  GITHUB_APP_SLUG: 'github-nanny-test', GITHUB_APP_PRIVATE_KEY: keys.pkcs1, GITHUB_ORGANIZATIONS: '[]',
};
const config = authConfig(env)!;
const permissions = { actions: 'read', metadata: 'read' };
const installation = {
  id: 7, account: { id: 27035363, login: 'rdpollard', type: 'User' },
  client_id: env.GITHUB_CLIENT_ID, app_slug: env.GITHUB_APP_SLUG,
  permissions, suspended_at: null, repository_selection: 'all',
};
const access = {
  token: 'test-installation-token', permissions, repository_selection: 'all',
  expires_at: new Date(now + 3_600_000).toISOString(),
};
function repository(id: number, privateRepository = false) {
  return { id, name: privateRepository ? 'private-test-repository' : `repo-${id}`, private: privateRepository,
    owner: { id: 27035363, login: 'rdpollard' }, html_url: 'https://untrusted.example/ignored' };
}
function provider(options: {
  installation?: object; access?: object;
  page?: (page: number) => Response;
  failure?: Response;
} = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher: Fetcher = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    assert.equal(init?.redirect, 'manual');
    if (options.failure) return options.failure;
    if (url === 'https://api.github.com/users/rdpollard/installation') return Response.json(options.installation ?? installation);
    if (url === 'https://api.github.com/app/installations/7/access_tokens') {
      assert.equal(init?.method, 'POST');
      assert.deepEqual(JSON.parse(String(init?.body)), { permissions });
      return Response.json(options.access ?? access, { status: 201 });
    }
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://api.github.com');
    assert.equal(parsed.pathname, '/installation/repositories');
    assert.equal(parsed.searchParams.get('per_page'), '100');
    assert.equal(new Headers(init?.headers).get('Authorization'), `Bearer ${access.token}`);
    return options.page?.(Number(parsed.searchParams.get('page'))) ?? Response.json({ total_count: 0, repositories: [] });
  };
  return { calls, fetcher };
}
async function discover(upstream = provider(), overrides: Bindings = {}) {
  return discoverRepositories({ ...env, ...overrides }, config, 'rdpollard', { now, fetcher: upstream.fetcher });
}
async function fails(action: Promise<unknown>, reason: string) {
  await assert.rejects(action, error => error instanceof DiscoveryError && error.reason === reason && error.message === 'Repository discovery failed');
}

test('App JWTs verify with GitHub PKCS#1 and PKCS#8 keys, including CRLF PEM files', async () => {
  for (const pem of [keys.pkcs1, keys.pkcs8, keys.pkcs1.replaceAll('\n', '\r\n')]) {
    const jwt = await appJwt(config.clientId, pem, now);
    assert.equal(await verifyAppJwt(jwt, keys.publicKey, config.clientId, now), true);
    assert.ok(!jwt.includes(config.clientSecret));
  }
  const weak = await rsaFixture(1024);
  await assert.rejects(appJwt(config.clientId, weak.pkcs1, now));
});

test('missing, malformed, oversized and non-canonical keys fail before any GitHub request', async () => {
  for (const key of ['', 'not-a-key', 'x'.repeat(17_000), keys.pkcs1.replace('BEGIN RSA PRIVATE KEY', 'BEGIN PUBLIC KEY')]) {
    const upstream = provider();
    await fails(discover(upstream, { GITHUB_APP_PRIVATE_KEY: key }), 'setup');
    assert.equal(upstream.calls.length, 0);
  }
});

test('discovery reads every repository page, signs requests and returns no tokens or private names', async () => {
  const upstream = provider({ page: page => Response.json({ total_count: 101, repositories: page === 1
    ? Array.from({ length: 100 }, (_, i) => repository(i + 1)) : [repository(101, true)] }, {
    headers: page === 1 ? { Link: '<https://untrusted.example/page-2>; rel="next"' } : {},
  }) });
  const result = await discover(upstream);
  assert.equal(result.repositoryCount, 101);
  assert.equal(result.repositories.length, 100);
  assert.equal(result.privateRepositoryCount, 1);
  assert.equal(result.selection, 'all');
  assert.equal(result.checkedAt, new Date(now).toISOString());
  assert.equal(upstream.calls.length, 4);
  const jwt = new Headers(upstream.calls[0].init?.headers).get('Authorization')!.slice(7);
  assert.equal(await verifyAppJwt(jwt, keys.publicKey, config.clientId, now), true);
  assert.ok(upstream.calls.every(call => new URL(call.url).origin === 'https://api.github.com'));
  const serialized = JSON.stringify(result);
  for (const secret of [jwt, access.token, keys.pkcs1, config.clientSecret, 'private-test-repository', 'untrusted.example']) assert.ok(!serialized.includes(secret));
  assert.ok(result.repositories.every(repo => repo.url === `https://github.com/${repo.name}`));
});

test('empty and selected installations are inventories, never claims of global idle or coverage', async () => {
  const upstream = provider({ installation: { ...installation, repository_selection: 'selected' }, access: { ...access, repository_selection: 'selected' } });
  const result = await discover(upstream);
  assert.equal(result.repositoryCount, 0);
  assert.equal(result.selection, 'selected');
  const status = await worker.fetch(new Request('https://nanny.example/api/status'), env);
  const snapshot = await status.json<DashboardSnapshot>();
  assert.equal(snapshot.phase, 'unknown');
  assert.equal(snapshot.connected, false);
});

test('wrong owner or App, missing approval, suspension and unexpected permissions stop discovery', async () => {
  for (const entry of [
    { value: { account: { ...installation.account, id: 9 } }, reason: 'authentication' },
    { value: { account: { ...installation.account, type: 'Organization' } }, reason: 'authentication' },
    { value: { client_id: 'other-client' }, reason: 'authentication' },
    { value: { app_slug: 'other-app' }, reason: 'authentication' },
    { value: { suspended_at: new Date(now).toISOString() }, reason: 'permissions' },
    { value: { permissions: { metadata: 'read' } }, reason: 'permissions' },
    { value: { permissions: { actions: 'write', metadata: 'read' } }, reason: 'permissions' },
    { value: { permissions: { ...permissions, contents: 'write' } }, reason: 'permissions' },
  ]) {
    const upstream = provider({ installation: { ...installation, ...entry.value } });
    await fails(discover(upstream), entry.reason);
    assert.equal(upstream.calls.length, 1);
  }
});

test('expired, narrowed or invalid installation tokens cannot produce a repository inventory', async () => {
  for (const value of [
    { token: '' }, { expires_at: new Date(now).toISOString() }, { expires_at: 'invalid' },
    { permissions: { metadata: 'read' } }, { repository_selection: 'selected' },
  ]) {
    const upstream = provider({ access: { ...access, ...value } });
    await fails(discover(upstream), 'authentication');
    assert.equal(upstream.calls.length, 2);
  }
});

test('truncated, changing, duplicate, oversized and inconsistent repository pages fail closed', async () => {
  const full = Array.from({ length: 100 }, (_, i) => repository(i + 1));
  for (const page of [
    () => Response.json({ total_count: 2001, repositories: full }),
    () => Response.json({ total_count: 101, repositories: [repository(1)] }),
    (n: number) => Response.json({ total_count: 101, repositories: n === 1 ? full : [] }),
    (n: number) => Response.json({ total_count: 101, repositories: n === 1 ? full : [repository(1)] }),
    (n: number) => Response.json({ total_count: n === 1 ? 101 : 102, repositories: n === 1 ? full : [repository(101)] }),
    () => Response.json({ total_count: 1, repositories: [repository(1)] }, { headers: { Link: '<https://api.github.com/installation/repositories?page=2>; rel="next"' } }),
    () => Response.json({ total_count: 1, repositories: [{ ...repository(1), owner: { id: 9, login: 'other' } }] }),
    () => new Response('x'.repeat(2_097_153)),
  ]) await fails(discover(provider({ page })), 'incomplete');
});

test('HTTP failures, redirects and network details yield fixed discovery failures', async () => {
  for (const entry of [
    { status: 401, reason: 'authentication' }, { status: 404, reason: 'not_installed' },
    { status: 403, reason: 'permissions' }, { status: 429, reason: 'rate_limited' },
    { status: 302, reason: 'unavailable' }, { status: 500, reason: 'unavailable' },
  ]) await fails(discover(provider({ failure: Response.json({ raw: 'private-provider-detail' }, { status: entry.status, headers: { Location: 'https://untrusted.example' } }) })), entry.reason);
  await fails(discover(provider({ failure: new Response('private-provider-detail', { status: 403, headers: { 'X-RateLimit-Remaining': '0' } }) })), 'rate_limited');
  await fails(discoverRepositories(env, config, 'rdpollard', { now, fetcher: async () => { throw new Error('private-provider-detail'); } }), 'unavailable');
});

test('the discovery route requires owner authorization before key use or provider calls', async t => {
  const logged: unknown[] = [];
  t.mock.method(console, 'warn', (value: unknown) => { logged.push(value); });
  let calls = 0;
  const sessions = memorySessions();
  const fetcher: Fetcher = async () => { calls++; throw new Error('private-provider-detail'); };
  const route = (request: Request, bindings = env) => authRoute(request, bindings, { now, fetcher, sessions });
  const path = 'https://nanny.example/api/admin/repositories';
  assert.equal((await route(new Request(path)))!.status, 401);
  assert.equal((await route(new Request(path, { method: 'POST' })))!.status, 405);
  const sid = 'A'.repeat(43);
  await sessions.create(sid, config.ownerId, 'rdpollard', now / 1000, now / 1000 + SESSION_SECONDS);
  const value = await signCookie({ purpose: 'owner-session', sub: config.ownerId, login: 'rdpollard', sid, iat: now / 1000, exp: now / 1000 + SESSION_SECONDS }, config.sessionSecret);
  const cookie = `${SESSION_COOKIE}=${value}`;
  assert.equal((await route(new Request(path, { headers: { Cookie: cookie, 'Sec-Fetch-Site': 'cross-site' } })))!.status, 403);
  assert.equal(calls, 0);
  const response = (await route(new Request(path, { headers: { Cookie: cookie } }), { ...env, GITHUB_APP_PRIVATE_KEY: '' }))!;
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), { error: 'Repository discovery unavailable', reason: 'setup' });
  assert.deepEqual(logged, [{ event: 'github_discovery_failed', reason: 'setup' }]);
  assert.equal(calls, 0);
});
