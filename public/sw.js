// Cache only the offline document. Status/API responses and authenticated
// requests must never be replayed as live data by a service worker.
const OFFLINE_CACHE = 'github-nanny-offline-v2';
// Workers static assets redirects /offline.html to /offline. Cache the
// canonical URL so a redirected Response is never replayed for a navigation.
const OFFLINE_URL = '/offline';
self.addEventListener('install', event => {
  event.waitUntil(caches.open(OFFLINE_CACHE).then(cache => cache.add(OFFLINE_URL)).then(() => self.skipWaiting()));
});

// Explicit tests only in this release. Never turn a malformed message or a
// test notification into a claim that GitHub is idle.
self.addEventListener('push', event => {
  let test = false;
  try { const value = event.data?.json(); test = value?.version === 1 && value?.kind === 'test'; } catch { /* Show a neutral fallback. */ }
  event.waitUntil(self.registration.showNotification(test ? 'GitHub Nanny test' : 'GitHub Nanny', {
    body: test ? 'Push delivery is working. Automatic idle alerts are not enabled yet.' : 'Open GitHub Nanny to check current activity.',
    tag: test ? 'github-nanny-test' : 'github-nanny-update', icon: '/icon.svg', data: { path: '/' },
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    // Current messages always open this app. Payload data cannot choose an
    // external navigation target; idle run links are a later milestone.
    const target = new URL('/', self.location.origin).href;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) if (new URL(client.url).origin === self.location.origin) {
      try { await client.navigate(target); return await client.focus(); }
      catch { /* A closing window can disappear between matchAll and focus. */ }
    }
    return self.clients.openWindow(target);
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
