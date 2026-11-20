import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runtimeWorker, storedOwnerCookie } from './helpers/runtime.mjs';
import { readSignedCookie, SESSION_COOKIE, SESSION_SECONDS, signCookie } from '../worker/auth/cookies.ts';
import { rsaFixture, verifyAppJwt } from './helpers/keys.ts';

const origin = 'https://nanny.example';
const secret = 'A'.repeat(43); // Test fixture only.
const bindings = {
  APP_ORIGIN: origin, GITHUB_OWNER_ID: '27035363', GITHUB_CLIENT_ID: 'Iv1_test_client',
  GITHUB_CLIENT_SECRET: 'test-client-secret-only-for-fixtures',
  SESSION_SECRET: secret, GITHUB_APP_SLUG: 'github-nanny-test', GITHUB_ORGANIZATIONS: '[]',
};

test('built Worker signs and verifies owner cookies in workerd', async () => {
  // Use the pinned SDK's explicit converter for the documented module options;
  // Miniflare 5 uses a different native constructor shape than Miniflare 4.
  const worker = await runtimeWorker({
    modules: true,
    scriptPath: 'dist/github_nanny/index.js',
    compatibilityDate: '2026-11-19',
    bindings,
  });
  try {
    const login = await worker.dispatchFetch(`${origin}/api/auth/login`, { redirect: 'manual' });
    assert.equal(login.status, 302);
    const authorize = new URL(login.headers.get('Location'));
    assert.equal(authorize.origin, 'https://github.com');
    const signed = login.headers.get('Set-Cookie').split(';')[0].split('=')[1];
    const oauth = await readSignedCookie(signed, secret);
    assert.equal(oauth.purpose, 'oauth-state');
    assert.equal(oauth.nonce, authorize.searchParams.get('state'));

    const invalidCallback = await worker.dispatchFetch(`${origin}/api/auth/callback?code=test-code`, { redirect: 'manual' });
    assert.equal(invalidCallback.headers.get('Location'), `${origin}/settings?sign_in=state`);
    assert.equal(invalidCallback.headers.get('Cache-Control'), 'no-store');

    const headers = { Cookie: await storedOwnerCookie(worker, bindings) };
    const session = await worker.dispatchFetch(`${origin}/api/auth/session`, { headers });
    assert.equal((await session.json()).authenticated, true);
    const admin = await worker.dispatchFetch(`${origin}/api/admin/installation`, { headers });
    assert.equal(admin.status, 200);
    const logout = await worker.dispatchFetch(`${origin}/api/auth/logout`, { method: 'POST', headers: { ...headers, Origin: origin } });
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get('Set-Cookie'), /Max-Age=0/);
    assert.equal((await worker.dispatchFetch(`${origin}/api/admin/installation`)).status, 401);
    const status = await worker.dispatchFetch(`${origin}/api/status`);
    assert.equal((await status.json()).phase, 'unknown');
  } finally { await worker.dispose(); }
});

test('built Worker signs App JWTs and discovers complete repository inventories in workerd', async () => {
  const keys = await rsaFixture();
  const permissions = { actions: 'read', metadata: 'read' };
  for (const mode of ['success', 'duplicate', 'redirect']) {
    const calls = [];
    const started = Math.floor(Date.now() / 1000);
    const repository = (id, privateRepository = false) => ({
      id, name: privateRepository ? 'hidden-private-name' : `repo-${id}`, private: privateRepository,
      owner: { id: 27035363, login: 'rdpollard' },
    });
    const worker = await runtimeWorker({
      modules: true, scriptPath: 'dist/github_nanny/index.js', compatibilityDate: '2026-11-19',
      bindings: { ...bindings, GITHUB_APP_PRIVATE_KEY: keys.pkcs1 },
      outboundService: async request => {
        calls.push(request.url);
        if (request.url.startsWith('https://api.github.com/users/') || request.url.includes('/access_tokens')) {
          const jwt = request.headers.get('Authorization').slice(7);
          const claims = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
          assert.ok(claims.iat >= started - 60 && claims.iat <= Math.floor(Date.now() / 1000) - 60);
          assert.equal(await verifyAppJwt(jwt, keys.publicKey, bindings.GITHUB_CLIENT_ID, (claims.exp - 540) * 1000), true);
        }
        if (request.url === 'https://api.github.com/users/rdpollard/installation') return Response.json({
          id: 7, account: { id: 27035363, type: 'User' }, permissions, suspended_at: null,
          client_id: bindings.GITHUB_CLIENT_ID, app_slug: bindings.GITHUB_APP_SLUG, repository_selection: 'all',
        });
        if (request.url === 'https://api.github.com/app/installations/7/access_tokens') {
          assert.deepEqual(await request.json(), { permissions });
          return Response.json({ token: 'test-installation-token', permissions, repository_selection: 'all', expires_at: new Date(Date.now() + 3_600_000).toISOString() }, { status: 201 });
        }
        assert.equal(new URL(request.url).origin, 'https://api.github.com');
        assert.equal(new URL(request.url).pathname, '/installation/repositories');
        assert.equal(request.headers.get('Authorization'), 'Bearer test-installation-token');
        if (mode === 'redirect') return Response.json({}, { status: 302, headers: { Location: 'https://untrusted.example/secret' } });
        const page = Number(new URL(request.url).searchParams.get('page'));
        return Response.json({ total_count: 101, repositories: page === 1
          ? Array.from({ length: 100 }, (_, i) => repository(i + 1)) : [repository(mode === 'duplicate' ? 1 : 101, true)] });
      },
    });
    try {
      assert.equal((await worker.dispatchFetch(`${origin}/api/admin/repositories`)).status, 401);
      assert.equal(calls.length, 0);
      const ownerCookie = await storedOwnerCookie(worker, bindings);
      const response = await worker.dispatchFetch(`${origin}/api/admin/repositories`, { headers: { Cookie: ownerCookie } });
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.complete, mode === 'success');
      if (mode === 'success') {
        assert.equal(body.repositoryCount, 101);
        assert.equal(body.repositories.length, 100);
        assert.equal(body.privateRepositoryCount, 1);
      } else assert.equal(body.accounts[0].reason, mode === 'duplicate' ? 'incomplete' : 'unavailable');
      assert.equal(calls.length, mode === 'redirect' ? 3 : 4);
      assert.ok(!JSON.stringify(body).includes('hidden-private-name'));
      assert.ok(!JSON.stringify(body).includes('test-installation-token'));
      const status = await worker.dispatchFetch(`${origin}/api/status`);
      assert.equal((await status.json()).phase, 'unknown');
    } finally { await worker.dispose(); }
  }
});

test('built Worker exchanges OAuth codes and rejects upstream redirects in workerd', async () => {
  for (const mode of ['owner', 'exchange-redirect', 'identity-redirect']) {
    const requests = [];
    const worker = await runtimeWorker({
      modules: true,
      scriptPath: 'dist/github_nanny/index.js',
      compatibilityDate: '2026-11-19',
      bindings,
      outboundService: async request => {
        requests.push(request.url);
        if (request.url === 'https://github.com/login/oauth/access_token') {
          assert.equal(request.method, 'POST');
          const body = await request.json();
          assert.equal(body.client_secret, bindings.GITHUB_CLIENT_SECRET);
          assert.equal(body.code, 'test-code');
          assert.match(body.code_verifier, /^[A-Za-z0-9_-]{43}$/);
          assert.equal(body.redirect_uri, `${origin}/api/auth/callback`);
          // Even a token-shaped redirect body must never authenticate a user.
          return Response.json({ access_token: 'test-provider-token', token_type: 'bearer' }, {
            status: mode === 'exchange-redirect' ? 302 : 200,
            headers: { Location: 'https://untrusted.example/token' },
          });
        }
        if (request.url === 'https://api.github.com/user') {
          assert.equal(request.headers.get('Authorization'), 'Bearer test-provider-token');
          return Response.json({ id: 27035363, login: 'rdpollard' }, {
            status: mode === 'identity-redirect' ? 302 : 200,
            headers: { Location: 'https://untrusted.example/user' },
          });
        }
        throw new Error('The Worker must never follow a provider redirect');
      },
    });
    try {
      const login = await worker.dispatchFetch(`${origin}/api/auth/login`, { redirect: 'manual' });
      const state = new URL(login.headers.get('Location')).searchParams.get('state');
      const cookie = login.headers.get('Set-Cookie').split(';')[0];
      const callback = await worker.dispatchFetch(`${origin}/api/auth/callback?${new URLSearchParams({ code: 'test-code', state })}`, {
        redirect: 'manual', headers: { Cookie: cookie },
      });
      assert.equal(callback.status, 303);
      const outcome = mode === 'owner' ? 'success' : mode === 'exchange-redirect' ? 'provider' : 'identity';
      assert.equal(callback.headers.get('Location'), `${origin}/settings?sign_in=${outcome}`);
      assert.deepEqual(requests, mode === 'exchange-redirect'
        ? ['https://github.com/login/oauth/access_token']
        : ['https://github.com/login/oauth/access_token', 'https://api.github.com/user']);
      const session = callback.headers.getSetCookie().find(value => value.startsWith(`${SESSION_COOKIE}=`));
      if (mode === 'owner') {
        assert.ok(session);
        const verified = await worker.dispatchFetch(`${origin}/api/auth/session`, { headers: { Cookie: session.split(';')[0] } });
        assert.equal((await verified.json()).authenticated, true);
      } else assert.equal(session, undefined);
    } finally { await worker.dispose(); }
  }
});

test('built Worker verifies a required organization repository and exposes missing installation coverage', async () => {
  const keys = await rsaFixture();
  const requiredName = 'Tactics-Strategy-Dev-Environments';
  const permissions = { actions: 'read', metadata: 'read' };
  for (const missing of [false, true]) {
    const calls = [];
    const worker = await runtimeWorker({
      modules: true, scriptPath: 'dist/github_nanny/index.js', compatibilityDate: '2026-11-19',
      bindings: { ...bindings, GITHUB_APP_PRIVATE_KEY: keys.pkcs1,
        GITHUB_ORGANIZATIONS: JSON.stringify([{ id: '5925283', login: 'stormbots', repositories: [requiredName] }]) },
      outboundService: async request => {
        const url = new URL(request.url);
        calls.push(url.pathname);
        if (url.pathname === '/users/rdpollard/installation' || url.pathname === '/orgs/stormbots/installation') {
          const org = url.pathname.startsWith('/orgs/');
          if (org && missing) return Response.json({}, { status: 404 });
          return Response.json({ id: org ? 8 : 7, account: { id: org ? 5925283 : 27035363, type: org ? 'Organization' : 'User' },
            permissions, suspended_at: null, repository_selection: org ? 'selected' : 'all',
            client_id: bindings.GITHUB_CLIENT_ID, app_slug: bindings.GITHUB_APP_SLUG });
        }
        if (url.pathname === '/app/installations/7/access_tokens' || url.pathname === '/app/installations/8/access_tokens') {
          const org = url.pathname.includes('/8/');
          return Response.json({ token: org ? 'test-org-token' : 'test-personal-token', expires_at: new Date(Date.now() + 3_600_000).toISOString(), permissions, repository_selection: org ? 'selected' : 'all' }, { status: 201 });
        }
        assert.equal(url.pathname, '/installation/repositories');
        const org = request.headers.get('Authorization') === 'Bearer test-org-token';
        return Response.json({ total_count: 1, repositories: [{ id: org ? 2 : 1, name: org ? requiredName : 'github-nanny', private: false,
          owner: { id: org ? 5925283 : 27035363, login: org ? 'stormbots' : 'rdpollard' } }] });
      },
    });
    try {
      const ownerCookie = await storedOwnerCookie(worker, bindings);
      const response = await worker.dispatchFetch(`${origin}/api/admin/repositories?organization=unapproved&required=other`, { headers: { Cookie: ownerCookie } });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.complete, !missing);
      assert.equal(body.accounts.length, 2);
      assert.equal(body.accounts[0].complete, true);
      if (missing) {
        assert.equal(body.accounts[1].reason, 'not_installed');
        assert.deepEqual(body.accounts[1].missingRepositories, [requiredName]);
      } else assert.ok(body.repositories.some(repository => repository.name === `stormbots/${requiredName}`));
      assert.ok(!calls.some(path => path.includes('unapproved') || path.includes('/actions/')));
      assert.equal(calls.length, missing ? 4 : 6);
      const status = await worker.dispatchFetch(`${origin}/api/status`);
      assert.equal((await status.json()).phase, 'unknown');
    } finally { await worker.dispose(); }
  }
});
