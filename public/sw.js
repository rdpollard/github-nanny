// Cache only the offline document. Status/API responses and authenticated
// requests must never be replayed as live data by a service worker.
const OFFLINE_CACHE = 'github-nanny-offline-v2';
// Workers static assets redirects /offline.html to /offline. Cache the
// canonical URL so a redirected Response is never replayed for a navigation.
const OFFLINE_URL = '/offline';
self.addEventListener('install', event => {
  event.waitUntil(caches.open(OFFLINE_CACHE).then(cache => cache.add(OFFLINE_URL)));
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
