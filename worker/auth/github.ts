import type { SignInOutcome } from '../../shared/contracts.ts';

export type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type ProviderFailure = Extract<SignInOutcome, 'credentials' | 'verification' | 'callback' | 'provider' | 'identity'>;

export class GitHubAuthError extends Error {
  readonly reason: ProviderFailure;

  constructor(reason: ProviderFailure) {
    super('GitHub sign-in failed');
    this.name = 'GitHubAuthError';
    this.reason = reason;
  }
}

async function boundedJson(response: Response, allowErrorResponse = false): Promise<Record<string, unknown>> {
  if ((response.status >= 300 && response.status < 400) ||
    (!response.ok && !allowErrorResponse) || !response.body) {
    await response.body?.cancel();
    throw new Error('GitHub request failed');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let body = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 32_768) { await reader.cancel(); throw new Error('GitHub response too large'); }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
  } finally { reader.releaseLock(); }
  const result: unknown = JSON.parse(body);
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Invalid GitHub response');
  return result as Record<string, unknown>;
}

export async function githubIdentity(input: {
  clientId: string; clientSecret: string; code: string; verifier: string; redirectUri: string;
}, fetcher: Fetcher): Promise<{ id: string; login: string }> {
  let stage: 'provider' | 'identity' = 'provider';
  try {
    // Authorization codes and client secrets go in a POST body, never in URLs.
    // Workers supports manual/follow, not redirect: 'error'. Use manual and
    // reject 3xx responses so credentials never follow an upstream redirect.
    const exchange = await fetcher('https://github.com/login/oauth/access_token', {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10_000),
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'GitHub-Nanny' },
      body: JSON.stringify({
        client_id: input.clientId, client_secret: input.clientSecret, code: input.code,
        code_verifier: input.verifier, redirect_uri: input.redirectUri,
      }),
    });
    // OAuth errors may use either 200 or 400. Read only a bounded body and map
    // known identifiers; descriptions, credentials and URLs are never propagated.
    const token = await boundedJson(exchange, true);
    if (Object.hasOwn(token, 'error')) {
      switch (token.error) {
        case 'incorrect_client_credentials': throw new GitHubAuthError('credentials');
        case 'bad_verification_code': throw new GitHubAuthError('verification');
        case 'redirect_uri_mismatch': throw new GitHubAuthError('callback');
        default: throw new GitHubAuthError('provider');
      }
    }
    if (!exchange.ok || typeof token.access_token !== 'string' || token.access_token.length > 4096 ||
      token.access_token.length < 1 || token.token_type !== 'bearer') throw new GitHubAuthError('provider');
    stage = 'identity';
    const user = await boundedJson(await fetcher('https://api.github.com/user', {
      redirect: 'manual', signal: AbortSignal.timeout(10_000),
      headers: {
        Accept: 'application/vnd.github+json', Authorization: `Bearer ${token.access_token}`,
        'User-Agent': 'GitHub-Nanny', 'X-GitHub-Api-Version': '2026-03-10',
      },
    }));
    if (typeof user.id !== 'number' || !Number.isSafeInteger(user.id) || user.id < 1 ||
      typeof user.login !== 'string' || !/^[A-Za-z0-9-]{1,39}$/.test(user.login)) throw new Error('Invalid GitHub user');
    // The identity token is not persisted or sent to the browser. Repository work
    // will use installation tokens in the subsequent tracking milestone.
    return { id: String(user.id), login: user.login };
  } catch (error) {
    if (error instanceof GitHubAuthError) throw error;
    throw new GitHubAuthError(stage);
  }
}
