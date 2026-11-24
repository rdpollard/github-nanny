import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { actionsFixture, origin } from './helpers/actions.mjs';
import { browserSubscription, pushKeys, decryptPush } from './helpers/push.mjs';
import { deliverIdle } from '../worker/push/delivery.ts';
import { authConfig } from '../worker/auth/config.ts';
import { DeviceStore } from '../worker/push/devices.ts';
import { publicStatus } from '../worker/status.ts';

async function fixture(count = 2) {
  const keys = pushKeys();
  const f = await actionsFixture({ GITHUB_WEBHOOK_SECRET: 'fixture-webhook-secret-'.repeat(3), WEB_PUSH_PRIVATE_KEY: JSON.stringify(keys), PUSH_STORAGE_SECRET: randomBytes(32).toString('base64url') });
  const db = await f.worker.getD1Database('DB');
  const env = await f.worker.getBindings();
  const headers = { ...f.headers, 'Content-Type': 'application/json' };
  const alerts = (method = 'GET', extra = {}) => f.worker.dispatchFetch(`${origin}/api/admin/alerts`, { method, headers, ...extra });
  const settings = () => alerts().then(r => r.json());
  const browsers = Array.from({ length: count }, (_, i) => browserSubscription(`https://fcm.googleapis.com/fcm/send/idle-fixture-${i}`));
  const ids = [];
  const sent = [];
  const push = { status: 201, headers: {}, onSend: async () => {} };
  f.control.push = async request => {
    const browser = browsers.find(b => b.value.endpoint === request.url); assert.ok(browser);
    const payload = decryptPush(await request.arrayBuffer(), browser);
    sent.push({ endpoint: request.url, payload });
    await push.onSend();
    return new Response(null, { status: push.status, headers: push.headers });
  };
  const register = async (index = browsers.length - 1) => {
    const response = await f.worker.dispatchFetch(`${origin}/api/admin/push`, { method: 'POST', headers,
      body: JSON.stringify({ label: `Device ${index}`, subscription: browsers[index].value }) });
    assert.equal(response.status, 201); return (await response.json()).id;
  };
  await f.prepare();
  const start = await f.worker.dispatchFetch(`${origin}/api/admin/reconciliation`, { method: 'POST', headers }); assert.equal(start.status, 200);
  for (let i = 0; i < count; i++) ids.push(await register(i));
  const due = () => db.prepare('UPDATE monitor_control SET next_scan_at = 0').run();
  const scheduled = async () => { await due(); return (await f.worker.getWorker()).scheduled({ cron: '* * * * *', scheduledTime: Date.now() }); };
  const quiet = () => db.prepare('UPDATE monitor_state SET empty_since = ?, last_complete_at = ?').bind(Date.now() - 15_000, Date.now() - 15_000).run();
  const pending = async () => {
    f.control.mode = 'active'; assert.equal((await f.scan()).status, 200);
    f.control.mode = 'empty'; assert.equal((await f.scan()).status, 200); await quiet();
    const report = await f.scan(); assert.equal(report.status, 200); return report.json();
  };
  const jobs = () => db.prepare('SELECT epoch, device_id, device_revision, status, attempts FROM idle_deliveries ORDER BY device_id').all().then(r => r.results);
  const direct = report => deliverIdle(env, authConfig(env), report, async (input, init) => f.control.push(new Request(input, init)));
  return { ...f, db, env, ids, browsers, sent, push, alerts, settings, register, scheduled, quiet, pending, jobs, direct };
}

test('alert activation requires owner/origin, monitoring and ready devices, and initial quiet remains silent', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.alerts('POST', { headers: { Origin: origin } })).status, 401);
    assert.equal((await f.alerts('POST', { headers: { ...f.headers, Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await f.alerts('DELETE', { headers: { Cookie: f.headers.Cookie } })).status, 403);
    assert.equal((await f.alerts('POST')).status, 200);
    assert.equal((await f.settings()).enabled, true);
    assert.equal((await f.settings()).deviceCount, 2);
    f.control.mode = 'active'; assert.equal((await f.scan()).status, 200);
    assert.equal((await f.alerts('POST')).status, 200);
    assert.equal((await f.db.prepare('SELECT activity_observed FROM monitor_state').first()).activity_observed, 1, 'An enable retry preserves observed activity');
    await f.alerts('DELETE'); await f.alerts('POST');
    f.control.mode = 'empty'; await f.scheduled(); await f.quiet(); await f.scheduled();
    assert.equal(f.sent.length, 0); assert.deepEqual(await f.jobs(), []);
    const publicState = await (await f.worker.dispatchFetch(`${origin}/api/status`)).json();
    assert.equal(publicState.phase, 'idle'); assert.equal(publicState.alertsEnabled, true);
    const pause = await f.worker.dispatchFetch(`${origin}/api/admin/reconciliation`, { method: 'DELETE', headers: f.headers }); assert.equal(pause.status, 200);
    assert.equal((await f.alerts('POST')).status, 409);
  } finally { await f.worker.dispose(); }
  const empty = await fixture(0);
  try { assert.equal((await empty.alerts('POST')).status, 409); } finally { await empty.worker.dispose(); }
});

test('real scheduled full scans send one encrypted idle alert per snapshotted device, then stay quiet', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.alerts('POST')).status, 200);
    f.control.mode = 'active'; await f.scheduled(); assert.equal(f.sent.length, 0);
    f.control.mode = 'empty'; await f.scheduled(); assert.equal(f.sent.length, 0);
    await f.quiet(); await f.scheduled(); assert.equal(f.sent.length, 2);
    for (const sent of f.sent) {
      assert.equal(sent.payload.kind, 'idle'); assert.equal(sent.payload.epoch, 1);
      assert.match(sent.payload.url, /^https:\/\/github.com\/(rdpollard|stormbots)\//);
      assert.deepEqual(Object.keys(sent.payload).sort(), ['checkedAt','epoch','kind','url','version']);
    }
    assert.ok((await f.jobs()).every(job => job.status === 'accepted' && job.attempts === 1));
    await f.scheduled(); assert.equal(f.sent.length, 2);
    f.control.mode = 'active'; await f.scheduled(); assert.deepEqual(await f.jobs(), []);
    f.control.mode = 'empty'; await f.scheduled(); await f.quiet(); await f.scheduled();
    assert.equal(f.sent.length, 4); assert.equal(f.sent.at(-1).payload.epoch, 2);
  } finally { await f.worker.dispose(); }
});

test('temporary provider failures retry only after another fresh scan and respect backoff; accepted devices are not resent', async () => {
  const f = await fixture();
  try {
    await f.alerts('POST'); const report = await f.pending();
    let first = true;
    f.push.onSend = async () => { f.push.status = first ? 503 : 201; first = false; };
    await f.direct(report); assert.equal(f.sent.length, 2);
    assert.equal((await f.jobs()).filter(job => job.status === 'queued').length, 1);
    await f.db.prepare("UPDATE idle_deliveries SET next_attempt_at = 0 WHERE status = 'queued'").run();
    await f.direct(report); assert.equal(f.sent.length, 2);
    await f.db.prepare("UPDATE idle_deliveries SET next_attempt_at = 0 WHERE status = 'queued'").run();
    f.push.onSend = async () => {}; f.push.status = 201;
    await f.scheduled(); assert.equal(f.sent.length, 3);
    assert.ok((await f.jobs()).every(job => job.status === 'accepted'));
    await f.scheduled(); assert.equal(f.sent.length, 3);
  } finally { await f.worker.dispose(); }
});

test('disable, pause, scope loss, failed scans and new activity suppress pending delivery', async () => {
  for (const action of ['disable','pause','disconnect','failure','activity']) {
    const f = await fixture(1);
    try {
      await f.alerts('POST'); const report = await f.pending();
      if (action === 'disable') await f.alerts('DELETE');
      if (action === 'pause') await f.worker.dispatchFetch(`${origin}/api/admin/reconciliation`, { method: 'DELETE', headers: f.headers });
      if (action === 'disconnect') await f.scope('DELETE');
      if (action === 'failure') { f.control.page = () => Response.json({}, { status: 503 }); await f.scan(); }
      if (action === 'activity') { f.control.mode = 'active'; await f.scan(); }
      await f.direct(report); assert.equal(f.sent.length, 0, action);
    } finally { await f.worker.dispose(); }
  }
});

test('device renewal, expiry and late provider responses cannot send to or delete a replacement', async () => {
  const f = await fixture(1);
  try {
    await f.alerts('POST'); let report = await f.pending();
    await f.register(0); await f.direct(report); assert.equal(f.sent.length, 0);
    report = await f.pending(); f.push.status = 410;
    f.push.onSend = async () => { await f.register(0); };
    await f.direct(report); assert.equal(f.sent.length, 1);
    assert.equal((await f.db.prepare('SELECT count(*) AS n FROM push_devices').first()).n, 1);
    f.push.onSend = async () => {}; report = await f.pending();
    await f.db.prepare('UPDATE push_devices SET expires_at = 1').run();
    await f.direct(report); assert.equal(f.sent.length, 1);
  } finally { await f.worker.dispose(); }
});

test('a pause during delivery cancels remaining recipients; the network request already sent cannot be recalled', async () => {
  const f = await fixture();
  try {
    await f.alerts('POST'); const report = await f.pending();
    f.push.onSend = async () => { await f.worker.dispatchFetch(`${origin}/api/admin/reconciliation`, { method: 'DELETE', headers: f.headers }); };
    await f.direct(report); assert.equal(f.sent.length, 1); assert.deepEqual(await f.jobs(), []);
  } finally { await f.worker.dispose(); }
});

test('post-encryption authorization blocks activity arriving during preparation', async () => {
  const f = await fixture(1);
  const original = DeviceStore.prototype.forDelivery;
  try {
    await f.alerts('POST'); const report = await f.pending();
    DeviceStore.prototype.forDelivery = async function(...args) {
      const result = await original.apply(this, args);
      f.control.mode = 'active'; await f.scan();
      return result;
    };
    await f.direct(report); assert.equal(f.sent.length, 0);
  } finally { DeviceStore.prototype.forDelivery = original; await f.worker.dispose(); }
});

test('delivery claims coalesce competing dispatchers, expire old notices and bound retries', async () => {
  const f = await fixture(1);
  try {
    await f.alerts('POST'); let report = await f.pending();
    await Promise.all([f.direct(report), f.direct(report)]); assert.equal(f.sent.length, 1);
    report = await f.pending(); f.push.status = 429; f.push.headers = { 'Retry-After': '600' };
    await f.direct(report);
    assert.ok((await f.db.prepare("SELECT next_attempt_at FROM idle_deliveries WHERE status = 'queued'").first()).next_attempt_at > Date.now() + 590_000);
    await f.db.prepare('UPDATE idle_outbox SET created_at = ?').bind(Date.now() - 301_000).run();
    await f.direct(report); assert.deepEqual(await f.jobs(), []); assert.equal(f.sent.length, 2);
    report = await f.pending(); f.push.status = 503; f.push.headers = {};
    for (let i = 0; i < 3; i++) { await f.db.prepare('UPDATE idle_deliveries SET next_attempt_at = 0').run(); await f.scheduled(); }
    assert.equal((await f.jobs())[0].status, 'exhausted'); assert.equal((await f.jobs())[0].attempts, 3);
    await f.direct(report); assert.equal(f.sent.length, 5);
  } finally { await f.worker.dispose(); }
});

test('staleness, mismatched scope and changed configuration block delivery; later devices do not inherit an old idle', async () => {
  const f = await fixture(1);
  try {
    await f.alerts('POST'); const report = await f.pending();
    const stale = Date.now() - 96_000;
    await f.db.prepare('UPDATE monitor_state SET last_complete_at = ?').bind(stale).run();
    await f.direct({ ...report, checkedAt: new Date(stale).toISOString() }); assert.equal(f.sent.length, 0);
    await f.db.prepare('UPDATE monitor_state SET last_complete_at = ?').bind(Date.parse(report.checkedAt)).run();
    await f.db.prepare('UPDATE idle_outbox SET scope_revision = scope_revision + 1').run();
    await f.direct(report); assert.equal(f.sent.length, 0);
    await f.db.prepare('UPDATE idle_outbox SET scope_revision = ?').bind(report.scopeRevision).run();
    const changed = { ...f.env, WEB_PUSH_PRIVATE_KEY: f.env.WEB_PUSH_PRIVATE_KEY + ' ' };
    assert.equal((await publicStatus(changed)).alertsEnabled, false);
    await deliverIdle(changed, authConfig(changed), report, async () => { throw new Error('No request expected'); });
    f.browsers.push(browserSubscription('https://fcm.googleapis.com/fcm/send/later-device')); await f.register(1);
    await f.db.prepare("UPDATE idle_deliveries SET status = 'sending', attempts = 1, lease_key = 'crashed', lease_expires_at = 0").run();
    await f.direct(report); assert.equal(f.sent.length, 1);
    assert.equal(f.sent[0].endpoint, f.browsers[0].value.endpoint);
    assert.equal((await f.jobs())[0].attempts, 2);
  } finally { await f.worker.dispose(); }
});

test('permanent rejection is not retried and a gone subscription is removed without affecting the idle decision', async () => {
  const f = await fixture(1);
  try {
    await f.alerts('POST'); let report = await f.pending(); f.push.status = 403;
    await f.direct(report); await f.direct(report); assert.equal(f.sent.length, 1);
    assert.equal((await f.jobs())[0].status, 'rejected');
    report = await f.pending(); f.push.status = 410; await f.direct(report);
    assert.equal(f.sent.length, 2); assert.equal((await f.db.prepare('SELECT count(*) AS n FROM push_devices').first()).n, 0);
    assert.equal((await f.db.prepare('SELECT phase FROM monitor_state').first()).phase, 'idle');
    assert.deepEqual(await f.jobs(), []);
  } finally { await f.worker.dispose(); }
});


test('quiet scans expire stale delivery work without importing push keys or sending notifications', async t => {
  const f = await fixture();
  try {
    await f.alerts('POST');
    const report = await f.pending();
    assert.equal((await f.jobs()).length, 2);
    await f.db.prepare('UPDATE idle_outbox SET created_at = ?').bind(Date.now() - 360_000).run();
    const imports = t.mock.method(crypto.subtle, 'importKey');
    await f.direct(report);
    assert.equal(imports.mock.callCount(), 0);
    assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM idle_outbox').first()).n, 0);
    assert.deepEqual(await f.jobs(), []);
    assert.equal(f.sent.length, 0);
    const state = await f.db.prepare('SELECT phase, notice_enabled FROM monitor_state').first();
    assert.equal(state.phase, 'idle'); assert.equal(state.notice_enabled, 1);
  } finally { await f.worker.dispose(); }
});
