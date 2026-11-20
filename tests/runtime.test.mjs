import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readSignedCookie, SESSION_COOKIE, SESSION_SECONDS, signCookie } from '../worker/auth/cookies.ts';

const origin = 'https://nanny.example';
const secret = 'A'.repeat(43); // Test fixture only.
const bindings = {
  APP_ORIGIN: origin, GITHUB_OWNER_ID: '27035363', GITHUB_CLIENT_ID: 'Iv1_test_client',
  GITHUB_CLIENT_SECRET: 'test-client-secret-only-for-fixtures',
  SESSION_SECRET: secret, GITHUB_APP_SLUG: 'github-nanny-test',
};

test('built Worker signs and verifies owner cookies in workerd', async () => {
  // Use the pinned SDK's explicit converter for the documented module options;
  // Miniflare 5 uses a different native constructor shape than Miniflare 4.
  const worker = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    scriptPath: 'dist/github_nanny/index.js',
    compatibilityDate: '2026-11-19',
    bindings,
  }));
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

    const iat = Math.floor(Date.now() / 1000);
    const value = await signCookie({ purpose: 'owner-session', sub: '27035363', login: 'rdpollard', iat, exp: iat + SESSION_SECONDS }, secret);
    const headers = { Cookie: `${SESSION_COOKIE}=${value}` };
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

test('built Worker exchanges OAuth codes and rejects upstream redirects in workerd', async () => {
  for (const mode of ['owner', 'exchange-redirect', 'identity-redirect']) {
    const requests = [];
    const worker = new Miniflare(convertV4MiniflareOptions({
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
    }));
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
