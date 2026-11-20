import type { ActionsCheck, SavedMonitoringScope } from '../shared/contracts.ts';
import { stabilize, type StabilizedMonitorState } from './monitor.ts';

interface MonitorRow {
  scope_revision: number; revision: number; phase: StabilizedMonitorState['phase']; activity_observed: number;
  idle_epoch: number; empty_since: number | null; last_complete_at: number | null;
  last_run_url: string | null; notice_enabled: number;
}
export interface ScanToken {
  key: string; scope: SavedMonitoringScope; state: StabilizedMonitorState;
  lastRunUrl: string | null; noticeEnabled: boolean;
}
export class MonitorConflict extends Error {
  constructor() { super('Monitoring state changed'); }
}

// Included after scope UPDATE in the same D1 batch. Conditional cleanup also
// makes a losing scope save a no-op for current monitoring state/outbox work.
export function resetMonitorScope(database: D1DatabaseSession): D1PreparedStatement[] {
  return [
    database.prepare(`UPDATE monitor_state SET scope_revision = (SELECT revision FROM monitoring_scope WHERE singleton = 1),
      revision = revision + 1, phase = 'unknown', activity_observed = 0, empty_since = NULL,
      last_complete_at = NULL, runs_json = '[]', last_run_url = NULL, commit_key = NULL, notice_enabled = 0
      WHERE singleton = 1 AND scope_revision != (SELECT revision FROM monitoring_scope WHERE singleton = 1)`),
    database.prepare('DELETE FROM idle_outbox WHERE scope_revision != (SELECT revision FROM monitoring_scope WHERE singleton = 1)'),
  ];
}

function safeInteger(value: number | null): boolean { return value === null || (Number.isSafeInteger(value) && value >= 0); }
function validLink(link: string, scope: SavedMonitoringScope): boolean {
  return scope.repositories.some(repo => {
    const prefix = `${repo.url}/actions/runs/`;
    return link.startsWith(prefix) && /^[1-9]\d{0,15}\/attempts\/[1-9]\d{0,15}$/.test(link.slice(prefix.length));
  });
}

export class MonitorStore {
  private readonly database: Cloudflare.Env['DB'];
  constructor(database: Cloudflare.Env['DB']) { this.database = database; }

  async begin(key: string, scope: SavedMonitoringScope): Promise<ScanToken> {
    if (!scope.prepared) throw new MonitorConflict();
    const database = this.database.withSession('first-primary');
    const query = () => database.prepare(`SELECT m.* FROM monitor_state m
      JOIN monitoring_scope s ON s.singleton = m.singleton AND s.revision = m.scope_revision
      WHERE m.singleton = 1 AND s.revision = ? AND s.config_key = ? AND s.scope_json IS NOT NULL`)
      .bind(scope.revision, key).first<MonitorRow>();
    let row = await query();
    if (!row) {
      // An older deployed Worker can still save scope between migration and
      // upload. Repair only a revision mismatch, never reuse old confidence.
      const repaired = await database.batch(resetMonitorScope(database));
      if (repaired.some(statement => !statement.success)) throw new Error('Monitor storage unavailable');
      row = await query();
    }
    if (!row) throw new MonitorConflict();
    if (!safeInteger(row.revision) || !safeInteger(row.idle_epoch) ||
      !safeInteger(row.empty_since) || !safeInteger(row.last_complete_at) ||
      !['unknown', 'busy', 'idle'].includes(row.phase) || ![0, 1].includes(row.activity_observed) ||
      ![0, 1].includes(row.notice_enabled) || (row.activity_observed && !row.last_run_url) ||
      (row.last_run_url !== null && !validLink(row.last_run_url, scope))) throw new Error('Invalid monitor state');
    return { key, scope, lastRunUrl: row.last_run_url, noticeEnabled: row.notice_enabled === 1,
      state: { revision: row.revision, phase: row.phase, activityObserved: row.activity_observed === 1,
        idleEpoch: row.idle_epoch, emptySince: row.empty_since, lastCompleteAt: row.last_complete_at } };
  }

  async complete(token: ScanToken, report: ActionsCheck): Promise<void> {
    if (report.scopeRevision !== token.scope.revision || report.repositoryCount !== token.scope.repositories.length) throw new MonitorConflict();
    const seen = new Set<number>();
    const runs = report.runs.map(run => {
      if (!token.scope.repositories.some(repo => repo.name === run.repository) ||
        !Number.isSafeInteger(run.id) || run.id <= 0 || !Number.isSafeInteger(run.attempt) || run.attempt <= 0 ||
        seen.has(run.id) || !['queued', 'in_progress', 'requested', 'waiting', 'pending'].includes(run.status) ||
        run.url !== `https://github.com/${run.repository}/actions/runs/${run.id}/attempts/${run.attempt}` ||
        typeof run.workflow !== 'string' || run.workflow.length > 512 || typeof run.branch !== 'string' || run.branch.length > 1024 ||
        typeof run.startedAt !== 'string' || !Number.isFinite(Date.parse(run.startedAt))) throw new Error('Invalid scan observation');
      seen.add(run.id);
      return { id: run.id, attempt: run.attempt, repository: run.repository, workflow: run.workflow,
        branch: run.branch, status: run.status, url: run.url, startedAt: run.startedAt };
    });
    const runsJson = JSON.stringify(runs);
    if (new TextEncoder().encode(runsJson).byteLength > 262_144) throw new Error('Scan observation too large');
    const result = stabilize(token.state, { revision: token.state.revision, complete: true, activeRunCount: runs.length,
      startedAt: Date.parse(report.startedAt), finishedAt: Date.parse(report.checkedAt) });
    if (result.state === token.state) throw new MonitorConflict();
    const link = runs.at(-1)?.url ?? token.lastRunUrl;
    await this.commit(token, result.state, runsJson, link,
      token.noticeEnabled ? result.idleNotice?.epoch ?? null : null);
  }

  async fail(token: ScanToken): Promise<void> {
    // A partial/failed scan breaks the quiet interval and hides active run
    // data. Pending notices remain paused while phase is unknown, so a later
    // confirmed empty period can release the same epoch rather than lose it.
    await this.commit(token, { ...token.state, phase: 'unknown', emptySince: null }, '[]', token.lastRunUrl, null);
  }

  private async commit(token: ScanToken, state: StabilizedMonitorState, runs: string, link: string | null, notice: number | null) {
    const database = this.database.withSession('first-primary');
    const marker = crypto.randomUUID();
    const result = await database.batch([
      database.prepare(`UPDATE monitor_state SET revision = revision + 1, phase = ?, activity_observed = ?, idle_epoch = ?,
        empty_since = ?, last_complete_at = ?, runs_json = ?, last_run_url = ?, commit_key = ?
        WHERE singleton = 1 AND revision = ? AND scope_revision = ? AND EXISTS
        (SELECT 1 FROM monitoring_scope WHERE singleton = 1 AND revision = ? AND config_key = ? AND scope_json IS NOT NULL)
        RETURNING revision`)
        .bind(state.phase, Number(state.activityObserved), state.idleEpoch, state.emptySince, state.lastCompleteAt,
          runs, link, marker, token.state.revision, token.scope.revision, token.scope.revision, token.key),
      database.prepare(`INSERT INTO idle_outbox (epoch, scope_revision, created_at, run_url)
        SELECT idle_epoch, scope_revision, last_complete_at, last_run_url FROM monitor_state
        WHERE singleton = 1 AND commit_key = ? AND notice_enabled = 1 AND phase = 'idle' AND idle_epoch = ?`)
        .bind(marker, notice),
      database.prepare(`DELETE FROM idle_outbox WHERE EXISTS
        (SELECT 1 FROM monitor_state WHERE singleton = 1 AND commit_key = ? AND phase = 'busy')`).bind(marker),
    ]);
    if (result.some(statement => !statement.success)) throw new Error('Monitor storage unavailable');
    if (result[0].results.length !== 1) throw new MonitorConflict();
  }
}
