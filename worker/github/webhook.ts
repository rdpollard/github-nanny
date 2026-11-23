import type { Bindings } from '../auth/config.ts';
import { authConfig, webhookConfigured } from '../auth/config.ts';
import { MonitoringScopeStore } from './scope-store.ts';
import { MonitorStore } from '../monitor-store.ts';
import { WebhookStore, WEBHOOK_RETENTION_MS } from './webhook-store.ts';

const MAX_BYTES = 1_048_576;
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const reply = (status: number, error?: string) => Response.json(error ? { error } : { ok: true }, { status, headers });
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const id = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

export async function verifySignature(body: Uint8Array<ArrayBuffer>, signature: string, secret: string): Promise<boolean> {
  if (!/^sha256=[0-9a-f]{64}$/i.test(signature)) return false;
  const digest = Uint8Array.from(signature.slice(7).match(/../g)!, pair => parseInt(pair, 16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  return crypto.subtle.verify('HMAC', key, digest, body);
}

async function bodyBytes(request: Request): Promise<Uint8Array<ArrayBuffer> | null> {
  const length = request.headers.get('Content-Length');
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) return null;
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); return null; }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function webhookRoute(request: Request, env: Bindings): Promise<Response | null> {
  if (new URL(request.url).pathname !== '/api/webhooks/github') return null;
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405, headers: { ...headers, Allow: 'POST' } });
  const secret = env.GITHUB_WEBHOOK_SECRET;
  const config = authConfig(env);
  if (!config || !secret || !webhookConfigured(env)) return reply(503, 'Webhook receiver is not configured');
  if (new URL(request.url).origin !== config.origin) return reply(400, 'Unexpected application origin');
  const signature = request.headers.get('X-Hub-Signature-256') ?? '';
  if (!/^sha256=[0-9a-f]{64}$/i.test(signature)) return reply(401, 'Invalid webhook signature');
  const delivery = request.headers.get('X-GitHub-Delivery') ?? '';
  const event = request.headers.get('X-GitHub-Event') ?? '';
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(delivery) || !/^[a-z_]{1,64}$/.test(event)) return reply(400, 'Invalid webhook headers');
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return reply(415, 'JSON payload required');
  try {
    const bytes = await bodyBytes(request);
    if (!bytes) return reply(413, 'Webhook payload too large');
    if (!await verifySignature(bytes, signature, secret)) return reply(401, 'Invalid webhook signature');
    let payload: unknown;
    try { payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { return reply(400, 'Invalid webhook payload'); }
    if (!object(payload)) return reply(400, 'Invalid webhook payload');
    if (event === 'ping') return reply(200);
    if (!['workflow_run', 'repository', 'installation', 'installation_repositories'].includes(event)) return reply(202);
    if (!env.DB) return reply(503, 'Webhook storage unavailable');
    const scopes = new MonitoringScopeStore(env.DB);
    const configured = await scopes.configured(env, config);
    if (!configured) return reply(202);
    const { key, scope, accounts } = configured;
    const invalidate = () => scopes.invalidate(key, scope.revision, delivery.toLowerCase(), Date.now());
    if (!object(payload.installation) || !id(payload.installation.id)) return reply(400, 'Invalid webhook payload');
    const installationId = payload.installation.id;
    const account = accounts.find(account => account.installationId === installationId);
    if (!account) return reply(202);
    if (event === 'installation') {
      if (!object(payload.installation.account) || String(payload.installation.account.id) !== account.id) return reply(400, 'Invalid webhook payload');
      if (['deleted', 'suspend', 'new_permissions_accepted'].includes(String(payload.action))) await invalidate();
      return reply(202);
    }
    if (event === 'installation_repositories') {
      const removed = payload.repositories_removed;
      if (!Array.isArray(removed)) return reply(400, 'Invalid webhook payload');
      if ((payload.repository_selection === 'selected' && account.id === config.ownerId) ||
        removed.some(repo => object(repo) && scope.repositories.some(saved => saved.id === repo.id && saved.installationId === installationId))) {
        await invalidate();
      }
      return reply(202);
    }
    if (!object(payload.repository) || !id(payload.repository.id)) return reply(400, 'Invalid webhook payload');
    const repository = payload.repository;
    const saved = scope.repositories.find(saved => saved.id === repository.id && saved.installationId === installationId);
    if (!saved) return reply(202); // No receipts, run records or activity for unmonitored/private repos.
    if (event === 'repository') {
      if (['deleted', 'privatized', 'transferred', 'renamed'].includes(String(payload.action))) await invalidate();
      return reply(202);
    }
    if (repository.private === true) { await invalidate(); return reply(202); }
    if (repository.private !== false || repository.full_name !== saved.name || !object(repository.owner) ||
      String(repository.owner.id) !== saved.accountId) return reply(400, 'Invalid webhook payload');
    if (!['requested', 'in_progress', 'completed'].includes(String(payload.action))) return reply(202);
    const run = payload.workflow_run;
    if (!object(run) || !id(run.id) || !id(run.run_attempt) || typeof run.status !== 'string' ||
      typeof run.updated_at !== 'string' || !Number.isFinite(Date.parse(run.updated_at))) return reply(400, 'Invalid webhook payload');
    const terminal = payload.action === 'completed';
    if (terminal ? run.status !== 'completed' : !['queued', 'in_progress', 'requested', 'waiting', 'pending'].includes(run.status)) return reply(400, 'Invalid webhook payload');
    if (run.repository !== undefined && (!object(run.repository) || run.repository.id !== saved.id || run.repository.private !== false)) return reply(400, 'Invalid webhook payload');
    const now = Date.now();
    const updatedAt = Date.parse(run.updated_at);
    if (updatedAt < now - WEBHOOK_RETENTION_MS || updatedAt > now + 300_000 ||
      updatedAt < Math.floor(Date.parse(scope.verifiedAt!) / 1000) * 1000) return reply(202);
    await new MonitorStore(env.DB).begin(key, scope); // Repair deployment-overlap mismatches before event writes.
    await new WebhookStore(env.DB).record(key, scope, delivery.toLowerCase(), {
      repositoryId: saved.id, runId: run.id, attempt: run.run_attempt, status: run.status, terminal, updatedAt,
      url: `https://github.com/${saved.name}/actions/runs/${run.id}/attempts/${run.run_attempt}`,
    }, now);
    return reply(202);
  } catch {
    console.warn({ event: 'github_webhook_unavailable' });
    return reply(503, 'Webhook processing unavailable');
  }
}
