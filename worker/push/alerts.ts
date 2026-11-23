import type { AlertSettings } from '../../shared/contracts.ts';
import type { AuthConfig, Bindings } from '../auth/config.ts';
import { webhookConfigured } from '../auth/config.ts';
import { MonitoringScopeStore } from '../github/scope-store.ts';
import { pushConfig, type PushConfig } from './config.ts';
import { PushFault } from './devices.ts';

export class AlertStore {
  private readonly db: D1DatabaseSession;
  constructor(db: Cloudflare.Env['DB']) { this.db = db.withSession('first-primary'); }

  async status(env: Bindings, owner: AuthConfig, config: PushConfig | null): Promise<AlertSettings> {
    const scope = await new MonitoringScopeStore(env.DB!).configured(env, owner);
    const row = await this.db.prepare(`SELECT c.enabled, m.notice_enabled, a.owner_id, a.config_id,
      c.scope_revision = s.revision AND m.scope_revision = s.revision AND s.scope_json IS NOT NULL AS prepared
      FROM monitoring_scope s JOIN monitor_control c USING(singleton) JOIN monitor_state m USING(singleton)
      JOIN alert_control a USING(singleton) WHERE s.singleton = 1`)
      .first<{ enabled: number; notice_enabled: number; owner_id: string | null; config_id: string | null; prepared: number }>();
    if (!row) throw new Error('Alert storage unavailable');
    const devices = config ? await this.db.prepare('SELECT count(*) AS n FROM push_devices WHERE owner_id = ? AND key_id = ? AND (expires_at IS NULL OR expires_at > ?)')
      .bind(owner.ownerId, config.keyId, Date.now()).first<{ n: number }>() : null;
    const monitoring = !!scope && row.prepared === 1 && row.enabled === 1 && webhookConfigured(env);
    const counts = await this.db.prepare(`SELECT coalesce(sum(d.status IN ('queued','sending')),0) AS pending,
      coalesce(sum(d.status IN ('rejected','exhausted')),0) AS issues FROM idle_deliveries d
      JOIN push_devices p ON p.id = d.device_id WHERE p.owner_id = ? AND p.revision = d.device_revision`)
      .bind(owner.ownerId).first<{ pending: number; issues: number }>();
    return { configured: !!config, monitoring, enabled: monitoring && !!config && row.notice_enabled === 1 &&
      row.owner_id === owner.ownerId && row.config_id === config.configId, deviceCount: devices?.n ?? 0,
      pendingDevices: counts?.pending ?? 0, deliveryIssues: counts?.issues ?? 0 };
  }

  async enable(key: string, scopeRevision: number, ownerId: string, config: PushConfig): Promise<void> {
    const marker = crypto.randomUUID();
    const result = await this.db.batch([
      this.db.prepare(`UPDATE monitor_state SET revision = revision + 1, notice_enabled = 1, phase = 'unknown',
        activity_observed = 0, empty_since = NULL, last_complete_at = NULL, runs_json = '[]', last_run_url = NULL, commit_key = ?
        WHERE singleton = 1 AND scope_revision = ? AND EXISTS
        (SELECT 1 FROM monitoring_scope s JOIN monitor_control c USING(singleton) WHERE s.revision = ? AND s.config_key = ?
          AND s.scope_json IS NOT NULL AND c.enabled = 1 AND c.scope_revision = s.revision)
        AND EXISTS (SELECT 1 FROM push_devices WHERE owner_id = ? AND key_id = ? AND (expires_at IS NULL OR expires_at > ?))
        AND NOT (notice_enabled = 1 AND EXISTS (SELECT 1 FROM alert_control WHERE singleton = 1 AND owner_id = ? AND config_id = ?))
        RETURNING singleton`).bind(marker, scopeRevision, scopeRevision, key, ownerId, config.keyId, Date.now(), ownerId, config.configId),
      this.db.prepare(`UPDATE alert_control SET owner_id = ?, key_id = ?, config_id = ? WHERE singleton = 1
        AND EXISTS (SELECT 1 FROM monitor_state WHERE singleton = 1 AND commit_key = ?)`).bind(ownerId, config.keyId, config.configId, marker),
      this.db.prepare('DELETE FROM idle_outbox WHERE EXISTS (SELECT 1 FROM monitor_state WHERE singleton = 1 AND commit_key = ?)').bind(marker),
    ]);
    if (result.some(r => !r.success)) throw new Error('Alert storage unavailable');
    if (!result[0].results.length) {
      const enabled = await this.db.prepare(`SELECT 1 AS ok FROM monitor_state m JOIN monitoring_scope s USING(singleton)
        JOIN monitor_control c USING(singleton) JOIN alert_control a USING(singleton) WHERE m.singleton = 1
        AND m.notice_enabled = 1 AND m.scope_revision = ? AND s.revision = m.scope_revision AND s.config_key = ?
        AND s.scope_json IS NOT NULL AND c.enabled = 1 AND c.scope_revision = s.revision AND a.owner_id = ? AND a.config_id = ?`)
        .bind(scopeRevision, key, ownerId, config.configId).first();
      if (!enabled) throw new PushFault(409, 'Start automatic checks and register a ready device before enabling idle alerts');
    }
  }
  async disable(): Promise<void> {
    const result = await this.db.batch([
      this.db.prepare('UPDATE monitor_state SET notice_enabled = 0, revision = revision + 1, commit_key = NULL WHERE singleton = 1'),
      this.db.prepare('UPDATE alert_control SET owner_id = NULL, key_id = NULL, config_id = NULL WHERE singleton = 1'),
      this.db.prepare('DELETE FROM idle_outbox'),
    ]);
    if (result.some(r => !r.success)) throw new Error('Alert storage unavailable');
  }
}

export async function alertRoute(request: Request, env: Bindings, owner: AuthConfig): Promise<Response> {
  const headers = { 'Cache-Control': 'no-store', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
  const json = (value: object, status = 200) => Response.json(value, { status, headers });
  if (request.headers.get('Sec-Fetch-Site') === 'cross-site' ||
    (request.method !== 'GET' && request.headers.get('Origin') !== owner.origin)) return json({ error: 'Invalid request origin' }, 403);
  try {
    if (!env.DB) throw new Error('Alert storage unavailable');
    const store = new AlertStore(env.DB);
    if (request.method === 'DELETE') await store.disable();
    const config = await pushConfig(env);
    if (request.method === 'POST') {
      if (!config || !webhookConfigured(env)) throw new PushFault(409, 'Complete push and webhook setup before enabling idle alerts');
      const scope = await new MonitoringScopeStore(env.DB).configured(env, owner);
      if (!scope) throw new PushFault(409, 'Save the public monitoring scope first');
      await store.enable(scope.key, scope.scope.revision, owner.ownerId, config);
    }
    return json(await store.status(env, owner, config));
  } catch (error) {
    if (error instanceof PushFault) return json({ error: error.message }, error.status);
    console.warn({ event: 'owner_alerts_unavailable' });
    return json({ error: 'Idle alert settings are unavailable. Please reload.' }, 503);
  }
}
