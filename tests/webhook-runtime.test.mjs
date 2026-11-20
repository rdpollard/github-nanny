import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { actionsFixture, activeRun, metadata, origin, repositories } from './helpers/actions.mjs';
import { MonitorStore } from '../worker/monitor-store.ts';
import { WebhookStore, WEBHOOK_RETENTION_MS } from '../worker/github/webhook-store.ts';

const secret = 'fixture-webhook-secret-is-not-a-real-credential';
const path = `${origin}/api/webhooks/github`;
const signature = body => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
function payload(options = {}) {
  const repo = options.repo ?? repositories[3];
  const status = options.status ?? 'in_progress';
  return { action: status === 'completed' ? 'completed' : 'in_progress',
    installation: { id: repo.installationId }, repository: metadata(repo),
    workflow_run: { id: options.runId ?? 41001, run_attempt: options.attempt ?? 1, status,
      conclusion: status === 'completed' ? 'failure' : null,
      updated_at: new Date(options.updatedAt ?? Date.now()).toISOString(), repository: metadata(repo),
      html_url: 'https://untrusted.example/ignore', logs_url: 'https://untrusted.example/logs' },
    sender: { email: 'hidden-profile@example.test' }, message: 'Unicode payload: café 🐈', ...options.extra };
}
async function fixture() {
  const f = await actionsFixture({ GITHUB_WEBHOOK_SECRET: secret });
  await f.prepare();
  const db = await f.worker.getD1Database('DB');
  const sendRaw = (body, options = {}) => f.worker.dispatchFetch(path, { method: options.method ?? 'POST', body,
    headers: { 'Content-Type': 'application/json', 'X-GitHub-Event': options.event ?? 'workflow_run',
      'X-GitHub-Delivery': options.delivery ?? randomUUID(), 'X-Hub-Signature-256': signature(body), ...options.headers } });
  const send = (data = payload(), options) => sendRaw(JSON.stringify(data), options);
  const state = () => db.prepare('SELECT * FROM monitor_state').first();
  const counts = async () => ({
    deliveries: (await db.prepare('SELECT COUNT(*) AS count FROM webhook_deliveries').first()).count,
    runs: (await db.prepare('SELECT COUNT(*) AS count FROM workflow_run_state').first()).count,
    notices: (await db.prepare('SELECT COUNT(*) AS count FROM idle_outbox').first()).count,
  });
  return { ...f, db, send, sendRaw, state, counts };
}

test('webhooks verify the exact UTF-8 body with SHA-256 before any state changes', async () => {
  const f = await fixture();
  try {
    const before = await f.state();
    const raw = JSON.stringify(payload());
    for (const headers of [
      { 'X-Hub-Signature-256': '' }, { 'X-Hub-Signature-256': `sha1=${'0'.repeat(40)}` },
      { 'X-Hub-Signature-256': `sha256=${'0'.repeat(64)}` },
      { 'X-Hub-Signature-256': signature(raw + ' ') },
    ]) assert.equal((await f.sendRaw(raw, { headers })).status, 401);
    assert.deepEqual(await f.state(), before);
    assert.deepEqual(await f.counts(), { deliveries: 0, runs: 0, notices: 0 });
    const response = await f.sendRaw(raw);
    assert.equal(response.status, 202);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const stored = await f.state();
    assert.equal(stored.activity_observed, 1);
    assert.equal(stored.phase, 'unknown'); // A completion/start webhook cannot establish global idle.
    assert.equal(stored.notice_enabled, 0);
    assert.equal(stored.revision, before.revision + 1);
    assert.equal((await f.send(payload({ status: 'queued', runId: 41002, extra: { action: 'requested' } }))).status, 202);
    const serialized = JSON.stringify(await f.db.prepare('SELECT * FROM workflow_run_state').all());
    for (const hidden of ['untrusted.example', 'hidden-profile', secret, 'logs_url']) assert.ok(!serialized.includes(hidden));
    assert.equal(f.calls.length, 0); // No provider status checks or fetches.
  } finally { await f.worker.dispose(); }
});

test('receiver fails closed without its dedicated secret and rejects malformed headers and JSON', async () => {
  const noSecret = await actionsFixture();
  try {
    assert.equal((await noSecret.worker.dispatchFetch(path, { method: 'POST', body: '{}' })).status, 503);
    assert.equal((await noSecret.worker.dispatchFetch(path)).status, 405);
  } finally { await noSecret.worker.dispose(); }
  const f = await fixture();
  try {
    assert.equal((await f.send(payload(), { headers: { 'X-GitHub-Delivery': 'not-a-delivery' } })).status, 400);
    assert.equal((await f.send(payload(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).status, 415);
    assert.equal((await f.sendRaw('{')).status, 400);
    assert.equal((await f.sendRaw('[]')).status, 400);
    assert.equal((await f.send(payload(), { event: 'ping' })).status, 200);
    assert.equal((await f.send(payload(), { event: 'issues' })).status, 202);
    assert.deepEqual(await f.counts(), { deliveries: 0, runs: 0, notices: 0 });
  } finally { await f.worker.dispose(); }
});

test('duplicate deliveries and identical events with different IDs do not arm activity twice', async () => {
  const f = await fixture();
  try {
    const data = payload();
    const delivery = randomUUID();
    const before = await f.state();
    const responses = await Promise.all(Array.from({ length: 4 }, () => f.send(data, { delivery })));
    assert.ok(responses.every(response => response.status === 202));
    assert.equal((await f.state()).revision, before.revision + 1);
    assert.deepEqual(await f.counts(), { deliveries: 1, runs: 1, notices: 0 });
    assert.equal((await f.send(data)).status, 202);
    assert.equal((await f.state()).revision, before.revision + 1);
    assert.deepEqual(await f.counts(), { deliveries: 2, runs: 1, notices: 0 });
  } finally { await f.worker.dispose(); }
});

test('terminal attempts cannot reopen, while newer reruns survive older completion deliveries', async () => {
  const f = await fixture();
  try {
    const time = Date.now();
    await f.send(payload({ status: 'completed', updatedAt: time }));
    const terminal = await f.state();
    await f.send(payload({ updatedAt: time + 1 }));
    assert.deepEqual(await f.state(), terminal);
    await f.send(payload({ attempt: 2, updatedAt: time + 2 }));
    const rerun = await f.state();
    assert.equal(rerun.revision, terminal.revision + 1);
    await f.send(payload({ status: 'completed', updatedAt: time + 3 }));
    assert.deepEqual(await f.state(), rerun);
    let row = await f.db.prepare('SELECT * FROM workflow_run_state').first();
    assert.equal(row.attempt, 2);
    assert.equal(row.terminal, 0);
    await f.send(payload({ status: 'completed', attempt: 2, updatedAt: time + 4 }));
    row = await f.db.prepare('SELECT * FROM workflow_run_state').first();
    assert.equal(row.terminal, 1);
    assert.equal(row.attempt, 2);
  } finally { await f.worker.dispose(); }
});

test('private/unconfigured repositories and installations never store activity or alter monitoring state', async () => {
  const f = await fixture();
  try {
    await f.send();
    const before = await f.state();
    const counts = await f.counts();
    for (const data of [
      payload({ repo: { id: 100, name: 'rdpollard/hidden-private', accountId: '27035363', installationId: 7 }, extra: {
        repository: { id: 100, full_name: 'rdpollard/hidden-private', private: true, owner: { id: 27035363 } },
      } }),
      payload({ repo: { id: 101, name: 'other/unconfigured', accountId: '999', installationId: 999 } }),
    ]) assert.equal((await f.send(data)).status, 202);
    assert.deepEqual(await f.state(), before);
    assert.deepEqual(await f.counts(), counts);
    const saved = await (await f.scope()).json();
    const key = (await f.db.prepare('SELECT config_key FROM monitoring_scope').first()).config_key;
    // Even an erroneous internal caller cannot expand the SQL scope whitelist.
    saved.repositories.push({ id: 100, name: 'rdpollard/hidden-private', url: 'https://github.com/rdpollard/hidden-private', accountId: '27035363', installationId: 7 });
    await new WebhookStore(f.db).record(key, saved, randomUUID(), { repositoryId: 100, runId: 99, attempt: 1,
      status: 'in_progress', terminal: false, updatedAt: Date.now(), url: 'https://github.com/rdpollard/hidden-private/actions/runs/99/attempts/1' }, Date.now());
    assert.deepEqual(await f.state(), before);
    assert.deepEqual(await f.counts(), counts);
    assert.equal(f.calls.length, 0);
  } finally { await f.worker.dispose(); }
});

test('late completion for an activity period already covered by REST idle does not create a second period', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.scan()).status, 200);
    const scope = await (await f.scope()).json();
    const key = (await f.db.prepare('SELECT config_key FROM monitoring_scope').first()).config_key;
    const store = new MonitorStore(f.db);
    const time = Date.now();
    const empty = at => ({ scopeRevision: scope.revision, repositoryCount: 4, runs: [],
      startedAt: new Date(at).toISOString(), checkedAt: new Date(at + 1).toISOString() });
    await f.db.prepare('UPDATE monitor_state SET notice_enabled = 1').run(); // Isolated activation.
    await store.complete(await store.begin(key, scope), empty(time + 100));
    await store.complete(await store.begin(key, scope), empty(time + 10_101));
    const idle = await f.state();
    assert.equal(idle.phase, 'idle');
    assert.equal(idle.idle_epoch, 1);
    assert.equal((await f.counts()).notices, 1);
    await f.send(payload({ status: 'completed', updatedAt: time }));
    assert.deepEqual(await f.state(), idle);
    assert.equal((await f.counts()).notices, 1);
    await f.send(payload({ status: 'completed', runId: 99999, updatedAt: time + 1 })); // A previously unseen fast run.
    assert.equal((await f.state()).activity_observed, 1);
    assert.equal((await f.state()).phase, 'unknown');
    assert.equal((await f.counts()).notices, 0);
  } finally { await f.worker.dispose(); }
});

test('fresh signed activity invalidates an in-flight Actions scan', async () => {
  const f = await fixture();
  let release;
  try {
    let entered;
    const started = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    f.control.beforeActions = async () => { entered(); await gate; };
    const checking = f.scan();
    await started;
    await f.send(payload({ status: 'completed' }));
    release();
    const response = await checking;
    assert.equal(response.status, 409);
    assert.equal((await response.json()).reason, 'conflict');
    assert.equal((await f.state()).phase, 'unknown');
    assert.equal((await f.state()).activity_observed, 1);
  } finally { release?.(); await f.worker.dispose(); }
});

test('a stale REST result cannot reopen a signed terminal attempt, but a higher rerun attempt is accepted', async () => {
  const f = await fixture();
  try {
    await f.send(payload({ status: 'completed' }));
    assert.equal((await f.scan()).status, 409); // The provider fixture still reports attempt 1 running.
    assert.equal((await f.state()).phase, 'unknown');
    assert.equal((await f.state()).runs_json, '[]');
    f.control.page = (repo, status) => {
      const runs = repo.id === 4 && status === 'in_progress' ? [{ ...activeRun(repo, status), run_attempt: 2 }] : [];
      return Response.json({ total_count: runs.length, workflow_runs: runs });
    };
    const rerun = await f.scan();
    assert.equal(rerun.status, 200);
    assert.equal((await rerun.json()).runs[0].attempt, 2);
    assert.equal((await f.state()).phase, 'busy');
    assert.equal((await f.db.prepare('SELECT terminal FROM workflow_run_state WHERE run_id = 41001').first()).terminal, 0);
  } finally { await f.worker.dispose(); }
});

test('coverage-loss events atomically clear scope, run state and pending notices, and redelivery cannot clear a fresh save', async () => {
  for (const event of ['repository', 'installation', 'installation_repositories', 'workflow_run']) {
    const f = await fixture();
    try {
      await f.send();
      const delivery = randomUUID();
      const data = event === 'installation' ? { action: 'suspend', installation: { id: 8, account: { id: 5925283 } } }
        : event === 'installation_repositories' ? { action: 'removed', installation: { id: 8 }, repositories_removed: [{ id: 4 }] }
        : payload({ extra: { action: event === 'repository' ? 'privatized' : 'in_progress', repository: { ...metadata(repositories[3]), private: true } } });
      assert.equal((await f.send(data, { event, delivery })).status, 202);
      assert.equal((await (await f.scope()).json()).prepared, false);
      const state = await f.state();
      assert.equal(state.activity_observed, 0);
      assert.equal(state.runs_json, '[]');
      assert.equal(state.last_run_url, null);
      assert.equal(state.notice_enabled, 0);
      assert.equal((await f.counts()).runs, 0);
      assert.equal((await f.scope('POST')).status, 200);
      const restored = await f.state();
      assert.equal((await f.send(data, { event, delivery })).status, 202);
      assert.deepEqual(await f.state(), restored);
      assert.equal((await (await f.scope()).json()).prepared, true);
    } finally { await f.worker.dispose(); }
  }
});

test('storage failure rolls back receipts and activity, and old-scope writes cannot restore disconnected work', async () => {
  const f = await fixture();
  try {
    const scope = await (await f.scope()).json();
    const key = (await f.db.prepare('SELECT config_key FROM monitoring_scope').first()).config_key;
    const before = await f.state();
    await f.db.prepare('DROP TABLE workflow_run_state').run();
    const response = await f.send();
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'Webhook processing unavailable' });
    assert.equal((await f.db.prepare('SELECT COUNT(*) AS count FROM webhook_deliveries').first()).count, 0);
    assert.deepEqual(await f.state(), before);
    assert.equal(scope.prepared, true);
    assert.ok(key);
  } finally { await f.worker.dispose(); }
  const g = await fixture();
  try {
    const scope = await (await g.scope()).json();
    const key = (await g.db.prepare('SELECT config_key FROM monitoring_scope').first()).config_key;
    assert.equal((await g.scope('DELETE')).status, 200);
    await new WebhookStore(g.db).record(key, scope, randomUUID(), { repositoryId: 4, runId: 99, attempt: 1,
      status: 'in_progress', terminal: false, updatedAt: Date.now(), url: `https://github.com/${repositories[3].name}/actions/runs/99/attempts/1` }, Date.now());
    assert.deepEqual(await g.counts(), { deliveries: 0, runs: 0, notices: 0 });
    assert.equal((await g.state()).activity_observed, 0);
  } finally { await g.worker.dispose(); }
});

test('expired and pre-scope signed events are ignored and bounded retention removes old receipts', async () => {
  const f = await fixture();
  try {
    const before = await f.state();
    for (const updatedAt of [Date.now() - WEBHOOK_RETENTION_MS - 1000, Date.now() - 60_000, Date.now() + 600_000]) {
      assert.equal((await f.send(payload({ updatedAt }))).status, 202);
      assert.deepEqual(await f.state(), before);
    }
    await f.db.prepare('INSERT INTO webhook_deliveries VALUES (?, 0, ?, ?)')
      .bind(randomUUID(), Date.now() - WEBHOOK_RETENTION_MS - 1000, 'old-fixture-marker').run();
    await f.send();
    assert.equal((await f.counts()).deliveries, 1);
  } finally { await f.worker.dispose(); }
});
