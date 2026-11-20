import type { DiscoveryFailure } from '../../shared/contracts.ts';
import type { Fetcher } from '../auth/github.ts';

export class DiscoveryError extends Error {
  readonly reason: DiscoveryFailure;
  constructor(reason: DiscoveryFailure) { super('Repository discovery failed'); this.name = 'DiscoveryError'; this.reason = reason; }
}

export interface GitHubBudget { remaining: number; deadlineAt?: number; }

async function object(response: Response): Promise<Record<string, unknown>> {
  if (!response.body) throw new DiscoveryError('unavailable');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let body = '';
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > 2_097_152) { await reader.cancel(); throw new DiscoveryError('incomplete'); }
      body += decoder.decode(next.value, { stream: true });
    }
    body += decoder.decode();
  } finally { reader.releaseLock(); }
  const result: unknown = JSON.parse(body);
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new DiscoveryError('unavailable');
  return result as Record<string, unknown>;
}

// Callers generate paths locally; provider pagination and URL fields are never
// destinations. Both discovery and Actions share the same bounded transport.
export async function githubRequest(path: string, token: string, fetcher: Fetcher, budget: GitHubBudget, options: {
  body?: object; missing?: DiscoveryFailure;
} = {}) {
  const timeout = Math.min(10_000, (budget.deadlineAt ?? Date.now() + 10_000) - Date.now());
  if (budget.remaining-- <= 0 || timeout <= 0) throw new DiscoveryError('incomplete');
  if (!path.startsWith('/') || path.startsWith('//')) throw new DiscoveryError('unavailable');
  const response = await fetcher(`https://api.github.com${path}`, {
    method: options.body ? 'POST' : 'GET', redirect: 'manual', signal: AbortSignal.timeout(timeout),
    headers: {
      Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`,
      'User-Agent': 'GitHub-Nanny', 'X-GitHub-Api-Version': '2026-03-10',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 401) throw new DiscoveryError('authentication');
    if (response.status === 429 || (response.status === 403 && response.headers.get('X-RateLimit-Remaining') === '0')) throw new DiscoveryError('rate_limited');
    if (response.status === 403 || response.status === 422) throw new DiscoveryError('permissions');
    if (response.status === 404 && options.missing) throw new DiscoveryError(options.missing);
    throw new DiscoveryError('unavailable');
  }
  return { data: await object(response), link: response.headers.get('Link') };
}
