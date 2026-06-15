// 19888 Service Worker — v17 SELF-DESTRUCT (kill all caches, force reload)
const CACHE_NAME = "19888-v17-self-destruct";
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
    .then(() => self.clients.claim())
    .then(() => self.registration.unregister())  // Self-destruct
  );
});
