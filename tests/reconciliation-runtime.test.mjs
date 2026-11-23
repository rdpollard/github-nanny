import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionsFixture, origin } from './helpers/actions.mjs';
import { ControlStore } from '../worker/monitor-control.ts';
import { MonitorStore, MonitorConflict } from '../worker/monitor-store.ts';
import { publicStatus } from '../worker/status.ts';

const secret = 'fixture-webhook-secret-'.repeat(3);
async function fixture() {
  const f = await actionsFixture({ GITHUB_WEBHOOK_SECRET: secret });
  const db = await f.worker.getD1Database('DB');
  const settings = (method = 'GET', extra = {}) => f.worker.dispatchFetch(`${origin}/api/admin/reconciliation`, { method, headers: f.headers, ...extra });
  const status = async () => (await f.worker.dispatchFetch(`${origin}/api/status`)).json();
  const row = () => db.prepare('SELECT * FROM monitor_control').first();
  const state = () => db.prepare('SELECT * FROM monitor_state').first();
  const due = () => db.prepare('UPDATE monitor_control SET next_scan_at = 0').run(); // No wall-clock sleeps.
  const scheduled = async () => (await f.worker.getWorker()).scheduled({ cron: '* * * * *', scheduledTime: Date.now() });
  const start = async () => { assert.equal((await settings('POST')).status, 200); f.calls.length = 0; };
  return { ...f, db, settings, status, row, state, due, scheduled, start };
}

test('real scheduled entry is disabled by default, coalesces triggers and publishes only complete public scans', async () => {
  const f = await fixture();
  try {
    await f.prepare();
    await f.scheduled();
    assert.equal(f.calls.length, 0);
    assert.equal((await f.status()).connected, false);
    await f.start();
    await Promise.all([f.scheduled(), f.scheduled()]);
    assert.equal(f.calls.length, 34);
    assert.equal((await f.row()).last_request_count, 34);
    const busy = await f.status();
    assert.equal(busy.phase, 'busy');
    assert.equal(busy.repositoryCount, 4);
    assert.equal(busy.runs.length, 21);
    assert.ok(busy.runs.some(run => run.status === 'waiting'));
    assert.doesNotMatch(JSON.stringify(busy), /hidden-private|hidden-email|fixture-.*token|untrusted|logs_url|actor/);
    assert.deepEqual(Object.keys(busy.runs[0]).sort(), ['attempt', 'branch', 'id', 'repository', 'startedAt', 'status', 'url', 'workflow']);
    // Keep the subsequent explicit wake-up in the reserved period even if
    // this test happened to begin just before a real minute boundary.
    await f.db.prepare('UPDATE monitor_control SET next_scan_at = ?').bind(Date.now() + 60_000).run();
    await f.scheduled();
    await Promise.all(Array.from({ length: 5 }, () => f.status()));
    assert.equal(f.calls.length, 34, 'Public visits and duplicate ticks spend no GitHub requests');
    assert.equal((await f.state()).notice_enabled, 0);
    assert.equal((await f.db.prepare('SELECT count(*) AS n FROM idle_outbox').first()).n, 0);
  } finally { await f.worker.dispose(); }
});

test('initial quiet requires separated empty checks and creates no idle epoch or notification', async () => {
  const f = await fixture();
  try {
    await f.prepare(); await f.start();
    f.control.mode = 'empty';
    await f.scheduled();
    assert.equal((await f.status()).phase, 'unknown');
    // Shift only the saved candidate into the past; no sleeping or fake cron
    // timestamp is allowed to bypass the production clock/lease checks.
    await f.db.prepare('UPDATE monitor_state SET empty_since = ?, last_complete_at = ?').bind(Date.now() - 15_000, Date.now() - 15_000).run();
    await f.due(); await f.scheduled();
    assert.equal((await f.status()).phase, 'idle');
    assert.equal((await f.state()).idle_epoch, 0);
    assert.equal((await f.db.prepare('SELECT count(*) AS n FROM idle_outbox').first()).n, 0);
  } finally { await f.worker.dispose(); }
});

test('busy-to-idle stabilizes, expiry/errors/leases hide all cached runs and recovery republishes', async () => {
  const f = await fixture();
  try {
    await f.prepare(); await f.start(); await f.scheduled();
    const env = await f.worker.getBindings();
    const checked = (await f.state()).last_complete_at;
    const stale = await publicStatus(env, checked + 95_001);
    assert.equal(stale.phase, 'unknown'); assert.deepEqual(stale.runs, []);
    f.control.mode = 'empty'; await f.due(); await f.scheduled();
    assert.equal((await f.status()).phase, 'unknown');
    await f.db.prepare('UPDATE monitor_state SET empty_since = ?, last_complete_at = ?').bind(Date.now() - 15_000, Date.now() - 15_000).run();
    await f.due(); await f.scheduled();
    assert.equal((await f.status()).phase, 'idle');
    assert.equal((await f.state()).idle_epoch, 1);
    f.control.mode = 'active'; await f.due(); await f.scheduled();
    f.control.page = () => Response.json({}, { status: 429, headers: { 'Retry-After': '600' } });
    await f.due(); await f.scheduled();
    assert.equal((await f.row()).last_error, 'rate_limited');
    assert.ok((await f.row()).next_scan_at >= Date.now() + 590_000);
    assert.equal((await f.status()).phase, 'unknown'); assert.deepEqual((await f.status()).runs, []);
    const count = f.calls.length; await f.scheduled(); assert.equal(f.calls.length, count);
    f.control.page = null; await f.due(); await f.scheduled();
    assert.equal((await f.status()).phase, 'busy'); assert.equal((await f.row()).failures, 0);
    await f.db.prepare("UPDATE monitor_control SET lease_key = 'stuck', lease_expires_at = 0").run();
    assert.equal((await f.status()).phase, 'unknown'); assert.deepEqual((await f.status()).runs, []);
    await f.due(); await f.scheduled(); assert.equal((await f.status()).phase, 'busy');
  } finally { await f.worker.dispose(); }
});

test('owner controls enforce authentication/origin, ignore caller scope and pause blocks an in-flight scan', async () => {
  const f = await fixture();
  try {
    await f.prepare();
    assert.equal((await f.settings('POST', { headers: { Origin: origin } })).status, 401);
    assert.equal((await f.settings('POST', { headers: { Cookie: f.headers.Cookie, Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await f.settings('DELETE', { headers: { Cookie: f.headers.Cookie } })).status, 403);
    assert.equal((await f.settings('GET', { headers: { ...f.headers, 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    assert.equal(f.calls.length, 0);
    await f.start();
    let release; let entered;
    const gate = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { entered = resolve; });
    f.control.beforeActions = async () => { entered(); await gate; };
    const scan = f.scheduled();
    await started;
    assert.equal((await f.status()).phase, 'unknown');
    assert.equal((await f.settings('DELETE')).status, 200);
    release(); await scan;
    assert.equal((await f.row()).enabled, 0);
    assert.equal((await f.state()).phase, 'unknown');
    assert.equal((await f.state()).runs_json, '[]');
    assert.equal((await f.status()).connected, false);
    const count = f.calls.length; await f.scheduled(); assert.equal(f.calls.length, count);
    assert.equal((await (await f.scope()).json()).prepared, true);
  } finally { await f.worker.dispose(); }
});

test('scope save/disconnect atomically disables reconciliation and expired workers cannot commit success or failure', async () => {
  const f = await fixture();
  try {
    await f.prepare(); await f.start();
    const scope = await (await f.scope()).json();
    const key = (await f.db.prepare('SELECT config_key FROM monitoring_scope').first()).config_key;
    const controls = new ControlStore(f.db);
    const store = new MonitorStore(f.db);
    const minute = Math.floor(Date.now() / 60_000) * 60_000;
    const jittered = await controls.claim(key, scope.revision, minute + 500);
    assert.equal((await f.row()).next_scan_at, minute + 60_000);
    await controls.finish(jittered, null, 0);
    assert.equal(await controls.claim(key, scope.revision, minute + 59_999), null);
    const nextMinute = await controls.claim(key, scope.revision, minute + 60_001);
    assert.ok(nextMinute, 'A slightly earlier following cron tick still claims the next minute slot');
    await controls.finish(nextMinute, null, 0);
    await f.due();
    const lease = await controls.claim(key, scope.revision);
    const token = await store.begin(key, scope);
    const report = { scopeRevision: scope.revision, repositoryCount: 4, startedAt: new Date().toISOString(), checkedAt: new Date().toISOString(), runs: [] };
    await f.db.prepare('UPDATE monitor_control SET lease_expires_at = 0').run();
    await assert.rejects(store.complete(token, report, lease), MonitorConflict);
    await assert.rejects(store.fail(token, lease), MonitorConflict);
    await f.due(); const newer = await controls.claim(key, scope.revision); assert.ok(newer);
    await controls.finish(lease, 'unavailable', 40);
    assert.equal((await f.row()).lease_key, newer.id);
    assert.equal((await f.scope('POST')).status, 200);
    assert.equal((await f.row()).enabled, 0);
    await assert.rejects(store.complete(token, report, newer), MonitorConflict);
    await f.start(); assert.equal((await f.scope('DELETE')).status, 200);
    assert.equal((await f.row()).enabled, 0); assert.equal((await f.row()).lease_key, null);
  } finally { await f.worker.dispose(); }
});

test('start refuses changed public coverage and a pause fences an activation still verifying access', async () => {
  const f = await fixture();
  try {
    await f.prepare(); f.control.privateInventory = true;
    assert.equal((await f.settings('POST')).status, 409);
    assert.equal((await f.row()).enabled, 0);
    f.control.privateInventory = false;
    let release; let entered;
    const gate = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { entered = resolve; });
    f.control.beforeInventory = async () => { entered(); await gate; };
    const activation = f.settings('POST');
    await started;
    assert.equal((await f.settings('DELETE')).status, 200);
    release();
    assert.equal((await activation).status, 409, 'Pause wins over a Start already checking access');
    assert.equal((await f.row()).enabled, 0);
    f.control.beforeInventory = async () => {};
    const scope = await (await f.scope()).json();
    const key = (await f.db.prepare('SELECT config_key FROM monitoring_scope').first()).config_key;
    const controls = new ControlStore(f.db);
    await controls.pause();
    await assert.rejects(controls.start(key, scope.revision));
    assert.equal((await f.settings('POST', { body: JSON.stringify({ repositories: ['other/private'] }) })).status, 200);
    const count = f.calls.length;
    const changedEnv = { ...await f.worker.getBindings(), GITHUB_ORGANIZATIONS: '[]' };
    assert.equal((await publicStatus(changedEnv)).connected, false);
    assert.equal(f.calls.length, count);
  } finally { await f.worker.dispose(); }
});

test('generic failures back off exponentially and missing webhook setup cannot activate monitoring', async () => {
  const f = await fixture();
  try {
    await f.prepare(); await f.start();
    f.control.page = () => Response.json({}, { status: 503 });
    for (const [failures, minimum] of [[1, 60_000], [2, 120_000], [3, 240_000]]) {
      await f.due(); const before = Date.now(); await f.scheduled();
      const control = await f.row(); assert.equal(control.failures, failures);
      assert.ok(control.next_scan_at >= before + minimum);
    }
  } finally { await f.worker.dispose(); }
  const missing = await actionsFixture();
  try {
    await missing.prepare();
    const response = await missing.worker.dispatchFetch(`${origin}/api/admin/reconciliation`, { method: 'POST', headers: missing.headers });
    assert.equal(response.status, 409); assert.equal(missing.calls.length, 0);
  } finally { await missing.worker.dispose(); }
});
