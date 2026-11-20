import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readSignedCookie, SESSION_COOKIE, SESSION_SECONDS, signCookie } from '../worker/auth/cookies.ts';

const origin = 'https://nanny.example';
const secret = 'A'.repeat(43); // Test fixture only.

test('built Worker signs and verifies owner cookies in workerd', async () => {
  // Use the pinned SDK's explicit converter for the documented module options;
  // Miniflare 5 uses a different native constructor shape than Miniflare 4.
  const worker = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    scriptPath: 'dist/github_nanny/index.js',
    compatibilityDate: '2026-11-19',
    bindings: {
      APP_ORIGIN: origin, GITHUB_OWNER_ID: '27035363', GITHUB_CLIENT_ID: 'Iv1_test_client',
      GITHUB_CLIENT_SECRET: 'test-client-secret-only-for-fixtures',
      SESSION_SECRET: secret, GITHUB_APP_SLUG: 'github-nanny-test',
    },
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
