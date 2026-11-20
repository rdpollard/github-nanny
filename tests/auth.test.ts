import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Bindings } from '../worker/auth/config.ts';
import { authConfig } from '../worker/auth/config.ts';
import { authRoute } from '../worker/auth/routes.ts';
import {
  challenge, cookieValue, OAUTH_COOKIE, OAUTH_SECONDS, readSignedCookie,
  SESSION_COOKIE, SESSION_SECONDS, signCookie,
} from '../worker/auth/cookies.ts';
import type { Fetcher } from '../worker/auth/github.ts';
import type { OwnerSession } from '../shared/contracts.ts';
import type { SessionStore } from '../worker/auth/sessions.ts';
import { memorySessions } from './helpers/sessions.ts';

const origin = 'https://nanny.example';
const now = Date.UTC(2026, 10, 19, 12);
const nowSeconds = now / 1000;
const sessions = memorySessions();
// Deliberately deterministic test fixtures, never production credentials.
const env: Bindings = {
  APP_ORIGIN: origin, GITHUB_OWNER_ID: '27035363', GITHUB_CLIENT_ID: 'Iv1_test_client',
  GITHUB_CLIENT_SECRET: 'test-client-secret-only-for-fixtures', GITHUB_APP_SLUG: 'github-nanny-test',
  SESSION_SECRET: 'A'.repeat(43),
};

async function route(request: Request, bindings = env, options: { fetcher?: Fetcher; now?: number; sessions?: SessionStore } = {}) {
  const response = await authRoute(request, bindings, { now, sessions, ...options });
  assert.ok(response);
  return response;
}

async function start() {
  const response = await route(new Request(`${origin}/api/auth/login`));
  const redirect = new URL(response.headers.get('Location')!);
  const cookie = response.headers.get('Set-Cookie')!.split(';')[0];
  return { response, redirect, cookie };
}

function provider(id = 27035363): { fetcher: Fetcher; requests: { url: string; init?: RequestInit }[] } {
  const requests: { url: string; init?: RequestInit }[] = [];
  return {
    requests,
    fetcher: async (input, init) => {
      const url = String(input);
      requests.push({ url, init });
      if (url === 'https://github.com/login/oauth/access_token') return Response.json({ access_token: 'provider-token-test-only', token_type: 'bearer' });
      if (url === 'https://api.github.com/user') return Response.json({ id, login: 'rdpollard', email: 'not-for-the-browser@example.com' });
      throw new Error('Unexpected external request');
    },
  };
}

async function complete(id = 27035363) {
  const { redirect, cookie } = await start();
  const upstream = provider(id);
  const callback = `${origin}/api/auth/callback?code=test-code&state=${redirect.searchParams.get('state')}`;
  const response = await route(new Request(callback, { headers: { Cookie: cookie } }), env, { fetcher: upstream.fetcher });
  const sessionCookie = response.headers.getSetCookie().find(value => value.startsWith(`${SESSION_COOKIE}=`))?.split(';')[0];
  return { response, sessionCookie, upstream, cookie };
}

test('unconfigured sign-in fails closed without blocking the public dashboard', async () => {
  const response = await route(new Request(`${origin}/api/auth/session`), {});
  assert.deepEqual(await response.json(), { configured: false, authenticated: false, owner: null, installationUrl: null });
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal((await route(new Request(`${origin}/api/auth/login`), {})).status, 503);
  for (const bad of [
    { APP_ORIGIN: 'http://nanny.example' }, { APP_ORIGIN: `${origin}/bad-path` },
    { APP_ORIGIN: 'https://user:pass@nanny.example' }, { GITHUB_OWNER_ID: '9007199254740999' },
    { SESSION_SECRET: 'short' }, { SESSION_SECRET: 'B'.repeat(43) },
    { SESSION_SECRET: `${'A'.repeat(43)}\n` },
  ]) assert.equal(authConfig({ ...env, ...bad }), null);
});

test('login binds a random state and S256 PKCE verifier to a secure browser cookie', async () => {
  const { response, redirect, cookie } = await start();
  assert.equal(response.status, 302);
  assert.equal(redirect.origin, 'https://github.com');
  assert.equal(redirect.pathname, '/login/oauth/authorize');
  assert.equal(redirect.searchParams.get('redirect_uri'), `${origin}/api/auth/callback`);
  assert.equal(redirect.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(redirect.searchParams.get('scope'), null);
  assert.equal(redirect.searchParams.get('client_secret'), null);
  assert.match(response.headers.get('Set-Cookie')!, /Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=300/);
  const payload = await readSignedCookie(cookie.split('=')[1], env.SESSION_SECRET!);
  assert.ok(payload);
  assert.equal(payload.nonce, redirect.searchParams.get('state'));
  assert.equal(redirect.searchParams.get('code_challenge'), await challenge(String(payload.verifier)));
  assert.notEqual((await start()).cookie, cookie);
  // Caller-controlled return URLs must never become an open redirect.
  const injected = await route(new Request(`${origin}/api/auth/login?returnTo=https://evil.example`));
  assert.equal(new URL(injected.headers.get('Location')!).searchParams.get('redirect_uri'), `${origin}/api/auth/callback`);
});

test('valid owner callback creates a session without exposing provider credentials', async () => {
  const { response, sessionCookie, upstream } = await complete();
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('Location'), `${origin}/settings?sign_in=success`);
  assert.ok(sessionCookie);
  assert.ok(response.headers.getSetCookie().some(value => value.startsWith(`${OAUTH_COOKIE}=`) && value.includes('Max-Age=0')));
  const tokenRequest = upstream.requests[0];
  const body = JSON.parse(String(tokenRequest.init?.body));
  assert.equal(body.client_secret, env.GITHUB_CLIENT_SECRET);
  assert.equal(body.code, 'test-code');
  assert.match(body.code_verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(tokenRequest.init?.redirect, 'manual');
  assert.equal(upstream.requests[1].init?.redirect, 'manual');
  assert.equal(new Headers(upstream.requests[1].init?.headers).get('Authorization'), 'Bearer provider-token-test-only');
  const request = new Request(`${origin}/api/auth/session`, { headers: { Cookie: sessionCookie } });
  const session = await route(request);
  assert.deepEqual(await session.json(), {
    configured: true, authenticated: true, owner: { id: '27035363', login: 'rdpollard' },
    installationUrl: 'https://github.com/apps/github-nanny-test/installations/new',
  });
  const encoded = JSON.stringify([...response.headers]) + await response.text();
  for (const secret of ['provider-token-test-only', env.GITHUB_CLIENT_SECRET!, env.SESSION_SECRET!, 'not-for-the-browser']) assert.ok(!encoded.includes(secret));
});

test('wrong, missing, duplicated, tampered or expired OAuth state makes no provider request', async () => {
  const { redirect, cookie } = await start();
  const state = redirect.searchParams.get('state');
  let calls = 0;
  const fetcher: Fetcher = async () => { calls++; throw new Error('Must not reach provider'); };
  const cases = [
    { query: `code=code&state=${'B'.repeat(43)}`, cookie },
    { query: 'code=code', cookie },
    { query: `code=code&state=${state}`, cookie: '' },
    { query: `code=code&state=${state}&state=${state}`, cookie },
    { query: `code=one&code=two&state=${state}`, cookie, outcome: 'verification' },
    { query: `code=code&state=${state}`, cookie: `${cookie}; ${cookie}` },
    { query: `code=code&state=${state}`, cookie: `${cookie.slice(0, -1)}!` },
    { query: `code=code&state=${state}`, cookie, now: now + OAUTH_SECONDS * 1000 },
  ];
  for (const entry of cases) {
    const response = await route(new Request(`${origin}/api/auth/callback?${entry.query}`, { headers: { Cookie: entry.cookie } }), env, { fetcher, now: entry.now ?? now });
    assert.equal(response.headers.get('Location'), `${origin}/settings?sign_in=${entry.outcome ?? 'state'}`);
    assert.ok(!response.headers.getSetCookie().some(value => value.startsWith(`${SESSION_COOKIE}=`)));
  }
  assert.equal(calls, 0);
});

test('user cancellation clears OAuth state without a provider request', async () => {
  const { redirect, cookie } = await start();
  const response = await route(new Request(`${origin}/api/auth/callback?error=access_denied&state=${redirect.searchParams.get('state')}`, { headers: { Cookie: cookie } }), env, {
    fetcher: async () => { throw new Error('Must not call provider'); },
  });
  assert.equal(response.headers.get('Location'), `${origin}/settings?sign_in=cancelled`);
});

test('another immutable user ID cannot gain owner access even with the same login', async () => {
  const { response, sessionCookie } = await complete(999);
  assert.equal(response.headers.get('Location'), `${origin}/settings?sign_in=denied`);
  assert.equal(sessionCookie, undefined);
});

test('provider errors and oversized/malformed responses fail closed', async () => {
  for (const { fetcher, outcome } of [
    { fetcher: async () => { throw new Error('upstream-secret-that-must-not-be-returned'); }, outcome: 'provider' },
    { fetcher: async () => Response.json({ error: 'bad_verification_code', access_token: 'token', token_type: 'bearer' }), outcome: 'verification' },
    { fetcher: async () => new Response('not json'), outcome: 'provider' },
    { fetcher: async () => new Response('x'.repeat(33_000)), outcome: 'provider' },
    { fetcher: async () => new Response(null, { status: 302, headers: { Location: 'https://evil.example' } }), outcome: 'provider' },
  ] satisfies { fetcher: Fetcher; outcome: string }[]) {
    const { redirect, cookie } = await start();
    const response = await route(new Request(`${origin}/api/auth/callback?code=code&state=${redirect.searchParams.get('state')}`, { headers: { Cookie: cookie } }), env, { fetcher });
    assert.equal(response.headers.get('Location'), `${origin}/settings?sign_in=${outcome}`);
    assert.equal(await response.text(), '');
  }
});

test('provider diagnostics expose only fixed outcomes, never upstream payloads or credentials', async t => {
  const logged: unknown[] = [];
  t.mock.method(console, 'warn', (value: unknown) => { logged.push(value); });
  const privateDetail = 'test-upstream-detail-must-not-appear';
  const cases = [
    { error: 'incorrect_client_credentials', status: 200, outcome: 'credentials' },
    { error: 'incorrect_client_credentials', status: 400, outcome: 'credentials' },
    { error: 'bad_verification_code', status: 200, outcome: 'verification' },
    { error: 'redirect_uri_mismatch', status: 400, outcome: 'callback' },
    { error: privateDetail, status: 400, outcome: 'provider' },
    { error: '', status: 200, outcome: 'provider' },
  ];
  for (const entry of cases) {
    const { redirect, cookie } = await start();
    let calls = 0;
    const response = await route(new Request(`${origin}/api/auth/callback?code=code&state=${redirect.searchParams.get('state')}`, { headers: { Cookie: cookie } }), env, {
      fetcher: async () => {
        calls++;
        return Response.json({ error: entry.error, error_description: privateDetail, error_uri: `https://example.com/${privateDetail}`, access_token: privateDetail }, { status: entry.status });
      },
    });
    assert.equal(calls, 1, 'A failed exchange must never request a user identity');
    assert.equal(response.headers.get('Location'), `${origin}/settings?sign_in=${entry.outcome}`);
    assert.deepEqual(logged.at(-1), { event: 'github_signin_failed', reason: entry.outcome });
    assert.ok(!response.headers.getSetCookie().some(value => value.startsWith(`${SESSION_COOKIE}=`)));
    for (const privateValue of [privateDetail, env.GITHUB_CLIENT_SECRET!, env.SESSION_SECRET!]) {
      assert.ok(!JSON.stringify([...response.headers]).includes(privateValue));
      assert.ok(!JSON.stringify(logged).includes(privateValue));
    }
  }
});

test('identity failures stay distinct and non-success responses cannot create sessions', async t => {
  t.mock.method(console, 'warn', () => {});
  for (const mode of ['exchange-http', 'identity-http', 'identity-body', 'identity-network']) {
    const { redirect, cookie } = await start();
    const response = await route(new Request(`${origin}/api/auth/callback?code=code&state=${redirect.searchParams.get('state')}`, { headers: { Cookie: cookie } }), env, {
      fetcher: async input => {
        if (String(input) === 'https://github.com/login/oauth/access_token') {
          return Response.json({ access_token: 'test-token', token_type: 'bearer' }, { status: mode === 'exchange-http' ? 400 : 200 });
        }
        if (mode === 'identity-network') throw new Error('private-provider-error');
        return Response.json({ id: mode === 'identity-body' ? 'invalid-id' : 27035363, login: 'rdpollard' }, { status: mode === 'identity-http' ? 401 : 200 });
      },
    });
    assert.equal(response.headers.get('Location'), `${origin}/settings?sign_in=${mode === 'exchange-http' ? 'provider' : 'identity'}`);
    assert.ok(!response.headers.getSetCookie().some(value => value.startsWith(`${SESSION_COOKIE}=`)));
  }
});

test('session rejects tampering, wrong purpose, invalid lifetimes, owner changes and duplicate cookies', async () => {
  const { sessionCookie, cookie: oauthCookie } = await complete();
  assert.ok(sessionCookie);
  const stored = await readSignedCookie(sessionCookie.split('=')[1], env.SESSION_SECRET!);
  assert.ok(stored);
  const original = { purpose: 'owner-session', sub: env.GITHUB_OWNER_ID, login: 'rdpollard', sid: stored.sid, iat: nowSeconds, exp: nowSeconds + SESSION_SECONDS };
  const invalid = [
    { ...original, purpose: 'oauth-state' }, { ...original, sub: '999' },
    { ...original, iat: nowSeconds + 1, exp: nowSeconds + 1 + SESSION_SECONDS },
    { ...original, exp: original.exp + 1 },
  ];
  for (const payload of invalid) {
    const cookie = `${SESSION_COOKIE}=${await signCookie(payload, env.SESSION_SECRET!)}`;
    assert.equal((await (await route(new Request(`${origin}/api/auth/session`, { headers: { Cookie: cookie } }))).json<OwnerSession>()).authenticated, false);
  }
  for (const value of [`${sessionCookie}!`, `${sessionCookie}; ${sessionCookie}`, oauthCookie]) {
    assert.equal((await (await route(new Request(`${origin}/api/auth/session`, { headers: { Cookie: value } }))).json<OwnerSession>()).authenticated, false);
  }
  assert.equal((await (await route(new Request(`${origin}/api/auth/session`, { headers: { Cookie: sessionCookie } }), env, { now: now + SESSION_SECONDS * 1000 })).json<OwnerSession>()).authenticated, false);
  assert.equal((await (await route(new Request(`${origin}/api/auth/session`, { headers: { Cookie: sessionCookie } }), { ...env, GITHUB_OWNER_ID: '999' })).json<OwnerSession>()).authenticated, false);
});

test('owner routes require a session; logout requires POST and exact same origin', async () => {
  assert.equal((await route(new Request(`${origin}/api/admin/installation`))).status, 401);
  assert.equal((await route(new Request(`${origin}/api/auth/logout`))).status, 405);
  const { sessionCookie } = await complete();
  assert.ok(sessionCookie);
  const installation = await route(new Request(`${origin}/api/admin/installation`, { headers: { Cookie: sessionCookie } }));
  assert.equal(installation.status, 200);
  const origins: Record<string, string>[] = [{}, { Origin: 'https://evil.example' }, { Origin: `${origin}.evil.example` }, { Origin: origin, 'Sec-Fetch-Site': 'cross-site' }];
  for (const headers of origins) {
    const response = await route(new Request(`${origin}/api/auth/logout`, { method: 'POST', headers: { Cookie: sessionCookie, ...headers } }));
    assert.equal(response.status, 403);
  }
  const response = await route(new Request(`${origin}/api/auth/logout`, { method: 'POST', headers: { Cookie: sessionCookie, Origin: origin } }));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Set-Cookie')!, /Max-Age=0/);
  assert.equal(cookieValue(new Request(origin, { headers: { Cookie: 'x=1; x=2' } }), 'x'), null);
});

test('auth endpoints reject unsupported methods and untrusted callback origins', async () => {
  assert.equal((await route(new Request(`${origin}/api/auth/login`, { method: 'POST' }))).status, 405);
  assert.equal((await route(new Request('https://evil.example/api/auth/login'))).status, 400);
  assert.equal((await route(new Request('https://evil.example/api/auth/callback?code=code'))).status, 400);
});

test('legacy signed cookies and missing persistent storage cannot authorize owner operations', async () => {
  const legacy = await signCookie({ purpose: 'owner-session', sub: env.GITHUB_OWNER_ID, login: 'rdpollard', iat: nowSeconds, exp: nowSeconds + SESSION_SECONDS }, env.SESSION_SECRET!);
  const legacyRequest = new Request(`${origin}/api/auth/session`, { headers: { Cookie: `${SESSION_COOKIE}=${legacy}` } });
  assert.equal((await (await route(legacyRequest)).json<OwnerSession>()).authenticated, false);
  const unbound = await authRoute(new Request(`${origin}/api/auth/session`), env, { now });
  assert.ok(unbound);
  assert.equal((await unbound.json<OwnerSession>()).configured, false);
  assert.equal((await authRoute(new Request(`${origin}/api/auth/login`), env, { now }))!.status, 503);
});

test('store failures fail closed and redact storage exceptions from responses and logs', async t => {
  const logged: unknown[] = [];
  t.mock.method(console, 'warn', (value: unknown) => { logged.push(value); });
  const { sessionCookie } = await complete();
  assert.ok(sessionCookie);
  const failing: SessionStore = { ...sessions,
    async active() { throw new Error('private-sql-and-session-detail'); },
  };
  const response = await route(new Request(`${origin}/api/auth/session`, { headers: { Cookie: sessionCookie } }), env, { sessions: failing });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'Owner session storage unavailable' });
  assert.deepEqual(logged, [{ event: 'owner_session_unavailable' }]);
});
