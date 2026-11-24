// Cache only the offline document. Status/API responses and authenticated
// requests must never be replayed as live data by a service worker.
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
    renotify: test, icon: '/icon.svg', data: runUrl ? { runUrl } : { path: '/' },
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  // Keep the notification's first navigation inside the installed app's scope.
  // The dashboard offers an ordinary GitHub link instead of asking the browser
  // to launch another origin directly from a background service worker.
  const target = new URL('/', self.location.origin);
  const runUrl = safeRunUrl(event.notification.data?.runUrl);
  if (runUrl) target.hash = new URLSearchParams({ 'idle-run': runUrl }).toString();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) if (new URL(client.url).origin === self.location.origin) {
      try {
        const navigated = await client.navigate(target.href);
        if (navigated) return await navigated.focus();
      }
      catch { /* A closing window can disappear between matchAll and focus. */ }
    }
    const opened = await self.clients.openWindow(target.href);
    if (opened) return opened.focus();
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
