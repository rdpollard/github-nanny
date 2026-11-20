import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionsFixture } from './helpers/actions.mjs';
import { MonitorStore, MonitorConflict } from '../worker/monitor-store.ts';

async function fixture(notices = true) {
  const f = await actionsFixture();
  await f.prepare();
  const database = await f.worker.getD1Database('DB');
  const key = (await database.prepare('SELECT config_key FROM monitoring_scope').first()).config_key;
  const scope = await (await f.scope()).json();
  if (notices) await database.prepare('UPDATE monitor_state SET notice_enabled = 1').run(); // Isolated test activation only.
  const store = new MonitorStore(database);
  const begin = () => store.begin(key, scope);
  const rows = async () => ({ state: await database.prepare('SELECT * FROM monitor_state').first(),
    outbox: (await database.prepare('SELECT * FROM idle_outbox ORDER BY epoch').all()).results });
  const observation = (time, count = 0) => ({ scopeRevision: scope.revision, repositoryCount: 4,
    startedAt: new Date(time).toISOString(), checkedAt: new Date(time + 1).toISOString(),
    runs: Array.from({ length: count }, (_, i) => ({ id: i + 1, attempt: i + 1, repository: 'rdpollard/github-nanny',
      workflow: 'CI', branch: 'main', status: 'in_progress', startedAt: new Date(0).toISOString(),
      url: `https://github.com/rdpollard/github-nanny/actions/runs/${i + 1}/attempts/${i + 1}` })) });
  const complete = async (time, count = 0) => store.complete(await begin(), observation(time, count));
  return { ...f, database, key, savedScope: scope, store, begin, rows, observation, complete };
}

test('initial empty scans stabilize quietly and monitor state survives fresh store objects', async () => {
  const f = await fixture();
  try {
    await f.complete(0);
    assert.equal((await f.rows()).state.phase, 'unknown');
    await f.complete(10_001);
    const stored = await f.rows();
    assert.equal(stored.state.phase, 'idle');
    assert.equal(stored.state.idle_epoch, 0);
    assert.deepEqual(stored.outbox, []);
    const nextRequest = new MonitorStore(f.database);
    const token = await nextRequest.begin(f.key, f.savedScope);
    assert.equal(token.state.phase, 'idle');
    assert.equal(token.state.lastCompleteAt, 10_002);
  } finally { await f.worker.dispose(); }
});

test('busy-to-idle and its unique outbox entry commit together despite concurrent Workers', async () => {
  const f = await fixture();
  try {
    await f.complete(0, 2);
    let stored = await f.rows();
    assert.equal(stored.state.phase, 'busy');
    assert.equal(JSON.parse(stored.state.runs_json).length, 2);
    await f.complete(100);
    const token = await f.begin();
    const competing = await f.begin();
    const result = await Promise.allSettled([
      f.store.complete(token, f.observation(10_101)),
      new MonitorStore(f.database).complete(competing, f.observation(10_102)),
    ]);
    assert.equal(result.filter(result => result.status === 'fulfilled').length, 1);
    assert.ok(result.some(result => result.status === 'rejected' && result.reason instanceof MonitorConflict));
    stored = await f.rows();
    assert.equal(stored.state.phase, 'idle');
    assert.equal(stored.state.activity_observed, 0);
    assert.equal(stored.state.idle_epoch, 1);
    assert.equal(stored.outbox.length, 1);
    assert.equal(stored.outbox[0].epoch, 1);
    assert.equal(stored.outbox[0].run_url, 'https://github.com/rdpollard/github-nanny/actions/runs/2/attempts/2');
    await f.complete(20_200);
    assert.equal((await f.rows()).outbox.length, 1);
    await f.complete(30_000, 1);
    assert.deepEqual((await f.rows()).outbox, []); // New work cancels an unsent notice.
    await f.complete(30_100);
    await f.complete(40_101);
    assert.equal((await f.rows()).outbox[0].epoch, 2);
  } finally { await f.worker.dispose(); }
});

test('failed and stale scans cannot finish a quiet interval or overwrite newer activity', async () => {
  const f = await fixture();
  try {
    await f.complete(0, 1);
    await f.complete(100);
    const stale = await f.begin();
    await f.store.fail(await f.begin());
    let stored = await f.rows();
    assert.equal(stored.state.phase, 'unknown');
    assert.equal(stored.state.activity_observed, 1);
    assert.equal(stored.state.empty_since, null);
    assert.equal(stored.state.runs_json, '[]');
    await assert.rejects(f.store.complete(stale, f.observation(20_000)), MonitorConflict);
    await f.complete(20_000);
    assert.equal((await f.rows()).state.phase, 'unknown');
    await f.complete(30_001);
    assert.equal((await f.rows()).outbox.length, 1);
    await f.store.fail(await f.begin());
    assert.equal((await f.rows()).state.phase, 'unknown');
    assert.equal((await f.rows()).outbox.length, 1); // Deferred, not lost on an outage.
    await f.complete(40_000);
    await f.complete(50_001);
    assert.equal((await f.rows()).state.idle_epoch, 1);
    assert.equal((await f.rows()).outbox.length, 1);
    const before = await f.rows();
    await assert.rejects(f.complete(20_000), MonitorConflict);
    assert.deepEqual(await f.rows(), before);
  } finally { await f.worker.dispose(); }
});

test('scope disconnect or replacement atomically clears run state and pending notices', async () => {
  const f = await fixture();
  try {
    await f.complete(0, 1);
    await f.complete(100);
    await f.complete(10_101);
    const old = await f.begin();
    assert.equal((await f.rows()).outbox.length, 1);
    assert.equal((await f.scope('DELETE')).status, 200);
    let stored = await f.rows();
    assert.equal(stored.state.phase, 'unknown');
    assert.equal(stored.state.runs_json, '[]');
    assert.equal(stored.state.last_run_url, null);
    assert.equal(stored.state.activity_observed, 0);
    assert.equal(stored.state.notice_enabled, 0);
    assert.deepEqual(stored.outbox, []);
    assert.equal(stored.state.idle_epoch, 1); // Epochs are never reused after scope changes.
    await assert.rejects(f.store.complete(old, f.observation(20_000, 1)), MonitorConflict);
    assert.equal((await f.scope('POST')).status, 200);
    stored = await f.rows();
    assert.equal(stored.state.scope_revision, 3);
    assert.equal(stored.state.notice_enabled, 0);
  } finally { await f.worker.dispose(); }
});

test('outbox failure rolls back the monitor transition; observation fields are sanitized', async () => {
  const f = await fixture();
  try {
    const report = f.observation(0, 1);
    report.runs[0].provider_token = 'hidden-provider-token';
    await f.store.complete(await f.begin(), report);
    assert.ok(!(await f.rows()).state.runs_json.includes('hidden-provider-token'));
    const invalid = f.observation(10, 1);
    invalid.runs[0].repository = 'rdpollard/hidden-private';
    await assert.rejects(f.store.complete(await f.begin(), invalid), /Invalid scan observation/);
    await f.complete(100);
    const before = (await f.rows()).state;
    await f.database.prepare('DROP TABLE idle_outbox').run();
    await assert.rejects(f.complete(10_101));
    assert.deepEqual(await f.database.prepare('SELECT * FROM monitor_state').first(), before);
    const scopeBefore = await f.database.prepare('SELECT * FROM monitoring_scope').first();
    assert.equal((await f.scope('DELETE')).status, 503);
    assert.deepEqual(await f.database.prepare('SELECT * FROM monitoring_scope').first(), scopeBefore);
  } finally { await f.worker.dispose(); }
});

test('production-default manual checks persist observations but cannot enqueue a notification', async () => {
  const f = await fixture(false);
  try {
    await f.complete(0, 1);
    await f.complete(100);
    await f.complete(10_101);
    const stored = await f.rows();
    assert.equal(stored.state.notice_enabled, 0);
    assert.deepEqual(stored.outbox, []);
    assert.equal((await f.scan()).status, 200); // Actual built handler also records a real observation.
    assert.equal((await f.rows()).state.phase, 'busy');
    assert.equal((await f.rows()).state.activity_observed, 1);
    assert.equal(JSON.parse((await f.rows()).state.runs_json).length, 21);
    f.control.page = () => Response.json({}, { status: 500 });
    assert.equal((await f.scan()).status, 503);
    assert.equal((await f.rows()).state.phase, 'unknown');
    assert.equal((await f.rows()).state.runs_json, '[]');
  } finally { await f.worker.dispose(); }
});

test('a scope written by the previous Worker during migration/upload is repaired with unknown confidence', async () => {
  const f = await fixture();
  try {
    await f.complete(0, 1);
    await f.complete(100);
    await f.complete(10_101);
    await f.database.prepare('UPDATE monitoring_scope SET revision = revision + 1').run(); // Old deployed code path.
    const scope = await (await f.scope()).json();
    const token = await f.store.begin(f.key, scope);
    assert.equal(token.state.phase, 'unknown');
    assert.equal(token.noticeEnabled, false);
    assert.equal(token.state.idleEpoch, 1);
    assert.equal(token.state.activityObserved, false);
    assert.deepEqual((await f.rows()).outbox, []);
    assert.equal((await f.rows()).state.runs_json, '[]');
  } finally { await f.worker.dispose(); }
});
