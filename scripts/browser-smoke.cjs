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
    // Validate the manifest as Chromium sees it and decode the served assets.
    const protocol = await context.newCDPSession(page);
    const parsedManifest = await protocol.send('Page.getAppManifest');
    assert.equal(parsedManifest.errors.filter(error => error.critical).length, 0);
    const manifest = JSON.parse(parsedManifest.data);
    assert.equal(manifest.id, '/'); assert.equal(manifest.start_url, '/');
    assert.equal(manifest.display, 'standalone');
    const expectedIcons = [['/icons/icon-192.png', 192, 'any'], ['/icons/icon-512.png', 512, 'any'], ['/icons/maskable-512.png', 512, 'maskable']];
    for (const [src, size, purpose] of expectedIcons) {
      assert.ok(manifest.icons.some(icon => icon.src === src && icon.sizes === `${size}x${size}` && icon.purpose === purpose));
      const pixels = await page.evaluate(async ({ src, size, purpose }) => {
        const image = new Image(); image.src = src; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
        const data = ctx.getImageData(0, 0, size, size).data;
        let transparent = 0, outside = 0, mark = 0;
        if (purpose === 'maskable') for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] !== 255) transparent++;
          if (data[i + 1] > 80 && data[i + 2] > 100) {
            mark++;
            const x = (i / 4) % size + 0.5, y = Math.floor(i / 4 / size) + 0.5;
            if (Math.hypot(x - size / 2, y - size / 2) > size * 0.4) outside++;
          }
        }
        return { width: image.naturalWidth, height: image.naturalHeight, transparent, outside, mark };
      }, { src, size, purpose });
      assert.equal(pixels.width, size); assert.equal(pixels.height, size);
      if (purpose === 'maskable') { assert.equal(pixels.transparent, 0); assert.equal(pixels.outside, 0); assert.ok(pixels.mark > 0); }
    }
    const appleIcon = page.locator('link[rel="apple-touch-icon"]');
    assert.equal(await appleIcon.getAttribute('sizes'), '180x180');
    const appleSize = await page.evaluate(async src => { const image = new Image(); image.src = src; await image.decode(); return [image.naturalWidth, image.naturalHeight]; }, await appleIcon.getAttribute('href'));
    assert.deepEqual(appleSize, [180, 180]);
    await protocol.detach();

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
    let automaticEnabled = false;
    let automaticWrites = 0;
    await page.route(`${origin}/api/admin/reconciliation`, route => {
      const method = route.request().method();
      if (method !== 'GET') { automaticWrites++; automaticEnabled = method === 'POST'; }
      return route.fulfill({ json: { enabled: automaticEnabled, checking: false, webhookConfigured: true, nextCheckAt: null, lastError: null } });
    });
    const pushPublicKey = Buffer.from([4, ...new Array(64).fill(0)]).toString('base64url');
    let pushDevices = [];
    let pushSaves = 0;
    let pushTests = 0;
    await page.addInitScript(({ applicationKey }) => {
      const state = window.__nannyPush = { permission: 'default', requests: 0, subscribed: false, gesture: false };
      Object.defineProperty(Notification, 'permission', { configurable: true, get: () => state.permission });
      Notification.requestPermission = async () => {
        state.gesture = navigator.userActivation.isActive;
        state.requests++; state.permission = 'granted'; return 'granted';
      };
      const value = { endpoint: 'https://fcm.googleapis.com/fcm/send/browser-fixture-only', expirationTime: null,
        keys: { p256dh: applicationKey, auth: 'AAAAAAAAAAAAAAAAAAAAAA' } };
      const subscription = { options: { applicationServerKey: Uint8Array.from(atob(applicationKey.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0)).buffer },
        toJSON: () => value, unsubscribe: async () => { state.subscribed = false; return true; } };
      PushManager.prototype.getSubscription = async () => state.subscribed ? subscription : null;
      PushManager.prototype.subscribe = async options => {
        if (!options.userVisibleOnly || !options.applicationServerKey) throw new Error('Browser subscription options missing');
        state.subscribed = true; return subscription;
      };
    }, { applicationKey: pushPublicKey });
    let idleAlertsEnabled = false;
    let idleAlertWrites = 0;
    await page.route(`${origin}/api/admin/alerts`, route => {
      const method = route.request().method();
      if (method !== 'GET') { idleAlertWrites++; idleAlertsEnabled = method === 'POST'; }
      return route.fulfill({ json: { configured: true, monitoring: automaticEnabled, enabled: idleAlertsEnabled,
        deviceCount: pushDevices.length, pendingDevices: 0, deliveryIssues: 0 } });
    });
    await page.route(`${origin}/api/admin/push`, async route => {
      const method = route.request().method();
      if (method === 'POST') {
        pushSaves++; const data = route.request().postDataJSON();
        assert.equal(data.label, 'Linux browser'); assert.ok(data.subscription.keys.auth);
        pushDevices = [{ id: 'A'.repeat(43), label: data.label, ready: true, createdAt: new Date().toISOString(), expiresAt: null,
          lastTestAt: null, lastResult: null, testNotBefore: new Date(0).toISOString() }];
        return route.fulfill({ status: 201, json: { id: pushDevices[0].id } });
      }
      if (method === 'DELETE') { pushDevices = []; return route.fulfill({ json: { ok: true } }); }
      return route.fulfill({ json: { configured: true, applicationServerKey: pushPublicKey, devices: pushDevices } });
    });
    await page.route(`${origin}/api/admin/push/test`, route => {
      assert.equal(route.request().method(), 'POST'); pushTests++;
      pushDevices[0] = { ...pushDevices[0], lastTestAt: new Date().toISOString(), lastResult: 'accepted', testNotBefore: new Date(Date.now() + 60_000).toISOString() };
      return route.fulfill({ status: 202, json: { accepted: true } });
    });
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
    await page.getByText('Public scope saved: 1 repositories.', { exact: true }).waitFor();
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
    assert.equal(automaticWrites, 0);
    await page.getByRole('button', { name: 'Start automatic checks', exact: true }).click();
    await page.getByText('Automatic checks are enabled.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Start automatic checks', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: 'Pause automatic checks', exact: true }).click();
    await page.getByText('Automatic checks are paused.', { exact: true }).waitFor();
    assert.equal(automaticWrites, 2);
    await page.getByRole('button', { name: 'Disconnect saved scope', exact: true }).click();
    await page.getByText('No public monitoring scope is saved.', { exact: true }).waitFor();
    assert.equal(scopeDeletes, 1);
    assert.equal(actionsRequests, 3);
    assert.equal(await page.getByRole('button', { name: 'Check Actions now', exact: true }).isDisabled(), true);
    assert.equal(await page.getByText('No unfinished runs were found in this check. Global idle is not confirmed yet.', { exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(pushSaves, 0); assert.equal(pushTests, 0);
    assert.equal(await page.evaluate(() => window.__nannyPush.requests), 0, 'Loading settings must not ask notification permission');
    await page.getByRole('button', { name: 'Check notification taps', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Handler tap-v2 is active. No notification tap is recorded' }).waitFor();
    await page.evaluate(async () => {
      const cache = await caches.open('github-nanny-click-diagnostic-v1');
      await cache.put('/__local_notification_click', new Response(JSON.stringify({ version: 'tap-v2', at: new Date().toISOString(), outcome: 'blocked', error: 'InvalidAccessError' })));
    });
    await page.getByRole('button', { name: 'Check notification taps', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Browser blocked opening Nanny. (InvalidAccessError)' }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.getByLabel('Device name').fill('Linux browser');
    await page.getByRole('button', { name: 'Register this browser', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Browser registered.' }).waitFor();
    assert.equal(pushSaves, 1); assert.equal(await page.evaluate(() => window.__nannyPush.gesture), true);
    await page.getByRole('button', { name: 'Send test to Linux browser', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'The push service accepted the test.' }).waitFor();
    assert.equal(pushTests, 1); assert.equal(await page.getByRole('button', { name: 'Send test to Linux browser', exact: true }).isDisabled(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.getByRole('button', { name: 'Save public scope', exact: true }).click();
    await page.getByText('Public scope saved: 1 repositories.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Start automatic checks', exact: true }).click();
    await page.getByText('Automatic checks are enabled.', { exact: true }).waitFor();
    assert.equal(idleAlertWrites, 0);
    await page.getByRole('button', { name: 'Enable idle alerts', exact: true }).click();
    await page.getByText('Idle alerts are enabled.', { exact: true }).waitFor();
    assert.equal(idleAlertWrites, 1);
    await page.getByRole('button', { name: 'Disable idle alerts', exact: true }).click();
    await page.getByText('Idle alerts are off.', { exact: true }).waitFor();
    assert.equal(idleAlertWrites, 2);
    await page.getByRole('button', { name: 'Remove Linux browser', exact: true }).click();
    await page.getByText('No push devices registered.', { exact: true }).waitFor();
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
    await page.unroute(`${origin}/api/admin/reconciliation`);
    await page.unroute(`${origin}/api/admin/push`);
    await page.unroute(`${origin}/api/admin/push/test`);
    await page.unroute(`${origin}/api/admin/alerts`);
    await page.getByRole('link', { name: 'Back to dashboard', exact: true }).click();
    await page.getByRole('heading', { name: 'Status unavailable' }).waitFor();
    let liveUnavailable = false;
    await page.route(`${origin}/api/status`, route => liveUnavailable ? route.fulfill({ status: 503, json: { error: 'unavailable' } }) : route.fulfill({ json: {
      phase: 'busy', connected: true, checkedAt: new Date().toISOString(), repositoryCount: 4, message: 'At the last complete check.',
      runs: [{ id: 23, attempt: 2, repository: 'rdpollard/public-demo', workflow: 'Live CI', branch: 'main', status: 'waiting',
        url: 'https://github.com/rdpollard/public-demo/actions/runs/23/attempts/2', startedAt: new Date().toISOString() }],
    } }));
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.getByRole('heading', { name: 'GitHub is busy' }).waitFor();
    await page.getByRole('link', { name: 'Live CI', exact: false }).waitFor();
    await page.getByText('main · Attempt 2', { exact: true }).waitFor();
    liveUnavailable = true;
    // A notification opens same-origin context, with an ordinary GitHub link.
    // URL context must not assert idle when the live check is unavailable.
    const alertRunUrl = 'https://github.com/rdpollard/public-demo/actions/runs/23/attempts/2';
    await page.goto(`${origin}/#${new URLSearchParams({ 'idle-run': alertRunUrl })}`);
    await page.getByRole('heading', { name: 'From your idle alert' }).waitFor();
    const alertLink = page.getByRole('link', { name: 'View run on GitHub', exact: false });
    assert.equal(await alertLink.getAttribute('href'), alertRunUrl);
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.getByRole('heading', { name: 'Status unavailable' }).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'GitHub is idle', exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    // Clicking the ordinary link uses a real page navigation, not a SW popup.
    await page.route(alertRunUrl, route => route.fulfill({ contentType: 'text/html', body: '<h1>GitHub attempt fixture</h1>' }));
    await alertLink.click();
    await page.getByRole('heading', { name: 'GitHub attempt fixture' }).waitFor();
    assert.equal(page.url(), alertRunUrl);
    await page.unroute(alertRunUrl);
    await page.goto(`${origin}/#${new URLSearchParams({ 'idle-run': 'https://evil.example/' })}`);
    await page.getByRole('heading', { name: 'Status unavailable' }).waitFor();
    assert.equal(await page.getByRole('link', { name: 'View run on GitHub', exact: false }).count(), 0);
    // Existing app windows may receive a fragment navigation without reloading.
    await page.evaluate(url => { location.hash = new URLSearchParams({ 'idle-run': url }).toString(); }, alertRunUrl);
    await page.getByRole('heading', { name: 'From your idle alert' }).waitFor();
    await page.evaluate(() => { location.hash = ''; });
    await page.getByRole('heading', { name: 'From your idle alert' }).waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.getByRole('heading', { name: 'Status unavailable' }).waitFor();
    assert.equal(await page.getByRole('link', { name: 'Live CI', exact: false }).count(), 0);
    assert.match(await page.getByRole('button', { name: 'Active runs', exact: false }).innerText(), /—/);
    await page.unroute(`${origin}/api/status`);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await context.setOffline(true);
    // Regression: cached .html redirect responses cannot serve navigations.
    await page.goto(`${origin}/offline-navigation`);
    await page.getByRole('heading', { name: 'You’re offline' }).waitFor();
    assert.deepEqual(errors, []);
    console.log('Browser smoke passed: manifest/icons, filters, theme, compact/mobile layout, owner setup, unknown status, service worker and offline fallback.');
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
