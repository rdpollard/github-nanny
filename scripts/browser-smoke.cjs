const { chromium } = require('playwright-core');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const path = require('node:path');

// Run after npm run build. Uses Playwright's installed Chromium by default, or
// an existing browser supplied through CHROMIUM_PATH. No live credentials needed.
(async () => {
  const origin = 'http://127.0.0.1:4183';
  const server = spawn(process.execPath, [
    path.resolve('node_modules/vite/bin/vite.js'), 'preview',
    '--host', '127.0.0.1', '--port', '4183', '--strictPort',
  ], { stdio: 'inherit' });
  let browser;
  try {
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      if (server.exitCode !== null) throw new Error('Preview server exited before startup.');
      try {
        const response = await fetch(`${origin}/api/health`);
        if (response.ok && (await response.json()).service === 'github-nanny') { ready = true; break; }
      } catch { /* Preview may still be starting. */ }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(ready, 'Production preview must become ready');
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || undefined,
      headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/?demo=1`);
    await page.getByRole('heading', { name: 'GitHub is busy' }).waitFor();
    assert.equal(await page.getByRole('listitem').count(), 3);
    await page.getByRole('button', { name: 'Running', exact: false }).click();
    assert.equal(await page.getByRole('listitem').count(), 2);
    await page.getByRole('button', { name: 'Queued / waiting', exact: false }).click();
    assert.equal(await page.getByRole('listitem').count(), 1);
    await page.getByRole('button', { name: 'Active runs', exact: false }).click();
    await page.getByRole('button', { name: 'Compact layout', exact: true }).click();
    await page.getByRole('button', { name: 'Use dark theme', exact: true }).click();
    assert.equal(await page.locator('html').getAttribute('class'), 'dark');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.goto(origin);
    await page.getByRole('heading', { name: 'Status unavailable' }).waitFor();
    assert.equal(await page.getByRole('listitem').count(), 0);
    assert.equal((await (await page.request.get(`${origin}/api/status`)).json()).connected, false);
    await page.getByRole('link', { name: 'Manage', exact: true }).click();
    await page.getByRole('heading', { name: 'GitHub connection' }).waitFor();
    await page.getByText('GitHub sign-in setup is pending.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('link', { name: 'Sign in with GitHub', exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.goto(`${origin}/settings?sign_in=success`);
    await page.getByText('GitHub sign-in setup is pending.', { exact: true }).waitFor();
    assert.equal(await page.getByText('Your GitHub identity is connected.', { exact: true }).count(), 0);
    await page.goto(`${origin}/settings?sign_in=credentials`);
    await page.getByRole('status').filter({ hasText: "GitHub rejected the app's client ID or client secret." }).waitFor();
    assert.equal(await page.evaluate(() => location.search), '');
    for (const outcome of ['__proto__', 'constructor', 'unknown-provider-detail']) {
      await page.goto(`${origin}/settings?sign_in=${outcome}`);
      await page.getByText('GitHub sign-in setup is pending.', { exact: true }).waitFor();
      assert.equal(await page.getByRole('status').count(), 0);
    }
    // Check access only after an explicit owner click. Fixtures never contact
    // GitHub; a failed retry must remove the preceding inventory from view.
    let discoveryRequests = 0;
    const personalInventory = {
      checkedAt: '2026-11-19T12:00:00Z', owner: 'rdpollard', installationId: 7, selection: 'all',
      repositoryCount: 2, privateRepositoryCount: 1,
      repositories: [{ id: 1, name: 'rdpollard/public-demo', url: 'https://github.com/rdpollard/public-demo' }],
    };
    const organizationAccount = { id: '5925283', login: 'stormbots', kind: 'Organization', requiresAll: false, requiredRepositories: ['Tactics-Strategy-Dev-Environments'] };
    let scopeSaves = 0;
    let scopeDeletes = 0;
    let actionsRequests = 0;
    let savedScope = { revision: 0, prepared: false, policy: 'public-only', verifiedAt: null, repositories: [] };
    await page.route(`${origin}/api/admin/monitoring`, route => {
      const method = route.request().method();
      if (method === 'POST') {
        if (++scopeSaves === 2) return route.fulfill({ status: 409, json: { reason: 'conflict' } });
        savedScope = { revision: 1, prepared: true, policy: 'public-only', verifiedAt: personalInventory.checkedAt,
          repositories: personalInventory.repositories.map(repo => ({ ...repo, accountId: '27035363', installationId: 7 })) };
      } else if (method === 'DELETE') {
        scopeDeletes++;
        savedScope = { revision: 2, prepared: false, policy: 'public-only', verifiedAt: null, repositories: [] };
      } else assert.equal(method, 'GET');
      return route.fulfill({ json: savedScope });
    });
    await page.route(`${origin}/api/admin/actions`, route => {
      assert.equal(route.request().method(), 'POST');
      actionsRequests++;
      if (actionsRequests === 2) return route.fulfill({ status: 503, json: { reason: 'incomplete' } });
      return route.fulfill({ json: {
        scopeRevision: 1, startedAt: personalInventory.checkedAt, checkedAt: personalInventory.checkedAt, repositoryCount: 1,
        runs: actionsRequests === 3 ? [] : [1, 2].map(id => ({ id, attempt: id, repository: 'rdpollard/public-demo', workflow: 'CI',
          branch: 'feature/manual-check', status: 'queued', startedAt: personalInventory.checkedAt,
          url: `https://github.com/rdpollard/public-demo/actions/runs/${id}/attempts/${id}` })),
      } });
    });
    await page.route(`${origin}/api/auth/session`, route => route.fulfill({ json: {
      configured: true, authenticated: true, owner: { id: '27035363', login: 'rdpollard' },
      installationUrl: 'https://github.com/apps/github-nanny-test/installations/new',
    } }));
    await page.route(`${origin}/api/admin/repositories`, route => {
      discoveryRequests++;
      if (discoveryRequests === 2) return route.fulfill({ status: 503, json: { error: 'Repository discovery unavailable', reason: 'incomplete' } });
      const organizationInventory = {
        ...personalInventory, owner: 'stormbots', installationId: 8, selection: 'selected', repositoryCount: 1, privateRepositoryCount: 0,
        repositories: [{ id: 2, name: 'stormbots/Tactics-Strategy-Dev-Environments', url: 'https://github.com/stormbots/Tactics-Strategy-Dev-Environments' }],
      };
      return route.fulfill({ json: {
        checkedAt: personalInventory.checkedAt, complete: discoveryRequests === 3,
        repositoryCount: discoveryRequests === 3 ? 3 : 2, privateRepositoryCount: 1,
        repositories: [...personalInventory.repositories, ...(discoveryRequests === 3 ? organizationInventory.repositories : [])],
        accounts: [
          { account: { id: '27035363', login: 'rdpollard', kind: 'User', requiresAll: true, requiredRepositories: [] }, inventory: personalInventory, reason: null, missingRepositories: [], complete: true },
          { account: organizationAccount, inventory: discoveryRequests === 3 ? organizationInventory : null, reason: discoveryRequests === 3 ? null : 'not_installed', missingRepositories: discoveryRequests === 3 ? [] : organizationAccount.requiredRepositories, complete: discoveryRequests === 3 },
        ],
      } });
    });
    await page.goto(`${origin}/settings`);
    await page.getByRole('button', { name: 'Check repository access', exact: true }).waitFor();
    await page.getByText('No public monitoring scope is saved.', { exact: true }).waitFor();
    assert.equal(scopeSaves, 0);
    assert.equal(actionsRequests, 0);
    assert.equal(await page.getByRole('button', { name: 'Check Actions now', exact: true }).isDisabled(), true);
    assert.equal(discoveryRequests, 0);
    await page.getByRole('button', { name: 'Check repository access', exact: true }).click();
    await page.getByText('Repository access verified for rdpollard: 2 repositories (1 public, 1 private).', { exact: true }).waitFor();
    await page.getByRole('link', { name: 'rdpollard/public-demo', exact: true }).waitFor();
    await page.getByRole('heading', { name: 'stormbots (Organization)', exact: true }).waitFor();
    await page.getByRole('alert').filter({ hasText: 'Repository access is incomplete.' }).waitFor();
    await page.getByText('Required public repositories not verified: stormbots/Tactics-Strategy-Dev-Environments.', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.getByRole('button', { name: 'Check repository access', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'The repository list could not be completed consistently.' }).waitFor();
    assert.equal(await page.getByRole('link', { name: 'rdpollard/public-demo', exact: true }).count(), 0);
    assert.equal(discoveryRequests, 2);
    await page.getByRole('button', { name: 'Check repository access', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Configured repository access verified: 3 repositories (2 public, 1 private).' }).waitFor();
    await page.getByRole('link', { name: 'stormbots/Tactics-Strategy-Dev-Environments', exact: true }).waitFor();
    assert.equal(await page.getByRole('alert').count(), 0);
    assert.equal(discoveryRequests, 3);
    assert.equal(scopeSaves, 0); // An access check alone never changes the scope.
    await page.getByRole('button', { name: 'Save public scope', exact: true }).click();
    await page.getByText('Public scope saved: 1 repositories. Actions monitoring is not active yet.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('list', { name: 'Saved public repositories' }).getByRole('link').count(), 1);
    assert.equal(actionsRequests, 0); // Saving/reloading never starts Actions queries.
    await page.getByRole('button', { name: 'Check Actions now', exact: true }).click();
    await page.getByText('Unfinished runs observed: 2.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('list', { name: 'Observed unfinished runs' }).getByRole('listitem').count(), 2);
    await page.getByText('feature/manual-check · Attempt 2', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.getByRole('button', { name: 'Check Actions now', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'The Actions check could not cover every run consistently.' }).waitFor();
    assert.equal(await page.getByRole('list', { name: 'Observed unfinished runs' }).count(), 0);
    await page.getByRole('button', { name: 'Check Actions now', exact: true }).click();
    await page.getByText('No unfinished runs were found in this check. Global idle is not confirmed yet.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Save public scope', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'The saved scope changed in another request.' }).waitFor();
    assert.equal(await page.getByRole('list', { name: 'Saved public repositories' }).count(), 0);
    await page.getByRole('button', { name: 'Reload saved scope', exact: true }).click();
    await page.getByRole('list', { name: 'Saved public repositories' }).waitFor();
    await page.getByRole('button', { name: 'Disconnect saved scope', exact: true }).click();
    await page.getByText('No public monitoring scope is saved.', { exact: true }).waitFor();
    assert.equal(scopeDeletes, 1);
    assert.equal(actionsRequests, 3);
    assert.equal(await page.getByRole('button', { name: 'Check Actions now', exact: true }).isDisabled(), true);
    assert.equal(await page.getByText('No unfinished runs were found in this check. Global idle is not confirmed yet.', { exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    let logoutAllRequests = 0;
    await page.route(`${origin}/api/auth/logout-all`, route => {
      logoutAllRequests++;
      assert.equal(route.request().method(), 'POST');
      return route.fulfill({ json: { ok: true } });
    });
    await page.getByRole('button', { name: 'Sign out all devices', exact: true }).click();
    await page.getByRole('link', { name: 'Sign in with GitHub', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Check repository access', exact: true }).count(), 0);
    assert.equal(await page.getByRole('link', { name: 'stormbots/Tactics-Strategy-Dev-Environments', exact: true }).count(), 0);
    assert.equal(logoutAllRequests, 1);
    await page.unroute(`${origin}/api/auth/logout-all`);
    await page.unroute(`${origin}/api/auth/session`);
    await page.unroute(`${origin}/api/admin/repositories`);
    await page.unroute(`${origin}/api/admin/monitoring`);
    await page.unroute(`${origin}/api/admin/actions`);
    await page.getByRole('link', { name: 'Back to dashboard', exact: true }).click();
    await page.getByRole('heading', { name: 'Status unavailable' }).waitFor();
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await context.setOffline(true);
    // Regression: cached .html redirect responses cannot serve navigations.
    await page.goto(`${origin}/offline-navigation`);
    await page.getByRole('heading', { name: 'You’re offline' }).waitFor();
    assert.deepEqual(errors, []);
    console.log('Browser smoke passed: filters, theme, compact/mobile layout, owner setup, unknown status, service worker and offline fallback.');
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
