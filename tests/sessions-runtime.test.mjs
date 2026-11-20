import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { runtimeWorker, storedOwnerCookie } from './helpers/runtime.mjs';
import { randomToken, readSignedCookie, SESSION_COOKIE, SESSION_SECONDS, signCookie } from '../worker/auth/cookies.ts';

const origin = 'https://nanny.example';
const bindings = {
  APP_ORIGIN: origin, GITHUB_OWNER_ID: '27035363', GITHUB_CLIENT_ID: 'Iv1_test_client',
  GITHUB_CLIENT_SECRET: 'test-client-secret-only-for-fixtures', SESSION_SECRET: 'A'.repeat(43),
  GITHUB_APP_SLUG: 'github-nanny-test', GITHUB_ORGANIZATIONS: '[]',
};
const options = { modules: true, scriptPath: 'dist/github_nanny/index.js', compatibilityDate: '2026-11-19', bindings };

async function signedIn(worker, cookie) {
  const response = await worker.dispatchFetch(`${origin}/api/auth/session`, { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  return (await response.json()).authenticated;
}

test('D1-backed logout rejects copied cookies, all-device logout is scoped and CSRF protected', async () => {
  const worker = await runtimeWorker(options);
  try {
    const database = await worker.getD1Database('DB');
    const first = await storedOwnerCookie(worker, bindings);
    const second = await storedOwnerCookie(worker, bindings);
    const other = await storedOwnerCookie(worker, { ...bindings, GITHUB_OWNER_ID: '9' });
    assert.equal(await signedIn(worker, first), true);
    assert.equal(await signedIn(worker, second), true);
    assert.equal(await signedIn(worker, other), false);
    const logout = await worker.dispatchFetch(`${origin}/api/auth/logout`, {
      method: 'POST', headers: { Cookie: first, Origin: origin },
    });
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get('Set-Cookie'), /Max-Age=0/);
    assert.equal(await signedIn(worker, first), false, 'A copy of the cookie must also be revoked');
    assert.equal(await signedIn(worker, second), true);
    const get = await worker.dispatchFetch(`${origin}/api/auth/logout-all`, { headers: { Cookie: second } });
    assert.equal(get.status, 405);
    for (const headers of [{}, { Origin: 'https://untrusted.example' }, { Origin: origin, 'Sec-Fetch-Site': 'cross-site' }]) {
      const response = await worker.dispatchFetch(`${origin}/api/auth/logout-all`, { method: 'POST', headers: { Cookie: second, ...headers } });
      assert.equal(response.status, 403);
      assert.equal(await signedIn(worker, second), true);
    }
    const all = await worker.dispatchFetch(`${origin}/api/auth/logout-all`, { method: 'POST', headers: { Cookie: second, Origin: origin } });
    assert.equal(all.status, 200);
    assert.equal(await signedIn(worker, second), false);
    assert.equal(await database.prepare('SELECT COUNT(*) AS count FROM owner_sessions WHERE owner_id = ?').bind(bindings.GITHUB_OWNER_ID).first('count'), 0);
    assert.equal(await database.prepare('SELECT COUNT(*) AS count FROM owner_sessions WHERE owner_id = ?').bind('9').first('count'), 1);
  } finally { await worker.dispose(); }
});

test('the real OAuth callback persists only a session hash and removes expired records atomically', async () => {
  const worker = await runtimeWorker({ ...options,
    outboundService: async request => request.url === 'https://github.com/login/oauth/access_token'
      ? Response.json({ access_token: 'test-user-token', token_type: 'bearer' })
      : Response.json({ id: 27035363, login: 'rdpollard' }),
  });
  try {
    const database = await worker.getD1Database('DB');
    const now = Math.floor(Date.now() / 1000);
    await database.prepare('INSERT INTO owner_sessions (session_hash, owner_id, login, issued_at, expires_at) VALUES (?, ?, ?, ?, ?)')
      .bind('0'.repeat(64), bindings.GITHUB_OWNER_ID, 'rdpollard', now - SESSION_SECONDS - 1, now - 1).run();
    const login = await worker.dispatchFetch(`${origin}/api/auth/login`, { redirect: 'manual' });
    const state = new URL(login.headers.get('Location')).searchParams.get('state');
    const cookie = login.headers.get('Set-Cookie').split(';')[0];
    const callback = await worker.dispatchFetch(`${origin}/api/auth/callback?${new URLSearchParams({ code: 'test-code', state })}`, { redirect: 'manual', headers: { Cookie: cookie } });
    assert.equal(callback.headers.get('Location'), `${origin}/settings?sign_in=success`);
    const ownerCookie = callback.headers.getSetCookie().find(value => value.startsWith(`${SESSION_COOKIE}=`)).split(';')[0];
    const payload = await readSignedCookie(ownerCookie.split('=')[1], bindings.SESSION_SECRET);
    assert.match(payload.sid, /^[A-Za-z0-9_-]{43}$/);
    const records = (await database.prepare('SELECT * FROM owner_sessions').all()).results;
    assert.equal(records.length, 1);
    assert.equal(records[0].session_hash, createHash('sha256').update(payload.sid).digest('hex'));
    for (const secret of [payload.sid, ownerCookie, 'test-user-token', bindings.GITHUB_CLIENT_SECRET]) assert.ok(!JSON.stringify(records).includes(secret));
    const session = await worker.dispatchFetch(`${origin}/api/auth/session`, { headers: { Cookie: ownerCookie } });
    const view = await session.json();
    assert.equal(view.authenticated, true);
    assert.equal(Object.hasOwn(view, 'sid'), false);
    assert.equal(Object.hasOwn(view, 'id'), false);
    const expiredCookie = await storedOwnerCookie(worker, bindings, Date.now() - (SESSION_SECONDS + 1) * 1000);
    assert.equal(await signedIn(worker, expiredCookie), false);
    const legacy = await signCookie({ purpose: 'owner-session', sub: bindings.GITHUB_OWNER_ID, login: 'rdpollard', iat: now, exp: now + SESSION_SECONDS }, bindings.SESSION_SECRET);
    assert.equal(await signedIn(worker, `${SESSION_COOKIE}=${legacy}`), false);
  } finally { await worker.dispose(); }
});

test('missing migrations and database failure never fall back to signed-cookie authorization', async () => {
  const worker = await runtimeWorker({ ...options,
    outboundService: async request => request.url === 'https://github.com/login/oauth/access_token'
      ? Response.json({ access_token: 'test-user-token', token_type: 'bearer' })
      : Response.json({ id: 27035363, login: 'rdpollard' }),
  }, false);
  try {
    const now = Math.floor(Date.now() / 1000);
    const value = await signCookie({ purpose: 'owner-session', sub: bindings.GITHUB_OWNER_ID, login: 'rdpollard', sid: randomToken(), iat: now, exp: now + SESSION_SECONDS }, bindings.SESSION_SECRET);
    const response = await worker.dispatchFetch(`${origin}/api/auth/session`, { headers: { Cookie: `${SESSION_COOKIE}=${value}` } });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'Owner session storage unavailable' });
    const login = await worker.dispatchFetch(`${origin}/api/auth/login`, { redirect: 'manual' });
    const state = new URL(login.headers.get('Location')).searchParams.get('state');
    const oauthCookie = login.headers.get('Set-Cookie').split(';')[0];
    const callback = await worker.dispatchFetch(`${origin}/api/auth/callback?${new URLSearchParams({ code: 'test-code', state })}`, { redirect: 'manual', headers: { Cookie: oauthCookie } });
    assert.equal(callback.headers.get('Location'), `${origin}/settings?sign_in=failed`);
    assert.ok(!callback.headers.getSetCookie().some(cookie => cookie.startsWith(`${SESSION_COOKIE}=`)));
    const status = await worker.dispatchFetch(`${origin}/api/status`);
    assert.equal((await status.json()).phase, 'unknown');
  } finally { await worker.dispose(); }
});
