import { unconnectedSnapshot, type ActionsCheck, type DashboardSnapshot } from '../shared/contracts.ts';
import { authConfig, webhookConfigured, type Bindings } from './auth/config.ts';
import { MonitoringScopeStore } from './github/scope-store.ts';
import { sanitizedRuns } from './monitor-store.ts';

export const MAX_SNAPSHOT_AGE_MS = 95_000;

export async function publicStatus(env: Bindings, now = Date.now()): Promise<DashboardSnapshot> {
  const config = authConfig(env);
  if (!env.DB || !config || !webhookConfigured(env)) return unconnectedSnapshot();
  const configured = await new MonitoringScopeStore(env.DB).configured(env, config);
  if (!configured) return unconnectedSnapshot();
  // Read all readiness and confidence fields together. The WHERE fences a
  // scope save/disconnect between the validated scope read and this query.
  const row = await env.DB.withSession('first-primary').prepare(`SELECT m.phase, m.last_complete_at,
    m.runs_json, c.last_error, c.lease_key FROM monitoring_scope s
    JOIN monitor_state m ON m.singleton = s.singleton AND m.scope_revision = s.revision
    JOIN monitor_control c ON c.singleton = s.singleton AND c.scope_revision = s.revision
    WHERE s.singleton = 1 AND s.revision = ? AND s.config_key = ? AND s.scope_json IS NOT NULL AND c.enabled = 1`)
    .bind(configured.scope.revision, configured.key)
    .first<{ phase: string; last_complete_at: number | null; runs_json: string; last_error: string | null; lease_key: string | null }>();
  if (!row) return { ...unconnectedSnapshot(), message: 'Automatic checks are paused. The owner can start them in connection settings.' };
  const unknown: DashboardSnapshot = { phase: 'unknown', connected: true, checkedAt: null,
    repositoryCount: configured.scope.repositories.length, runs: [], message: 'Waiting for a complete, current Actions check.' };
  if (row.lease_key || row.last_error || row.last_complete_at === null || !Number.isSafeInteger(row.last_complete_at) ||
    row.last_complete_at > now || now - row.last_complete_at > MAX_SNAPSHOT_AGE_MS) return unknown;
  if (row.phase !== 'busy' && row.phase !== 'idle') return { ...unknown, message: 'Confirming that all monitored Actions have finished.' };
  const runs = sanitizedRuns(configured.scope, JSON.parse(row.runs_json) as ActionsCheck['runs']);
  if ((row.phase === 'idle' && runs.length) || (row.phase === 'busy' && !runs.length)) return unknown;
  return { ...unknown, phase: row.phase, checkedAt: new Date(row.last_complete_at).toISOString(), runs,
    message: row.phase === 'idle' ? 'All monitored public repositories were idle at the last complete check. Push notifications are not enabled yet.'
      : 'Unfinished Actions at the last complete check. Automatic checks run about once a minute.' };
}
