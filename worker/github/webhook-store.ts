import type { SavedMonitoringScope } from '../../shared/contracts.ts';

export const WEBHOOK_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export interface WorkflowEvidence {
  repositoryId: number; runId: number; attempt: number; status: string;
  terminal: boolean; updatedAt: number; url: string;
}

export class WebhookStore {
  private readonly database: Cloudflare.Env['DB'];
  constructor(database: Cloudflare.Env['DB']) { this.database = database; }

  async record(key: string, scope: SavedMonitoringScope, delivery: string, evidence: WorkflowEvidence, now: number): Promise<void> {
    const repo = scope.repositories.find(repo => repo.id === evidence.repositoryId);
    if (!repo || !Number.isSafeInteger(evidence.runId) || evidence.runId <= 0 || !Number.isSafeInteger(evidence.attempt) || evidence.attempt <= 0 ||
      evidence.url !== `${repo.url}/actions/runs/${evidence.runId}/attempts/${evidence.attempt}`) throw new Error('Invalid workflow evidence');
    const database = this.database.withSession('first-primary');
    const marker = crypto.randomUUID();
    const result = await database.batch([
      database.prepare(`INSERT INTO webhook_deliveries (delivery_id, scope_revision, received_at, commit_key)
        SELECT ?, revision, ?, ? FROM monitoring_scope WHERE singleton = 1 AND revision = ? AND config_key = ? AND scope_json IS NOT NULL
        AND EXISTS (SELECT 1 FROM json_each(scope_json, '$.repositories') WHERE json_extract(value, '$.id') = ?)
        ON CONFLICT(delivery_id) DO NOTHING`).bind(delivery, now, marker, scope.revision, key, evidence.repositoryId),
      database.prepare(`INSERT INTO workflow_run_state
        (scope_revision, repository_id, run_id, attempt, status, updated_at, terminal, arm_activity, commit_key)
        SELECT ?, ?, ?, ?, ?, ?, ?, 1, ? WHERE EXISTS (SELECT 1 FROM webhook_deliveries WHERE delivery_id = ? AND commit_key = ?)
        ON CONFLICT(scope_revision, run_id) DO UPDATE SET
          attempt = excluded.attempt, status = excluded.status, updated_at = excluded.updated_at, terminal = excluded.terminal,
          arm_activity = CASE WHEN excluded.attempt > workflow_run_state.attempt OR workflow_run_state.settled_at IS NULL OR
            excluded.updated_at > workflow_run_state.settled_at THEN 1 ELSE 0 END,
          observed_at = CASE WHEN excluded.attempt > workflow_run_state.attempt THEN NULL ELSE workflow_run_state.observed_at END,
          settled_at = CASE WHEN excluded.attempt > workflow_run_state.attempt OR excluded.updated_at > workflow_run_state.settled_at
            THEN NULL ELSE workflow_run_state.settled_at END,
          commit_key = excluded.commit_key
        WHERE excluded.repository_id = workflow_run_state.repository_id AND
          (excluded.attempt > workflow_run_state.attempt OR (excluded.attempt = workflow_run_state.attempt AND workflow_run_state.terminal = 0 AND
          (excluded.terminal = 1 OR excluded.updated_at > workflow_run_state.updated_at OR
            (excluded.updated_at = workflow_run_state.updated_at AND excluded.status IS NOT workflow_run_state.status))))`)
        .bind(scope.revision, evidence.repositoryId, evidence.runId, evidence.attempt, evidence.status, evidence.updatedAt,
          Number(evidence.terminal), marker, delivery, marker),
      // Fresh activity invalidates all in-flight scan tokens. Even completion
      // only nominates a new full scan; no webhook can assert global idle.
      database.prepare(`UPDATE monitor_state SET revision = revision + 1, phase = 'unknown', activity_observed = 1,
        empty_since = NULL, runs_json = '[]', last_run_url = ?, commit_key = ?
        WHERE singleton = 1 AND scope_revision = ? AND EXISTS
        (SELECT 1 FROM workflow_run_state WHERE scope_revision = ? AND run_id = ? AND commit_key = ? AND arm_activity = 1)
        AND EXISTS (SELECT 1 FROM monitoring_scope WHERE singleton = 1 AND revision = ? AND config_key = ? AND scope_json IS NOT NULL)`)
        .bind(evidence.url, marker, scope.revision, scope.revision, evidence.runId, marker, scope.revision, key),
      database.prepare(`DELETE FROM idle_outbox WHERE EXISTS (SELECT 1 FROM monitor_state WHERE singleton = 1 AND commit_key = ?)`)
        .bind(marker),
      database.prepare(`DELETE FROM webhook_deliveries WHERE delivery_id IN
        (SELECT delivery_id FROM webhook_deliveries WHERE received_at < ? LIMIT 50)
        AND EXISTS (SELECT 1 FROM webhook_deliveries WHERE commit_key = ?)`)
        .bind(now - WEBHOOK_RETENTION_MS, marker),
      database.prepare(`DELETE FROM workflow_run_state WHERE (scope_revision, run_id) IN
        (SELECT scope_revision, run_id FROM workflow_run_state WHERE max(updated_at, coalesce(observed_at, 0)) < ? LIMIT 50)
        AND EXISTS (SELECT 1 FROM webhook_deliveries WHERE commit_key = ?)`)
        .bind(now - WEBHOOK_RETENTION_MS, marker),
    ]);
    if (result.some(statement => !statement.success)) throw new Error('Webhook storage unavailable');
  }
}
