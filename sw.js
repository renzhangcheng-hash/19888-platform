// 19888 Service Worker — Cache-First with version hash for update detection
const CACHE_NAME = '19888-v2-4a7b9c';
const CACHE_ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/manifest.json'
];

// Install: pre-cache critical assets
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(CACHE_ASSETS).catch(err => {
        console.warn('SW: pre-cache partial failure', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fetch: Cache-First for CSS/JS/images/HTML, Network-First for API
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Skip non-GET requests
  if (e.request.method !== 'GET') return;

  // Cache-First for static assets
  if (
    url.pathname.match(/\.(css|js|png|webp|jpg|jpeg|gif|svg|ico|woff2?)$/i) ||
    url.pathname === '/' ||
    url.pathname.endsWith('.html') ||
    url.pathname === '/manifest.json'
  ) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) {
          // Refresh cache in background (stale-while-revalidate)
          fetch(e.request).then(res => {
            if (res.ok) {
              caches.open(CACHE_NAME).then(cache => cache.put(e.request, res));
            }
          }).catch(() => {});
          return cached;
        }
        return fetch(e.request).then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
          }
          return res;
        });
      })
    );
    return;
  }

  // Network-First for API calls
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return res;
      }).catch(() => {
        return caches.match(e.request);
      })
    );
    return;
  }

  // Default: network with cache fallback
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok) {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
      }
      return res;
    }).catch(() => caches.match(e.request))
  );
});
