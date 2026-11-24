import { buildPushPayload } from '@block65/webcrypto-web-push';
import type { ActionsCheck } from '../../shared/contracts.ts';
import type { AuthConfig, Bindings } from '../auth/config.ts';
import type { Fetcher } from '../auth/github.ts';
import { retryTimestamp } from '../github/client.ts';
import { MonitoringScopeStore } from '../github/scope-store.ts';
import { validLink } from '../monitor-store.ts';
import { MAX_SNAPSHOT_AGE_MS } from '../status.ts';
import { pushConfig } from './config.ts';
import { DeviceStore } from './devices.ts';

export const NOTICE_LIFETIME_MS = 300_000;
const DELIVERY_LEASE_MS = 30_000;
const MAX_ATTEMPTS = 3;
const BATCH_SIZE = 4;
interface Job { epoch: number; device_id: string; device_revision: number; attempts: number; run_url: string; lease_key: string; }

// Invoked only after this scheduled invocation completed a FULL successful scan.
// Retries require another successful fresh scan, never just an old outbox row.
export async function deliverIdle(env: Bindings, owner: AuthConfig, report: ActionsCheck, fetcher: Fetcher = fetch): Promise<void> {
  if (!env.DB || report.runs.length) return;
  const db = env.DB.withSession('first-primary');
  const configured = await new MonitoringScopeStore(env.DB).configured(env, owner);
  if (!configured || configured.scope.revision !== report.scopeRevision || report.repositoryCount !== configured.scope.repositories.length) return;
  const checkedAt = Date.parse(report.checkedAt);
  const current = await db.prepare('SELECT notice_enabled FROM monitor_state WHERE singleton = 1').first<{ notice_enabled: number }>();
  if (current?.notice_enabled !== 1) return;
  // Quiet scans have no delivery work. Expire bounded stale outbox rows and
  // check for a due candidate before importing/validating/deriving push keys.
  // This is only a work hint; all scope/device/config/lease guards below still
  // authorize actual delivery immediately before a send.
  const now = Date.now();
  await db.prepare('DELETE FROM idle_outbox WHERE epoch IN (SELECT epoch FROM idle_outbox WHERE created_at < ? LIMIT 50)')
    .bind(now - NOTICE_LIFETIME_MS).run();
  const pending = await db.prepare(`SELECT 1 AS pending FROM idle_deliveries d JOIN idle_outbox o ON o.epoch = d.epoch
    WHERE d.status IN ('queued','sending') AND d.attempts < ? AND d.next_attempt_at <= ?
      AND (d.last_scan_at IS NULL OR d.last_scan_at < ?) AND (d.lease_key IS NULL OR d.lease_expires_at <= ?)
      AND o.created_at >= ? AND o.scope_revision = ? LIMIT 1`)
    .bind(MAX_ATTEMPTS, now, checkedAt, now, now - NOTICE_LIFETIME_MS, report.scopeRevision).first();
  if (!pending) return;
  const config = await pushConfig(env);
  if (!config) return;
  const devices = new DeviceStore(env.DB, config, owner.ownerId);
  const guard = `EXISTS (SELECT 1 FROM monitor_state m JOIN monitoring_scope s ON s.singleton = m.singleton
    JOIN monitor_control c ON c.singleton = m.singleton JOIN alert_control a ON a.singleton = m.singleton
    WHERE m.singleton = 1 AND m.phase = 'idle' AND m.notice_enabled = 1 AND m.idle_epoch = d.epoch
      AND m.scope_revision = ? AND s.revision = m.scope_revision AND c.scope_revision = s.revision
      AND s.config_key = ? AND s.scope_json IS NOT NULL AND m.last_complete_at = ?
      AND m.last_complete_at <= ? AND m.last_complete_at >= ?
      AND c.enabled = 1 AND c.lease_key IS NULL AND c.last_error IS NULL
      AND a.owner_id = ? AND a.key_id = ? AND a.config_id = ?)`;
  const params = () => { const now = Date.now(); return [report.scopeRevision, configured.key, checkedAt, now, now - MAX_SNAPSHOT_AGE_MS,
    owner.ownerId, config.keyId, config.configId]; };

  // Bound both retention work and external requests. Expiry does not rearm an
  // epoch; a newly registered device cannot inherit an old recipient snapshot.
  for (let i = 0; i < BATCH_SIZE; i++) {
    const now = Date.now();
    const candidate = await db.prepare(`SELECT d.epoch, d.device_id, o.run_url FROM idle_deliveries d
      JOIN idle_outbox o ON o.epoch = d.epoch JOIN push_devices p ON p.id = d.device_id
      WHERE d.status IN ('queued','sending') AND d.attempts < ? AND d.next_attempt_at <= ?
        AND (d.last_scan_at IS NULL OR d.last_scan_at < ?)
        AND (d.lease_key IS NULL OR d.lease_expires_at <= ?) AND o.created_at >= ?
        AND p.revision = d.device_revision AND p.owner_id = ? AND p.key_id = ?
        AND (p.expires_at IS NULL OR p.expires_at > ?) AND o.scope_revision = ? AND ${guard}
      ORDER BY d.epoch, d.device_id LIMIT 1`)
      .bind(MAX_ATTEMPTS, now, checkedAt, now, now - NOTICE_LIFETIME_MS, owner.ownerId, config.keyId, now, report.scopeRevision, ...params())
      .first<{ epoch: number; device_id: string; run_url: string }>();
    if (!candidate) break;
    const lease = crypto.randomUUID();
    const job = await db.prepare(`UPDATE idle_deliveries AS d SET status = 'sending', attempts = attempts + 1,
      lease_key = ?, lease_expires_at = ?, last_scan_at = ? WHERE epoch = ? AND device_id = ? AND status IN ('queued','sending')
      AND attempts < ? AND next_attempt_at <= ? AND (last_scan_at IS NULL OR last_scan_at < ?)
      AND (lease_key IS NULL OR lease_expires_at <= ?) AND ${guard}
      RETURNING epoch, device_id, device_revision, attempts, lease_key`)
      .bind(lease, now + DELIVERY_LEASE_MS, checkedAt, candidate.epoch, candidate.device_id, MAX_ATTEMPTS, now, checkedAt, now, ...params()).first<Omit<Job, 'run_url'>>();
    if (!job) continue;
    const claimed: Job = { ...job, run_url: candidate.run_url };
    const finish = async (status: 'accepted' | 'queued' | 'rejected', retryAt = 0, gone = false) => {
      const fenced = `epoch = ? AND device_id = ? AND lease_key = ? AND lease_expires_at > ?`;
      const result = await db.batch([
        db.prepare(`DELETE FROM push_devices WHERE id = ? AND owner_id = ? AND revision = ? AND ? = 1 AND EXISTS
          (SELECT 1 FROM idle_deliveries WHERE ${fenced})`)
          .bind(claimed.device_id, owner.ownerId, claimed.device_revision, Number(gone), claimed.epoch, claimed.device_id, claimed.lease_key, Date.now()),
        db.prepare(`UPDATE idle_deliveries SET status = ?, next_attempt_at = ?, lease_key = NULL, lease_expires_at = 0
          WHERE ${fenced}`).bind(status === 'queued' && claimed.attempts >= MAX_ATTEMPTS ? 'exhausted' : status,
          Math.max(retryAt, Date.now() + 60_000 * 2 ** (claimed.attempts - 1)), claimed.epoch, claimed.device_id, claimed.lease_key, Date.now()),
      ]);
      if (result.some(r => !r.success)) throw new Error('Idle delivery storage unavailable');
    };
    try {
      if (!validLink(claimed.run_url, configured.scope)) { await finish('rejected'); continue; }
      const subscription = await devices.forDelivery(claimed.device_id, claimed.device_revision);
      if (!subscription) { await finish('rejected'); continue; }
      const payload = await buildPushPayload({ data: { version: 1, kind: 'idle', epoch: claimed.epoch,
        url: claimed.run_url, checkedAt: report.checkedAt }, options: { ttl: 120, urgency: 'normal', topic: `nanny-idle-${claimed.epoch}` } }, subscription, config.vapid);
      // Recheck after cryptography and immediately before the outbound request.
      // A pause, renewed device, new activity or scope loss cancels this job.
      const authorized = await db.prepare(`SELECT 1 AS ok FROM idle_deliveries d JOIN push_devices p ON p.id = d.device_id
        JOIN idle_outbox o ON o.epoch = d.epoch WHERE d.epoch = ? AND d.device_id = ? AND d.lease_key = ?
          AND d.lease_expires_at > ? AND p.revision = d.device_revision AND p.owner_id = ? AND p.key_id = ?
          AND o.created_at >= ? AND o.scope_revision = ? AND (p.expires_at IS NULL OR p.expires_at > ?) AND ${guard}`)
        .bind(claimed.epoch, claimed.device_id, claimed.lease_key, Date.now(), owner.ownerId, config.keyId,
          Date.now() - NOTICE_LIFETIME_MS, report.scopeRevision, Date.now(), ...params()).first();
      if (!authorized) continue;
      const response = await fetcher(subscription.endpoint, { ...payload, redirect: 'manual', signal: AbortSignal.timeout(5_000) });
      await response.body?.cancel();
      if (response.status === 404 || response.status === 410) await finish('rejected', 0, true);
      else if (response.ok) await finish('accepted');
      else await finish(response.status === 429 || response.status >= 500 ? 'queued' : 'rejected', retryTimestamp(response.headers));
    } catch {
      await finish('queued');
      console.warn({ event: 'idle_delivery_deferred' });
    }
  }
}
