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
    await page.route(`${origin}/api/auth/session`, route => route.fulfill({ json: {
      configured: true, authenticated: true, owner: { id: '27035363', login: 'rdpollard' },
      installationUrl: 'https://github.com/apps/github-nanny-test/installations/new',
    } }));
    await page.route(`${origin}/api/admin/repositories`, route => {
      discoveryRequests++;
      return route.fulfill(discoveryRequests === 1 ? { json: {
        checkedAt: '2026-11-19T12:00:00Z', owner: 'rdpollard', installationId: 7, selection: 'all',
        repositoryCount: 2, privateRepositoryCount: 1,
        repositories: [{ id: 1, name: 'rdpollard/public-demo', url: 'https://github.com/rdpollard/public-demo' }],
      } } : { status: 503, json: { error: 'Repository discovery unavailable', reason: 'incomplete' } });
    });
    await page.goto(`${origin}/settings`);
    await page.getByRole('button', { name: 'Check repository access', exact: true }).waitFor();
    assert.equal(discoveryRequests, 0);
    await page.getByRole('button', { name: 'Check repository access', exact: true }).click();
    await page.getByText('Repository access verified for rdpollard: 2 repositories (1 public, 1 private).', { exact: true }).waitFor();
    await page.getByRole('link', { name: 'rdpollard/public-demo', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.getByRole('button', { name: 'Check repository access', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'The repository list could not be completed consistently.' }).waitFor();
    assert.equal(await page.getByRole('link', { name: 'rdpollard/public-demo', exact: true }).count(), 0);
    assert.equal(discoveryRequests, 2);
    await page.unroute(`${origin}/api/auth/session`);
    await page.unroute(`${origin}/api/admin/repositories`);
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
