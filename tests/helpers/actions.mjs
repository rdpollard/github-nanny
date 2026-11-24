import { runtimeWorker, storedOwnerCookie } from './runtime.mjs';
import { rsaFixture } from './keys.ts';
import assert from 'node:assert/strict';

export const origin = 'https://nanny.example';
export const statuses = ['queued', 'in_progress', 'requested', 'waiting', 'pending'];
export const required = 'Tactics-Strategy-Dev-Environments';
export const repositories = [
  { id: 1, name: 'rdpollard/github-nanny', accountId: '27035363', installationId: 7 },
  { id: 2, name: 'rdpollard/locus-tether', accountId: '27035363', installationId: 7 },
  { id: 3, name: 'rdpollard/verify', accountId: '27035363', installationId: 7 },
  { id: 4, name: `stormbots/${required}`, accountId: '5925283', installationId: 8 },
];
const permissions = { actions: 'read', metadata: 'read' };
const bindings = {
  APP_ORIGIN: origin, GITHUB_OWNER_ID: '27035363', GITHUB_CLIENT_ID: 'Iv1_test_client',
  GITHUB_CLIENT_SECRET: 'test-client-secret-only-for-fixtures', SESSION_SECRET: 'A'.repeat(43),
  GITHUB_APP_SLUG: 'github-nanny-test',
  GITHUB_ORGANIZATIONS: JSON.stringify([{ id: '5925283', login: 'stormbots', repositories: [required] }]),
};
const keys = await rsaFixture();

export function metadata(repo) {
  return { id: repo.id, name: repo.name.split('/')[1], full_name: repo.name, private: false,
    owner: { id: Number(repo.accountId), login: repo.name.split('/')[0] } };
}
export function activeRun(repo, status, i = 0) {
  return { id: repo.id * 10000 + statuses.indexOf(status) * 1000 + i + 1, workflow_id: 99,
    run_attempt: i === 1 ? 2 : 1, status, conclusion: null, name: 'CI', head_branch: i === 1 ? 'feature/branch' : 'main',
    repository: metadata(repo), created_at: '2026-11-19T12:00:00Z', run_started_at: status === 'queued' ? null : '2026-11-19T12:00:05Z',
    html_url: 'https://untrusted.example/run', logs_url: 'https://untrusted.example/logs',
    actor: { email: 'hidden-email@example.test' }, head_repository: { name: 'hidden-fork-metadata', private: true } };
}

export async function actionsFixture(overrides = {}, runtime = {}) {
  const calls = [];
  const metadataCalls = new Map();
  const control = {
    mode: 'active', beforeActions: async () => {}, beforeInventory: async () => {},
    page: null, metadata: null, privateInventory: false, missingOrganization: false,
    push: null,
  };
  const worker = await runtimeWorker({
    modules: true, scriptPath: 'dist/github_nanny/index.js', compatibilityDate: '2026-11-19',
    inspectorPort: runtime.inspectorPort, inspectorHost: runtime.inspectorPort === undefined ? undefined : '127.0.0.1',
    bindings: { ...bindings, GITHUB_APP_PRIVATE_KEY: keys.pkcs1, ...overrides },
    outboundService: async request => {
      const url = new URL(request.url);
      calls.push({ url: url.href, method: request.method });
      if (url.origin !== 'https://api.github.com' && control.push) return control.push(request);
      assert.equal(url.origin, 'https://api.github.com');
      if (url.pathname === '/users/rdpollard/installation' || url.pathname === '/orgs/stormbots/installation') {
        const org = url.pathname.startsWith('/orgs/');
        if (org && control.missingOrganization) return Response.json({}, { status: 404 });
        return Response.json({ id: org ? 8 : 7, account: { id: org ? 5925283 : 27035363, type: org ? 'Organization' : 'User' },
          permissions, suspended_at: null, client_id: bindings.GITHUB_CLIENT_ID, app_slug: bindings.GITHUB_APP_SLUG,
          repository_selection: org ? 'selected' : 'all' });
      }
      if (/^\/app\/installations\/[78]\/access_tokens$/.test(url.pathname)) {
        assert.deepEqual(await request.json(), { permissions });
        const org = url.pathname.includes('/8/');
        return Response.json({ token: org ? 'fixture-org-token' : 'fixture-personal-token', permissions,
          repository_selection: org ? 'selected' : 'all', expires_at: new Date(Date.now() + 3_600_000).toISOString() }, { status: 201 });
      }
      const org = request.headers.get('Authorization') === 'Bearer fixture-org-token';
      if (url.pathname === '/installation/repositories') {
        await control.beforeInventory();
        const publicRepos = repositories.filter(repo => (repo.installationId === 8) === org).map(metadata);
        if (control.privateInventory && !org) publicRepos[0].private = true;
        const privateRepos = org ? [] : Array.from({ length: 17 }, (_, i) => ({ id: 100 + i,
          name: `hidden-private-${i}`, private: true, owner: { id: 27035363, login: 'rdpollard' } }));
        return Response.json({ total_count: publicRepos.length + privateRepos.length, repositories: [...publicRepos, ...privateRepos] });
      }
      const repo = repositories.find(repo => url.pathname === `/repos/${repo.name}` || url.pathname === `/repos/${repo.name}/actions/runs`);
      assert.ok(repo, 'Only saved public repositories may receive metadata/Actions requests');
      assert.equal(org, repo.installationId === 8, 'Installation tokens must not cross account boundaries');
      if (url.pathname === `/repos/${repo.name}`) {
        const count = (metadataCalls.get(repo.id) ?? 0) + 1;
        metadataCalls.set(repo.id, count);
        return control.metadata?.(repo, count) ?? Response.json(metadata(repo));
      }
      assert.equal(request.method, 'GET');
      assert.deepEqual([...url.searchParams.keys()].sort(), ['page', 'per_page', 'status']);
      assert.equal(url.searchParams.get('per_page'), '100');
      const status = url.searchParams.get('status');
      assert.ok(statuses.includes(status));
      await control.beforeActions();
      if (control.page) return control.page(repo, status, Number(url.searchParams.get('page')));
      const runs = control.mode === 'empty' ? [] : Array.from({ length: repo.id === 1 && status === 'queued' ? 2 : 1 }, (_, i) => activeRun(repo, status, i));
      return Response.json({ total_count: runs.length, workflow_runs: runs });
    },
  });
  const headers = { Cookie: await storedOwnerCookie(worker, bindings), Origin: origin };
  const scope = (method = 'GET') => worker.dispatchFetch(`${origin}/api/admin/monitoring`, { method, headers });
  const scan = (extra = {}) => worker.dispatchFetch(`${origin}/api/admin/actions?repository=other/private`, { method: 'POST', headers, ...extra });
  const prepare = async () => { assert.equal((await scope('POST')).status, 200); calls.length = 0; metadataCalls.clear(); };
  return { worker, calls, control, headers, scope, scan, prepare };
}
