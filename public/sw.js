// Cache only the offline document. Status/API responses and authenticated
// requests must never be replayed as live data by a service worker.
const OFFLINE_CACHE = 'github-nanny-offline-v1';
self.addEventListener('install', event => {
  event.waitUntil(caches.open(OFFLINE_CACHE).then(cache => cache.add('/offline.html')));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('github-nanny-offline-') && key !== OFFLINE_CACHE).map(key => caches.delete(key)))));
});
self.addEventListener('fetch', event => {
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(async () =>
      (await caches.match('/offline.html')) || new Response('Offline', { status: 503 })));
  }
});
