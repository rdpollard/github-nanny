import type { PushSubscription } from '@block65/webcrypto-web-push';
import type { PushDevice } from '../../shared/contracts.ts';
import { decode, encode, type PushConfig } from './config.ts';

export class PushFault extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export function endpointAllowed(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== 'string' || endpoint.length > 2048) return false;
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash && url.pathname.length > 1 &&
      (['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'].includes(url.hostname) ||
        /^[a-z0-9-]+\.notify\.windows\.com$/.test(url.hostname));
  } catch { return false; }
}

export async function subscription(value: unknown, now = Date.now()): Promise<PushSubscription> {
  if (!object(value) || !endpointAllowed(value.endpoint) || !object(value.keys) ||
    !(value.expirationTime === null || (typeof value.expirationTime === 'number' && Number.isSafeInteger(value.expirationTime) &&
      value.expirationTime > now && value.expirationTime < 8.64e15))) throw new PushFault(400, 'Invalid or unsupported push subscription');
  try {
    const publicKey = decode(value.keys.p256dh, 65);
    decode(value.keys.auth, 16);
    if (publicKey[0] !== 4) throw new Error('Invalid point');
    await crypto.subtle.importKey('raw', publicKey, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    return { endpoint: value.endpoint, expirationTime: value.expirationTime as number | null,
      keys: { p256dh: value.keys.p256dh as string, auth: value.keys.auth as string } };
  } catch { throw new PushFault(400, 'Invalid or unsupported push subscription'); }
}

interface DeviceRow {
  id: string; owner_id: string; label: string; key_id: string; encrypted: string; created_at: number;
  updated_at: number; expires_at: number | null; test_not_before: number; last_test_at: number | null;
  last_result: PushDevice['lastResult']; send_token: string | null;
}
export interface ClaimedDevice { id: string; token: string; subscription: PushSubscription; }

export class DeviceStore {
  private readonly db: D1DatabaseSession;
  private readonly config: PushConfig;
  private readonly owner: string;
  constructor(db: Cloudflare.Env['DB'], config: PushConfig, owner: string) {
    this.db = db.withSession('first-primary'); this.config = config; this.owner = owner;
  }
  private aad(id: string) { return new TextEncoder().encode(`push-device:${this.owner}:${id}:${this.config.keyId}`); }
  async list(): Promise<PushDevice[]> {
    const rows = await this.db.prepare('SELECT id, label, key_id, created_at, expires_at, last_test_at, last_result, test_not_before FROM push_devices WHERE owner_id = ? ORDER BY created_at, id').bind(this.owner).all<DeviceRow>();
    if (!rows.success) throw new Error('Push storage unavailable');
    return rows.results.map(row => ({ id: row.id, label: row.label, ready: row.key_id === this.config.keyId,
      createdAt: new Date(row.created_at).toISOString(), expiresAt: row.expires_at === null ? null : new Date(row.expires_at).toISOString(),
      lastTestAt: row.last_test_at === null ? null : new Date(row.last_test_at).toISOString(), lastResult: row.last_result,
      testNotBefore: new Date(row.test_not_before).toISOString() }));
  }
  async save(label: unknown, value: unknown): Promise<string> {
    if (typeof label !== 'string' || !label.trim() || label.length > 60 || /[\u0000-\u001f\u007f]/.test(label)) throw new PushFault(400, 'Use a device name of 1–60 characters');
    const clean = await subscription(value);
    const id = encode(new Uint8Array(await crypto.subtle.sign('HMAC', this.config.identity, new TextEncoder().encode(`${this.owner}:${clean.endpoint}`))));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: this.aad(id) }, this.config.storage, new TextEncoder().encode(JSON.stringify(clean)));
    const encrypted = `${encode(iv)}.${encode(new Uint8Array(ciphertext))}`;
    const now = Date.now();
    const row = await this.db.prepare(`INSERT INTO push_devices (id, owner_id, label, key_id, encrypted, created_at, updated_at, expires_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE (SELECT count(*) FROM push_devices WHERE owner_id = ?) < 10
        OR EXISTS (SELECT 1 FROM push_devices WHERE id = ? AND owner_id = ?)
      ON CONFLICT(id) DO UPDATE SET label = excluded.label, key_id = excluded.key_id, encrypted = excluded.encrypted,
        updated_at = excluded.updated_at, expires_at = excluded.expires_at, send_token = NULL, last_test_at = NULL, last_result = NULL,
        revision = push_devices.revision + 1
      WHERE push_devices.owner_id = excluded.owner_id RETURNING id`)
      .bind(id, this.owner, label.trim(), this.config.keyId, encrypted, now, now, clean.expirationTime, this.owner, id, this.owner).first<{ id: string }>();
    if (!row) throw new PushFault(409, 'Remove an old device before adding another; the limit is ten');
    return row.id;
  }
  async remove(id: string): Promise<void> {
    const result = await this.db.prepare('DELETE FROM push_devices WHERE id = ? AND owner_id = ?').bind(id, this.owner).run();
    if (!result.success) throw new Error('Push storage unavailable');
  }
  async forDelivery(id: string, revision: number): Promise<PushSubscription | null> {
    const row = await this.db.prepare('SELECT encrypted FROM push_devices WHERE id = ? AND owner_id = ? AND key_id = ? AND revision = ?')
      .bind(id, this.owner, this.config.keyId, revision).first<{ encrypted: string }>();
    if (!row) return null;
    const [iv, ciphertext, extra] = row.encrypted.split('.');
    if (extra !== undefined) throw new Error('Invalid ciphertext');
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(iv, 12), additionalData: this.aad(id) }, this.config.storage, decode(ciphertext));
    return subscription(JSON.parse(new TextDecoder().decode(plaintext)));
  }
  async claim(id: string, now = Date.now()): Promise<ClaimedDevice> {
    const token = crypto.randomUUID();
    const row = await this.db.prepare(`UPDATE push_devices SET send_token = ?, test_not_before = ?, last_test_at = ?, last_result = NULL
      WHERE id = ? AND owner_id = ? AND key_id = ? AND test_not_before <= ? RETURNING *`)
      .bind(token, now + 60_000, now, id, this.owner, this.config.keyId, now).first<DeviceRow>();
    if (!row) throw new PushFault(409, 'Device unavailable or recently tested. Reload and wait at least a minute before retrying');
    if (row.expires_at !== null && row.expires_at <= now) {
      await this.finish({ id, token }, 'expired');
      throw new PushFault(410, 'This push subscription expired; register this browser again');
    }
    try {
      const [iv, ciphertext, extra] = row.encrypted.split('.');
      if (extra !== undefined) throw new Error('Invalid ciphertext');
      const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(iv, 12), additionalData: this.aad(id) }, this.config.storage, decode(ciphertext));
      return { id, token, subscription: await subscription(JSON.parse(new TextDecoder().decode(plaintext)), now) };
    } catch {
      await this.finish({ id, token }, 'unavailable');
      throw new PushFault(409, 'Device data could not be verified; remove it and register this browser again');
    }
  }
  async finish(device: Pick<ClaimedDevice, 'id' | 'token'>, outcome: PushDevice['lastResult'] | 'expired', retryAt = 0): Promise<void> {
    const query = outcome === 'expired'
      ? this.db.prepare('DELETE FROM push_devices WHERE id = ? AND owner_id = ? AND send_token = ?').bind(device.id, this.owner, device.token)
      : this.db.prepare('UPDATE push_devices SET last_result = ?, test_not_before = max(test_not_before, ?), send_token = NULL WHERE id = ? AND owner_id = ? AND send_token = ?')
        .bind(outcome, retryAt, device.id, this.owner, device.token);
    if (!(await query.run()).success) throw new Error('Push storage unavailable');
  }
}
