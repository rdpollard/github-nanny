import type { MonitoringControl } from '../shared/contracts.ts';

export const SCAN_INTERVAL_MS = 60_000;
export const SCAN_LEASE_MS = 45_000;
export interface ScanLease { id: string; scopeRevision: number; }
export class ControlConflict extends Error { constructor() { super('Monitoring configuration changed'); } }

export function resetControlScope(database: D1DatabaseSession): D1PreparedStatement[] {
  return [database.prepare(`UPDATE monitor_control SET scope_revision = (SELECT revision FROM monitoring_scope WHERE singleton = 1),
    enabled = 0, lease_key = NULL, lease_expires_at = 0, next_scan_at = 0, last_attempt_at = NULL,
    failures = 0, last_error = NULL, last_request_count = 0
    WHERE singleton = 1 AND scope_revision != (SELECT revision FROM monitoring_scope WHERE singleton = 1)`)];
}

export class ControlStore {
  private readonly database: Cloudflare.Env['DB'];
  constructor(database: Cloudflare.Env['DB']) { this.database = database; }

  async status(webhookConfigured: boolean, now = Date.now()): Promise<MonitoringControl> {
    const row = await this.database.withSession('first-primary').prepare(`SELECT c.*,
      s.scope_json IS NOT NULL AND c.scope_revision = s.revision AS prepared
      FROM monitor_control c JOIN monitoring_scope s ON s.singleton = c.singleton WHERE c.singleton = 1`)
      .first<{ enabled: number; prepared: number; lease_key: string | null; lease_expires_at: number; next_scan_at: number; last_error: string | null }>();
    if (!row) throw new Error('Monitor control unavailable');
    const enabled = row.enabled === 1 && row.prepared === 1;
    return { enabled, checking: enabled && row.lease_key !== null && row.lease_expires_at > now,
      webhookConfigured, nextCheckAt: enabled && row.next_scan_at > 0 ? new Date(row.next_scan_at).toISOString() : null,
      lastError: enabled ? row.last_error : null };
  }

  async start(key: string, scopeRevision: number): Promise<void> {
    const row = await this.database.withSession('first-primary').prepare(`UPDATE monitor_control SET enabled = 1,
      lease_key = NULL, lease_expires_at = 0, next_scan_at = 0, last_attempt_at = NULL, failures = 0,
      last_error = NULL, last_request_count = 0 WHERE singleton = 1 AND scope_revision = ? AND EXISTS
      (SELECT 1 FROM monitoring_scope WHERE singleton = 1 AND revision = ? AND config_key = ? AND scope_json IS NOT NULL)
      RETURNING singleton`).bind(scopeRevision, scopeRevision, key).first();
    if (!row) throw new ControlConflict();
  }

  async pause(): Promise<void> {
    const database = this.database.withSession('first-primary');
    const result = await database.batch([
      // Advance scope generation too, so a Start still verifying access cannot
      // reactivate monitoring after this pause wins.
      database.prepare('UPDATE monitoring_scope SET revision = revision + 1 WHERE singleton = 1'),
      database.prepare(`UPDATE monitor_control SET scope_revision = (SELECT revision FROM monitoring_scope WHERE singleton = 1), enabled = 0, lease_key = NULL, lease_expires_at = 0,
        next_scan_at = 0, failures = 0, last_error = NULL WHERE singleton = 1`),
      database.prepare(`UPDATE monitor_state SET scope_revision = (SELECT revision FROM monitoring_scope WHERE singleton = 1), revision = revision + 1, phase = 'unknown', activity_observed = 0,
        empty_since = NULL, last_complete_at = NULL, runs_json = '[]', last_run_url = NULL, notice_enabled = 0, commit_key = NULL WHERE singleton = 1`),
      database.prepare('DELETE FROM idle_outbox'),
      database.prepare('DELETE FROM workflow_run_state'),
    ]);
    if (result.some(statement => !statement.success)) throw new Error('Monitor control unavailable');
  }

  async claim(key: string, scopeRevision: number, now = Date.now()): Promise<ScanLease | null> {
    const lease = crypto.randomUUID();
    // Anchor normal attempts to minute boundaries. Scheduling jitter must not
    // turn a slightly early following tick into a skipped two-minute cycle.
    const next = (Math.floor(now / SCAN_INTERVAL_MS) + 1) * SCAN_INTERVAL_MS;
    const row = await this.database.withSession('first-primary').prepare(`UPDATE monitor_control SET lease_key = ?,
      lease_expires_at = ?, next_scan_at = ?, last_attempt_at = ? WHERE singleton = 1 AND enabled = 1 AND scope_revision = ?
      AND next_scan_at <= ? AND (lease_key IS NULL OR lease_expires_at <= ?) AND EXISTS
      (SELECT 1 FROM monitoring_scope WHERE singleton = 1 AND revision = ? AND config_key = ? AND scope_json IS NOT NULL)
      RETURNING singleton`).bind(lease, now + SCAN_LEASE_MS, next, now, scopeRevision, now, now, scopeRevision, key).first();
    return row ? { id: lease, scopeRevision } : null;
  }

  async finish(lease: ScanLease, error: string | null, requests: number, retryAt?: number, now = Date.now()): Promise<void> {
    // One attempt per normal minute slot; failure backoff caps at fifteen
    // minutes, while a provider reset/retry timestamp can require a longer wait.
    const result = await this.database.withSession('first-primary').prepare(`UPDATE monitor_control SET
      next_scan_at = max(next_scan_at, ?, CASE WHEN ? IS NULL OR ? = 'conflict' THEN next_scan_at
        ELSE ? + min(900000, 60000 * (1 << min(failures, 4))) END),
      failures = CASE WHEN ? IS NULL OR ? = 'conflict' THEN 0 ELSE failures + 1 END,
      last_error = ?, last_request_count = ?, lease_key = NULL, lease_expires_at = 0
      WHERE singleton = 1 AND enabled = 1 AND scope_revision = ? AND lease_key = ?`)
      .bind(retryAt ?? 0, error, error, now, error, error, error, requests, lease.scopeRevision, lease.id).run();
    if (!result.success) throw new Error('Monitor control unavailable');
  }
}
