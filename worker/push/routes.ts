import { buildPushPayload } from '@block65/webcrypto-web-push';
import type { AuthConfig, Bindings } from '../auth/config.ts';
import type { Fetcher } from '../auth/github.ts';
import { retryTimestamp } from '../github/client.ts';
import { pushConfig } from './config.ts';
import { DeviceStore, PushFault } from './devices.ts';

const headers = { 'Cache-Control': 'no-store', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const json = (value: object, status = 200) => Response.json(value, { status, headers });

async function body(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new PushFault(415, 'JSON request required');
  const length = request.headers.get('Content-Length');
  if (length && (!/^\d+$/.test(length) || Number(length) > 4096)) throw new PushFault(413, 'Push request too large');
  const reader = request.body?.getReader();
  if (!reader) throw new PushFault(400, 'Invalid push request');
  let size = 0;
  let text = '';
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 4096) { await reader.cancel(); throw new PushFault(413, 'Push request too large'); }
      text += decoder.decode(next.value, { stream: true });
    }
    text += decoder.decode();
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid object');
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof PushFault) throw error;
    throw new PushFault(400, 'Invalid push request');
  } finally { reader.releaseLock(); }
}

// Called only after the common owner session/origin checks. This milestone
// sends an explicit test, never an idle assertion or an automatic notification.
export async function pushRoute(request: Request, env: Bindings, owner: AuthConfig, fetcher: Fetcher = fetch): Promise<Response> {
  if (request.headers.get('Sec-Fetch-Site') === 'cross-site' ||
    (request.method !== 'GET' && request.headers.get('Origin') !== owner.origin)) return json({ error: 'Invalid request origin' }, 403);
  try {
    const config = await pushConfig(env);
    if (!config || !env.DB) return request.method === 'GET' ? json({ configured: false, applicationServerKey: null, devices: [] })
      : json({ error: 'Push setup is not configured' }, 503);
    const store = new DeviceStore(env.DB, config, owner.ownerId);
    if (request.method === 'GET') return json({ configured: true, applicationServerKey: config.vapid.publicKey, devices: await store.list() });
    const value = await body(request);
    if (request.method === 'POST' && new URL(request.url).pathname === '/api/admin/push') {
      const id = await store.save(value.label, value.subscription);
      return json({ id }, 201);
    }
    if (typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.id)) throw new PushFault(400, 'Invalid device');
    if (request.method === 'DELETE') { await store.remove(value.id); return json({ ok: true }); }
    const device = await store.claim(value.id);
    try {
      const payload = await buildPushPayload({ data: { version: 1, kind: 'test', title: 'GitHub Nanny test',
        body: 'This is a test notification from GitHub Nanny.', path: '/' },
        options: { ttl: 60, urgency: 'normal', topic: 'nanny-test' } }, device.subscription, config.vapid);
      const response = await fetcher(device.subscription.endpoint, { ...payload, redirect: 'manual', signal: AbortSignal.timeout(10_000) });
      await response.body?.cancel();
      if (response.status === 404 || response.status === 410) {
        await store.finish(device, 'expired');
        return json({ error: 'This subscription expired; register this browser again' }, 410);
      }
      if (!response.ok) {
        const temporary = response.status === 429 || response.status >= 500;
        await store.finish(device, temporary ? 'temporary' : 'rejected', retryTimestamp(response.headers));
        return json({ error: temporary ? 'The push service is temporarily unavailable; wait before retrying' : 'The push service rejected the test. Check push configuration or register the browser again' }, 503);
      }
      await store.finish(device, 'accepted');
      return json({ accepted: true, message: 'The push service accepted the test. Confirm that this device displayed it.' }, 202);
    } catch {
      await store.finish(device, 'unavailable');
      return json({ error: 'The test could not be confirmed. Wait at least a minute before retrying.' }, 503);
    }
  } catch (error) {
    if (error instanceof PushFault) return json({ error: error.message }, error.status);
    console.warn({ event: 'owner_push_unavailable' });
    return json({ error: 'Push settings are unavailable. Please try again.' }, 503);
  }
}
