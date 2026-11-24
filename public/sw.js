// Cache the offline document and one local notification diagnostic only.
// Status/API/authenticated responses are never cached or replayed as live data.
const OFFLINE_CACHE = 'github-nanny-offline-v2';
// Workers static assets redirects /offline.html to /offline. Cache the
// canonical URL so a redirected Response is never replayed for a navigation.
const OFFLINE_URL = '/offline';
self.addEventListener('install', event => {
  event.waitUntil(caches.open(OFFLINE_CACHE).then(cache => cache.add(OFFLINE_URL)).then(() => self.skipWaiting()));
});

function safeRunUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.origin === 'https://github.com' && !url.username && !url.password && !url.search && !url.hash &&
      /^\/[A-Za-z0-9-]{1,39}\/[A-Za-z0-9_.-]{1,100}\/actions\/runs\/[1-9]\d{0,15}\/attempts\/[1-9]\d{0,15}$/.test(url.pathname) ? url.href : null;
  } catch { return null; }
}
// Malformed messages remain neutral. Stable epoch tags coalesce ambiguous
// retries without another banner; the next activity period gets a new tag.
self.addEventListener('push', event => {
  let value;
  try { value = event.data?.json(); } catch { /* Show a neutral fallback. */ }
  const test = value?.version === 1 && value?.kind === 'test';
  const runUrl = value?.version === 1 && value?.kind === 'idle' && Number.isSafeInteger(value.epoch) && value.epoch > 0 &&
    typeof value.checkedAt === 'string' && Number.isFinite(Date.parse(value.checkedAt)) && safeRunUrl(value.url);
  event.waitUntil(self.registration.showNotification(runUrl ? 'GitHub is idle' : test ? 'GitHub Nanny test' : 'GitHub Nanny', {
    body: runUrl ? `All monitored public Actions had finished at ${new Date(value.checkedAt).toLocaleTimeString()}.`
      : test ? 'This is a test notification from GitHub Nanny.' : 'Open GitHub Nanny to check current activity.',
    tag: runUrl ? `github-nanny-idle-${value.epoch}` : test ? 'github-nanny-test' : 'github-nanny-update',
    renotify: test, icon: '/icons/icon-192.png', data: runUrl ? { runUrl } : { path: '/' },
  }));
});
const CLICK_VERSION = 'tap-v2';
const CLICK_CACHE = 'github-nanny-click-diagnostic-v1';
const CLICK_KEY = new URL('/__local_notification_click', self.location.origin).href;
let lastClick = null;
function rememberClick(value) {
  lastClick = value;
  return caches.open(CLICK_CACHE).then(cache => cache.put(CLICK_KEY,
    new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } }))).catch(() => {});
}
function clickError(error) {
  return ['InvalidAccessError', 'NotAllowedError', 'TypeError', 'SecurityError'].includes(error?.name) ? error.name : 'OtherError';
}
self.addEventListener('message', event => {
  if (event.data?.kind !== 'notification-click-diagnostic' || !event.ports?.[0]) return;
  event.waitUntil((async () => {
    let saved = lastClick;
    if (!saved) try { saved = await (await caches.open(CLICK_CACHE)).match(CLICK_KEY).then(response => response?.json()); } catch { /* Local storage can be blocked. */ }
    event.ports[0].postMessage({ version: CLICK_VERSION, lastClick: saved ?? null });
  })());
});
self.addEventListener('notificationclick', event => {
  const target = new URL('/', self.location.origin);
  const runUrl = safeRunUrl(event.notification.data?.runUrl);
  if (runUrl) target.hash = new URLSearchParams({ 'idle-run': runUrl }).toString();
  event.notification.close();
  // Invoke the browser navigation in the original tap task, before storage,
  // client enumeration or navigation can consume/lose transient activation.
  let opening;
  try { opening = self.clients.openWindow(target.href); }
  catch (error) { opening = Promise.reject(error); }
  const record = { version: CLICK_VERSION, at: new Date().toISOString(), outcome: 'received', error: null };
  const received = rememberClick({ ...record });
  event.waitUntil((async () => {
    try {
      const opened = await opening;
      record.outcome = opened ? 'opened' : 'no-window';
    } catch (error) {
      record.outcome = 'blocked'; record.error = clickError(error);
      // A surviving app window can still be usable. Focus before navigating:
      // navigation can replace the document that held user activation.
      try {
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of windows) if (new URL(client.url).origin === self.location.origin) {
          try {
            await client.focus();
            record.outcome = 'focused';
            const navigated = await client.navigate(target.href);
            record.outcome = navigated ? 'navigated' : 'focused';
            break;
          } catch (fallbackError) { record.error = clickError(fallbackError); }
        }
      } catch (fallbackError) { record.error = clickError(fallbackError); }
    }
    await received;
    await rememberClick({ ...record });
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('github-nanny-offline-') && key !== OFFLINE_CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(async () =>
      (await caches.match(OFFLINE_URL)) || new Response('Offline', { status: 503 })));
  }
});
