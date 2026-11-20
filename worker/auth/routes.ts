import type { OwnerSession, SignInOutcome } from '../../shared/contracts.ts';
import { authConfig, type AuthConfig, type Bindings } from './config.ts';
import {
  challenge, clearCookie, cookieValue, matchesNonce, OAUTH_COOKIE, OAUTH_SECONDS,
  randomToken, readSignedCookie, SESSION_COOKIE, SESSION_SECONDS, setCookie, signCookie,
} from './cookies.ts';
import { GitHubAuthError, githubIdentity, type Fetcher } from './github.ts';
import { checkRepositoryAccess, DiscoveryError } from '../github/discovery.ts';
import { DatabaseSessions, type SessionStore } from './sessions.ts';
import { MonitoringScopeStore, ScopeError, scopeKey } from '../github/scope-store.ts';

export const privateHeaders = {
  'Cache-Control': 'no-store', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

function json(data: object, status = 200, extra: Record<string, string> = {}): Response {
  return Response.json(data, { status, headers: { ...privateHeaders, ...extra } });
}

function redirect(origin: string, path: string, cookies: string[]): Response {
  const headers = new Headers({ ...privateHeaders, Location: new URL(path, origin).href });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(null, { status: 303, headers });
}

function validTimes(payload: Record<string, unknown>, now: number, lifetime: number): boolean {
  return typeof payload.iat === 'number' && Number.isSafeInteger(payload.iat) &&
    typeof payload.exp === 'number' && Number.isSafeInteger(payload.exp) &&
    payload.iat <= now && payload.exp > now && payload.exp - payload.iat === lifetime;
}

async function session(request: Request, config: AuthConfig | null, sessions: SessionStore | null, now: number): Promise<{ view: OwnerSession; id: string | null }> {
  const view: OwnerSession = { configured: !!config && !!sessions, authenticated: false, owner: null, installationUrl: null };
  const result = { view, id: null };
  if (!config || !sessions) return result;
  const payload = await readSignedCookie(cookieValue(request, SESSION_COOKIE), config.sessionSecret);
  if (!payload || payload.purpose !== 'owner-session' || payload.sub !== config.ownerId ||
    !validTimes(payload, now, SESSION_SECONDS) || typeof payload.login !== 'string' ||
    !/^[A-Za-z0-9-]{1,39}$/.test(payload.login) || typeof payload.sid !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(payload.sid)) return result;
  if (!await sessions.active(payload.sid, config.ownerId, payload.login, payload.iat as number, payload.exp as number, now)) return result;
  return {
    id: payload.sid,
    view: {
      ...view, authenticated: true, owner: { id: config.ownerId, login: payload.login },
      installationUrl: config.appSlug ? `https://github.com/apps/${config.appSlug}/installations/new` : null,
    },
  };
}

// Explicit dependencies make provider failures and cookie lifetimes testable.
interface AuthOptions { fetcher?: Fetcher; now?: number; sessions?: SessionStore; }

export async function authRoute(request: Request, env: Bindings, options: AuthOptions = {}): Promise<Response | null> {
  const url = new URL(request.url);
  const routes = new Map([
    ['/api/auth/session', 'GET'], ['/api/auth/login', 'GET'],
    ['/api/auth/callback', 'GET'], ['/api/auth/logout', 'POST'], ['/api/auth/logout-all', 'POST'], ['/api/admin/installation', 'GET'],
    ['/api/admin/repositories', 'GET'],
    ['/api/admin/monitoring', 'GET, POST, DELETE'],
  ]);
  const method = routes.get(url.pathname);
  if (!method) return null;
  if (!method.split(', ').includes(request.method)) return json({ error: 'Method not allowed' }, 405, { Allow: method });
  try { return await configuredAuthRoute(request, env, options, url); }
  catch {
    // Storage exceptions can contain SQL, bindings or implementation details.
    const monitoring = url.pathname === '/api/admin/monitoring';
    console.warn({ event: monitoring ? 'monitoring_scope_unavailable' : 'owner_session_unavailable' });
    return json({ error: monitoring ? 'Monitoring scope storage unavailable' : 'Owner session storage unavailable' }, 503);
  }
}

async function configuredAuthRoute(request: Request, env: Bindings, options: AuthOptions, url: URL): Promise<Response> {
  const config = authConfig(env);
  const now = Math.floor((options.now ?? Date.now()) / 1000);
  const sessions = options.sessions ?? (env.DB ? new DatabaseSessions(env.DB) : null);
  if (url.pathname === '/api/auth/session') return json((await session(request, config, sessions, now)).view);
  if (!config || !sessions) return json({ error: 'Owner sign-in is not configured' }, 503);
  if (url.origin !== config.origin) return json({ error: 'Unexpected application origin' }, 400);

  if (url.pathname === '/api/auth/login') {
    const nonce = randomToken();
    const verifier = randomToken();
    const value = await signCookie({ purpose: 'oauth-state', nonce, verifier, iat: now, exp: now + OAUTH_SECONDS }, config.sessionSecret);
    const authorize = new URL('https://github.com/login/oauth/authorize');
    authorize.search = new URLSearchParams({
      client_id: config.clientId, redirect_uri: `${config.origin}/api/auth/callback`,
      state: nonce, code_challenge: await challenge(verifier), code_challenge_method: 'S256', allow_signup: 'false',
    }).toString();
    return new Response(null, {
      status: 302, headers: { ...privateHeaders, Location: authorize.href, 'Set-Cookie': setCookie(OAUTH_COOKIE, value, OAUTH_SECONDS) },
    });
  }

  if (url.pathname === '/api/auth/callback') {
    const expiredCookie = clearCookie(OAUTH_COOKIE);
    const fail = (reason: Exclude<SignInOutcome, 'success'>) => {
      console.warn({ event: 'github_signin_failed', reason });
      return redirect(config.origin, `/settings?sign_in=${reason}`, [expiredCookie]);
    };
    const payload = await readSignedCookie(cookieValue(request, OAUTH_COOKIE), config.sessionSecret);
    const state = url.searchParams.get('state');
    const code = url.searchParams.get('code');
    // Reject duplicate query/cookie values, expired/tampered state, and callbacks
    // without the browser-bound verifier before making any external request.
    if (!payload || payload.purpose !== 'oauth-state' || !validTimes(payload, now, OAUTH_SECONDS) ||
      typeof payload.nonce !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(payload.nonce) ||
      typeof payload.verifier !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(payload.verifier) ||
      !state || !/^[A-Za-z0-9_-]{43}$/.test(state) || url.searchParams.getAll('state').length !== 1 ||
      !await matchesNonce(state, payload.nonce, config.sessionSecret)) return fail('state');
    if (url.searchParams.has('error')) return fail('cancelled');
    if (!code || code.length > 512 || url.searchParams.getAll('code').length !== 1) return fail('verification');
    try {
      const user = await githubIdentity({
        clientId: config.clientId, clientSecret: config.clientSecret, code,
        verifier: payload.verifier, redirectUri: `${config.origin}/api/auth/callback`,
      }, options.fetcher ?? fetch);
      if (user.id !== config.ownerId) return fail('denied');
      const sid = randomToken();
      await sessions.create(sid, user.id, user.login, now, now + SESSION_SECONDS);
      const value = await signCookie({
        purpose: 'owner-session', sub: user.id, login: user.login, sid,
        iat: now, exp: now + SESSION_SECONDS,
      }, config.sessionSecret);
      return redirect(config.origin, '/settings?sign_in=success', [
        expiredCookie, setCookie(SESSION_COOKIE, value, SESSION_SECONDS),
      ]);
    } catch (error) {
      // Never log the provider exception, response body, code or callback URL.
      return fail(error instanceof GitHubAuthError ? error.reason : 'failed');
    }
  }

  const current = await session(request, config, sessions, now);
  const owner = current.view;
  if (!owner.authenticated) return json({ error: 'Owner sign-in required' }, 401);
  if (url.pathname === '/api/admin/monitoring') {
    if (request.headers.get('Sec-Fetch-Site') === 'cross-site' ||
      (request.method !== 'GET' && request.headers.get('Origin') !== config.origin)) return json({ error: 'Invalid request origin' }, 403);
    if (!env.DB) return json({ error: 'Monitoring scope storage unavailable' }, 503);
    const store = new MonitoringScopeStore(env.DB);
    if (request.method === 'DELETE') return json(await store.disconnect());
    let key: string;
    try { key = scopeKey(env, config, owner.owner!.login); }
    catch { return json({ error: 'Monitoring scope configuration unavailable', reason: 'configuration' }, 503); }
    const saved = await store.read(key);
    if (request.method === 'GET') return json(saved);
    try {
      // A fresh server-side check is mandatory. Ignore caller bodies/query
      // parameters; an old browser inventory cannot authorize a saved scope.
      const report = await checkRepositoryAccess(env, config, owner.owner!.login, {
        fetcher: options.fetcher, now: options.now,
      });
      return json(await store.save(key, saved.revision, report));
    } catch (error) {
      if (error instanceof ScopeError) return json({ error: 'Monitoring scope was not saved', reason: error.reason }, 409);
      if (error instanceof DiscoveryError) return json({ error: 'Repository discovery unavailable', reason: error.reason }, 503);
      throw error;
    }
  }
  if (url.pathname === '/api/admin/repositories') {
    if (request.headers.get('Sec-Fetch-Site') === 'cross-site') return json({ error: 'Invalid request origin' }, 403);
    try {
      return json(await checkRepositoryAccess(env, config, owner.owner!.login, {
        fetcher: options.fetcher, now: options.now,
      }));
    } catch (error) {
      const reason = error instanceof DiscoveryError ? error.reason : 'unavailable';
      console.warn({ event: 'github_discovery_failed', reason });
      return json({ error: 'Repository discovery unavailable', reason }, 503);
    }
  }
  if (url.pathname === '/api/auth/logout' || url.pathname === '/api/auth/logout-all') {
    if (request.headers.get('Origin') !== config.origin ||
      request.headers.get('Sec-Fetch-Site') === 'cross-site') return json({ error: 'Invalid request origin' }, 403);
    if (url.pathname === '/api/auth/logout-all') await sessions.revokeAll(config.ownerId);
    else await sessions.revoke(current.id!, config.ownerId);
    return json({ ok: true }, 200, { 'Set-Cookie': clearCookie(SESSION_COOKIE) });
  }
  if (!owner.installationUrl) return json({ error: 'GitHub App installation is not configured' }, 503);
  return json({ installationUrl: owner.installationUrl });
}
