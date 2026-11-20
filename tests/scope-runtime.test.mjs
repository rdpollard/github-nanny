import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runtimeWorker, storedOwnerCookie } from './helpers/runtime.mjs';
import { rsaFixture } from './helpers/keys.ts';

const origin = 'https://nanny.example';
const path = `${origin}/api/admin/monitoring`;
const permissions = { actions: 'read', metadata: 'read' };
const required = 'Tactics-Strategy-Dev-Environments';
const bindings = {
  APP_ORIGIN: origin, GITHUB_OWNER_ID: '27035363', GITHUB_CLIENT_ID: 'Iv1_test_client',
  GITHUB_CLIENT_SECRET: 'test-client-secret-only-for-fixtures', SESSION_SECRET: 'A'.repeat(43),
  GITHUB_APP_SLUG: 'github-nanny-test',
  GITHUB_ORGANIZATIONS: JSON.stringify([{ id: '5925283', login: 'stormbots', repositories: [required] }]),
};
const keys = await rsaFixture();

async function fixture() {
  const calls = [];
  const control = { mode: 'complete', beforeInventory: async () => {} };
  const worker = await runtimeWorker({
    modules: true, scriptPath: 'dist/github_nanny/index.js', compatibilityDate: '2026-11-19',
    bindings: { ...bindings, GITHUB_APP_PRIVATE_KEY: keys.pkcs1 },
    outboundService: async request => {
      const url = new URL(request.url);
      calls.push(url.pathname);
      assert.equal(url.origin, 'https://api.github.com');
      if (url.pathname === '/users/rdpollard/installation' || url.pathname === '/orgs/stormbots/installation') {
        const org = url.pathname.startsWith('/orgs/');
        if (org && control.mode === 'missing') return Response.json({}, { status: 404 });
        return Response.json({ id: org ? 8 : 7, account: { id: org ? 5925283 : 27035363, type: org ? 'Organization' : 'User' },
          permissions, suspended_at: null, client_id: bindings.GITHUB_CLIENT_ID, app_slug: bindings.GITHUB_APP_SLUG,
          repository_selection: org ? 'selected' : 'all' });
      }
      if (/^\/app\/installations\/[78]\/access_tokens$/.test(url.pathname)) {
        const org = url.pathname.includes('/8/');
        return Response.json({ token: org ? 'fixture-org-token' : 'fixture-personal-token', permissions,
          repository_selection: org ? 'selected' : 'all', expires_at: new Date(Date.now() + 3_600_000).toISOString() }, { status: 201 });
      }
      assert.equal(url.pathname, '/installation/repositories'); // No Actions calls.
      await control.beforeInventory();
      const org = request.headers.get('Authorization') === 'Bearer fixture-org-token';
      const repository = (id, name, privateRepo = false) => ({ id, name, private: privateRepo,
        owner: { id: org ? 5925283 : 27035363, login: org ? 'stormbots' : 'rdpollard' } });
      let repositories = org ? [repository(4, required, control.mode === 'private-required')] : [
        ...['github-nanny', 'locus-tether', 'verify'].map((name, i) => repository(i + 1, name)),
        ...Array.from({ length: 17 }, (_, i) => repository(100 + i, `hidden-private-${i}`, true)),
      ];
      if (!org && control.mode === 'large') repositories = Array.from({ length: 201 }, (_, i) => repository(i + 10, `public-${i}`));
      const page = Number(url.searchParams.get('page'));
      return Response.json({ total_count: repositories.length, repositories: repositories.slice((page - 1) * 100, page * 100) });
    },
  });
  const headers = { Cookie: await storedOwnerCookie(worker, bindings), Origin: origin };
  const request = (method = 'GET', extra = {}) => worker.dispatchFetch(path, { method, headers, ...extra });
  return { worker, calls, control, headers, request };
}

test('scope mutations require owner and same-origin authorization; save persists only fresh public records', async () => {
  const f = await fixture();
  try {
    for (const method of ['GET', 'POST', 'DELETE']) {
      assert.equal((await f.worker.dispatchFetch(path, { method })).status, 401);
      assert.equal((await f.request(method, { headers: { ...f.headers, 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    }
    for (const method of ['POST', 'DELETE']) for (const Origin of [undefined, 'https://foreign.example']) {
      const headers = { Cookie: f.headers.Cookie, ...(Origin ? { Origin } : {}) };
      assert.equal((await f.request(method, { headers })).status, 403);
    }
    const wrongMethod = await f.request('PUT');
    assert.equal(wrongMethod.status, 405);
    assert.equal(wrongMethod.headers.get('Allow'), 'GET, POST, DELETE');
    assert.equal(f.calls.length, 0);
    const empty = await f.request();
    assert.equal(empty.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await empty.json(), { revision: 0, prepared: false, policy: 'public-only', verifiedAt: null, repositories: [] });

    const saved = await f.request('POST', { body: JSON.stringify({ complete: true, repositories: [{ name: 'other/private' }] }) });
    assert.equal(saved.status, 200);
    const scope = await saved.json();
    assert.equal(scope.revision, 1);
    assert.equal(scope.prepared, true);
    assert.equal(scope.policy, 'public-only');
    assert.deepEqual(scope.repositories.map(repo => repo.name), [
      'rdpollard/github-nanny', 'rdpollard/locus-tether', 'rdpollard/verify', `stormbots/${required}`,
    ]);
    assert.equal(scope.repositories[3].installationId, 8);
    assert.deepEqual(await (await f.request()).json(), scope); // New request and storage object.
    assert.equal(f.calls.length, 6);
    const db = await f.worker.getD1Database('DB');
    const row = await db.prepare('SELECT scope_json FROM monitoring_scope').first();
    const stored = JSON.parse(row.scope_json);
    assert.equal(stored.accounts.length, 2);
    assert.equal(stored.repositories.length, 4);
    for (const hidden of ['hidden-private', 'fixture-personal-token', 'fixture-org-token', 'other/private', 'privateRepositoryCount']) {
      assert.ok(!row.scope_json.includes(hidden));
      assert.ok(!JSON.stringify(scope).includes(hidden));
    }
    assert.equal((await (await f.worker.dispatchFetch(`${origin}/api/status`)).json()).phase, 'unknown');

    const disconnected = await f.request('DELETE');
    assert.deepEqual(await disconnected.json(), { revision: 2, prepared: false, policy: 'public-only', verifiedAt: null, repositories: [] });
    assert.equal((await db.prepare('SELECT scope_json FROM monitoring_scope').first()).scope_json, null);
    assert.equal(f.calls.length, 6); // Disconnect and reads never call GitHub.
    assert.equal((await (await f.worker.dispatchFetch(`${origin}/api/auth/session`, { headers: f.headers })).json()).authenticated, true);
  } finally { await f.worker.dispose(); }
});

test('incomplete verification cannot save or replace a scope, and missing storage fails closed', async () => {
  const f = await fixture();
  try {
    f.control.mode = 'missing';
    const failed = await f.request('POST');
    assert.equal(failed.status, 409);
    assert.equal((await failed.json()).reason, 'incomplete');
    assert.equal((await (await f.request()).json()).revision, 0);
    f.control.mode = 'complete';
    const saved = await (await f.request('POST')).json();
    f.control.mode = 'missing';
    assert.equal((await f.request('POST')).status, 409);
    assert.deepEqual(await (await f.request()).json(), saved);
    for (const mode of ['private-required', 'large']) {
      f.control.mode = mode;
      assert.equal((await f.request('POST')).status, 409);
      assert.deepEqual(await (await f.request()).json(), saved);
    }
    const db = await f.worker.getD1Database('DB');
    await db.prepare('DROP TABLE monitoring_scope').run();
    for (const method of ['GET', 'POST', 'DELETE']) {
      const response = await f.request(method);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: 'Monitoring scope storage unavailable' });
    }
    assert.equal((await (await f.worker.dispatchFetch(`${origin}/api/status`)).json()).phase, 'unknown');
  } finally { await f.worker.dispose(); }
});

test('a disconnect fences a slow save; concurrent saves cannot both replace the same revision', async () => {
  const f = await fixture();
  try {
    let release;
    let entered;
    const gate = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { entered = resolve; });
    f.control.beforeInventory = async () => { entered(); await gate; };
    const saving = f.request('POST');
    await started;
    const disconnected = await (await f.request('DELETE')).json();
    assert.equal(disconnected.revision, 1);
    release();
    const late = await saving;
    assert.equal(late.status, 409);
    assert.equal((await late.json()).reason, 'conflict');
    assert.deepEqual(await (await f.request()).json(), disconnected);

    let unblock;
    let bothEntered;
    let entrants = 0;
    const concurrentGate = new Promise(resolve => { unblock = resolve; });
    const bothStarted = new Promise(resolve => { bothEntered = resolve; });
    f.control.beforeInventory = async () => { if (++entrants === 2) bothEntered(); await concurrentGate; };
    const first = f.request('POST');
    const second = f.request('POST');
    await bothStarted;
    unblock();
    const results = await Promise.all([first, second]);
    assert.deepEqual(results.map(response => response.status).sort(), [200, 409]);
    assert.equal((await (await f.request()).json()).revision, 2);
  } finally { await f.worker.dispose(); }
});

test('a scope saved for previous server coverage requirements is treated as unprepared', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.request('POST')).status, 200);
    const db = await f.worker.getD1Database('DB');
    // Emulate a document belonging to a previous deployment's configuration.
    const row = await db.prepare('SELECT config_key FROM monitoring_scope').first();
    const oldKey = JSON.parse(row.config_key);
    oldKey.accounts[1].requiredRepositories.push('new-required-repository');
    await db.prepare('UPDATE monitoring_scope SET config_key = ?').bind(JSON.stringify(oldKey)).run();
    const hidden = await (await f.request()).json();
    assert.equal(hidden.prepared, false);
    assert.deepEqual(hidden.repositories, []);
    assert.equal(hidden.revision, 1);
    assert.equal((await f.request('DELETE')).status, 200); // Clearing needs no valid key.
  } finally { await f.worker.dispose(); }
});

test('malformed saved documents fail closed; disconnect can still clear them', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.request('POST')).status, 200);
    const db = await f.worker.getD1Database('DB');
    const valid = JSON.parse((await db.prepare('SELECT scope_json FROM monitoring_scope').first()).scope_json);
    for (const change of [
      scope => { scope.repositories[0].url = 'https://foreign.example'; },
      scope => { scope.repositories[0].installationId = 999; },
      scope => { scope.repositories.push(scope.repositories[0]); },
      scope => { scope.repositories = scope.repositories.filter(repo => repo.accountId !== '5925283'); },
      scope => { scope.accounts = []; },
    ]) {
      const corrupt = structuredClone(valid);
      change(corrupt);
      await db.prepare('UPDATE monitoring_scope SET scope_json = ?').bind(JSON.stringify(corrupt)).run();
      const response = await f.request();
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: 'Monitoring scope storage unavailable' });
    }
    assert.equal((await f.request('DELETE')).status, 200);
    assert.equal((await (await f.request()).json()).prepared, false);
  } finally { await f.worker.dispose(); }
});
