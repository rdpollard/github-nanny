import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionsFixture, activeRun, metadata, origin, repositories, statuses } from './helpers/actions.mjs';

test('manual Actions checks require owner, same-origin POST and a prepared scope before provider calls', async () => {
  const f = await actionsFixture();
  try {
    const path = `${origin}/api/admin/actions`;
    assert.equal((await f.worker.dispatchFetch(path, { method: 'POST' })).status, 401);
    assert.equal((await f.worker.dispatchFetch(path, { headers: f.headers })).status, 405);
    for (const headers of [
      { ...f.headers, Origin: 'https://foreign.example' }, { Cookie: f.headers.Cookie },
      { ...f.headers, 'Sec-Fetch-Site': 'cross-site' },
    ]) assert.equal((await f.scan({ headers })).status, 403);
    const unprepared = await f.scan();
    assert.equal(unprepared.status, 409);
    assert.equal((await unprepared.json()).reason, 'not_prepared');
    assert.equal(f.calls.length, 0);
  } finally { await f.worker.dispose(); }
});

test('all five unfinished statuses and simultaneous workflows are returned with separate IDs and attempts', async () => {
  const f = await actionsFixture();
  try {
    await f.prepare();
    const response = await f.scan({ body: JSON.stringify({ repositories: ['other/private'], actor: 'chosen-user' }) });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const report = await response.json();
    assert.equal(report.scopeRevision, 1);
    assert.equal(report.repositoryCount, 4);
    assert.equal(report.runs.length, 21);
    assert.ok(Number.isFinite(Date.parse(report.checkedAt)));
    assert.ok(Date.parse(report.checkedAt) >= Date.parse(report.startedAt));
    assert.equal(new Set(report.runs.map(run => run.id)).size, 21);
    assert.equal(report.runs[1].attempt, 2);
    assert.equal(report.runs[0].workflow, report.runs[1].workflow);
    assert.ok(report.runs.every(run => run.url === `https://github.com/${run.repository}/actions/runs/${run.id}/attempts/${run.attempt}`));
    for (const repo of repositories) for (const status of statuses) {
      assert.ok(f.calls.some(call => new URL(call.url).pathname === `/repos/${repo.name}/actions/runs` && new URL(call.url).searchParams.get('status') === status));
    }
    assert.equal(f.calls.length, 34); // Six discovery + twenty Actions + eight metadata.
    const serialized = JSON.stringify(report);
    for (const hidden of ['hidden-private', 'fixture-org-token', 'fixture-personal-token', 'hidden-email', 'hidden-fork-metadata', 'untrusted.example', 'other/private']) assert.ok(!serialized.includes(hidden));
    assert.equal((await (await f.worker.dispatchFetch(`${origin}/api/status`)).json()).phase, 'unknown');
    const db = await f.worker.getD1Database('DB');
    assert.ok(!(await db.prepare('SELECT scope_json FROM monitoring_scope').first()).scope_json.includes('run_attempt'));
  } finally { await f.worker.dispose(); }
});

test('run pagination keeps older active runs and empty observations never claim global idle', async () => {
  const f = await actionsFixture();
  try {
    await f.prepare();
    f.control.page = (repo, status, page) => {
      const runs = repo.id === 1 && status === 'queued' ? Array.from({ length: 101 }, (_, i) => activeRun(repo, status, i)) : [];
      return Response.json({ total_count: runs.length, workflow_runs: runs.slice((page - 1) * 100, page * 100) }, {
        headers: runs.length && page === 1 ? { Link: '<https://untrusted.example/do-not-follow>; rel="next"' } : {},
      });
    };
    const paged = await f.scan();
    assert.equal(paged.status, 200);
    assert.equal((await paged.json()).runs.length, 101);
    assert.equal(f.calls.length, 35);
    f.control.page = null;
    f.control.mode = 'empty';
    const empty = await (await f.scan()).json();
    assert.deepEqual(empty.runs, []);
    assert.equal('phase' in empty, false);
    assert.equal('idleNotice' in empty, false);
    assert.equal((await (await f.worker.dispatchFetch(`${origin}/api/status`)).json()).phase, 'unknown');
  } finally { await f.worker.dispose(); }
});

test('scope changes or lost public visibility prevent Actions queries or discard the complete observation', async () => {
  const f = await actionsFixture();
  try {
    await f.prepare();
    f.control.privateInventory = true;
    const privateInventory = await f.scan();
    assert.equal(privateInventory.status, 409);
    assert.equal((await privateInventory.json()).reason, 'scope_changed');
    assert.ok(!f.calls.some(call => call.url.includes('/actions/')));
    f.control.privateInventory = false;
    f.control.missingOrganization = true;
    assert.equal((await f.scan()).status, 409);
    assert.ok(!f.calls.some(call => call.url.includes('/actions/')));
    f.control.missingOrganization = false;
    f.calls.length = 0;
    f.control.metadata = repo => Response.json({ ...metadata(repo), private: true });
    assert.equal((await f.scan()).status, 409);
    assert.ok(!f.calls.some(call => call.url.includes('/actions/')));
    f.control.metadata = (repo, count) => Response.json({ ...metadata(repo), private: count > 2 });
    // Reset metadata counters by preparing a fresh scope, then flip on final read.
    await f.prepare();
    f.control.metadata = (repo, count) => Response.json({ ...metadata(repo), private: count > 1 });
    const changedDuringScan = await f.scan();
    assert.equal(changedDuringScan.status, 409);
    const body = await changedDuringScan.json();
    assert.equal(body.reason, 'scope_changed');
    assert.equal('runs' in body, false);
  } finally { await f.worker.dispose(); }
});

test('truncated, changing, duplicate, capped, malformed and unexpected-status results are never returned partially', async () => {
  const f = await actionsFixture();
  try {
    await f.prepare();
    for (const page of [
      (repo, status) => Response.json({ total_count: 101, workflow_runs: [activeRun(repo, status)] }),
      (repo, status, page) => Response.json({ total_count: page === 1 ? 101 : 102, workflow_runs: page === 1 ? Array.from({ length: 100 }, (_, i) => activeRun(repo, status, i)) : [activeRun(repo, status, 100)] }),
      (repo, status) => Response.json({ total_count: 2, workflow_runs: [activeRun(repo, status), activeRun(repo, status)] }),
      () => Response.json({ total_count: 1000, workflow_runs: [] }),
      (repo, status) => Response.json({ total_count: 1, workflow_runs: [{ ...activeRun(repo, status), status: 'completed', conclusion: 'failure' }] }),
      (repo, status) => Response.json({ total_count: 1, workflow_runs: [{ ...activeRun(repo, status), repository: { ...metadata(repo), private: true } }] }),
      (repo, status) => Response.json({ total_count: 1, workflow_runs: [{ ...activeRun(repo, status), run_attempt: 0 }] }),
      () => Response.json({ total_count: 0, workflow_runs: [] }, { headers: { Link: '<https://untrusted.example>; rel="next"' } }),
      () => new Response('x'.repeat(2_097_153)),
    ]) {
      f.control.page = page;
      const response = await f.scan();
      assert.equal(response.status, 503);
      const body = await response.json();
      assert.equal(body.reason, 'incomplete');
      assert.equal('runs' in body, false);
    }
  } finally { await f.worker.dispose(); }
});

test('rate limits, redirects, provider errors and request-budget exhaustion fail without retries or leaked details', async () => {
  const f = await actionsFixture();
  try {
    await f.prepare();
    for (const status of [429, 302, 500]) {
      f.control.page = () => Response.json({ secret: 'hidden-provider-detail' }, { status, headers: { Location: 'https://untrusted.example' } });
      const before = f.calls.length;
      const response = await f.scan();
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: 'Actions check unavailable', reason: status === 429 ? 'rate_limited' : 'unavailable' });
      assert.equal(f.calls.length - before, 8); // Discovery, metadata, one Actions request.
    }
    f.calls.length = 0;
    f.control.page = (repo, status, page) => Response.json({ total_count: 901,
      workflow_runs: Array.from({ length: page === 10 ? 1 : 100 }, (_, i) => activeRun(repo, status, (page - 1) * 100 + i)) });
    const exhausted = await f.scan();
    assert.equal(exhausted.status, 503);
    assert.equal((await exhausted.json()).reason, 'incomplete');
    assert.equal(f.calls.length, 40);
  } finally { await f.worker.dispose(); }
});

test('disconnect during an Actions check fences its result without recreating a saved scope', async () => {
  const f = await actionsFixture();
  let release;
  try {
    await f.prepare();
    let enter;
    const entered = new Promise(resolve => { enter = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    f.control.beforeActions = async () => { enter(); await gate; };
    const checking = f.scan();
    await entered;
    assert.equal((await f.scope('DELETE')).status, 200);
    release();
    const response = await checking;
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: 'Actions check unavailable', reason: 'conflict' });
    assert.equal((await (await f.scope()).json()).prepared, false);
  } finally { release?.(); await f.worker.dispose(); }
});
