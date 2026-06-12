// 19888 Service Worker — Network-First for HTML, Cache-First for assets
// v14: Lazy-load ethers/web3, better image caching
const CACHE_NAME = "19888-v14-lazy-web3";
const CACHE_ASSETS = [
  '/',
  '/index.html',
  '/offline.html',
  '/404.html',
  '/css/sunshine.css',
  '/js/app.js',
  '/manifest.json',
  '/robots.txt'
];

// Team logo cache name (separate, long-lived)
const LOGO_CACHE = '19888-logos-v1';

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

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(function(key) {
          return key !== CACHE_NAME && key !== LOGO_CACHE;
        }).map(function(key) {
          return caches.delete(key);
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  // HTML pages: Network-First (always get fresh version) with offline fallback
  if (url.pathname === '/' || url.pathname.endsWith('.html')) {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return res;
      }).catch(() => {
        return caches.match(e.request).then(cached => {
          return cached || caches.match('/offline.html');
        });
      })
    );
    return;
  }

  // Team logos: aggressive cache (Cache-First, long-lived)
  if (url.pathname.startsWith('/img/teams/')) {
    e.respondWith(
      caches.open(LOGO_CACHE).then(function(cache) {
        return cache.match(e.request).then(function(cached) {
          var fetched = fetch(e.request).then(function(res) {
            if (res.ok) {
              cache.put(e.request, res.clone());
            }
            return res;
          });
          return cached || fetched;
        });
      })
    );
    return;
  }

  // Static assets: Cache-First with background refresh
  if (url.pathname.match(/\.(css|js|png|webp|jpg|jpeg|gif|svg|ico|woff2?)$/i) ||
      url.pathname === '/manifest.json' ||
      url.pathname === '/robots.txt' ||
      url.pathname === '/sitemap.xml') {
    e.respondWith(
      caches.match(e.request).then(cached => {
        const fetched = fetch(e.request).then(res => {
          if (res.ok) {
            caches.open(CACHE_NAME).then(cache => cache.put(e.request, res.clone()));
          }
          return res;
        }).catch(() => cached);
        return cached || fetched;
      })
    );
    return;
  }

  // API: Network only — do NOT cache API responses
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(e.request).catch(function() {
        return new Response(JSON.stringify({ code: -1, error: 'offline' }), {
          status: 503, headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  // Default: network with cache fallback, then offline page
  e.respondWith(
    fetch(e.request).catch(() => {
      return caches.match(e.request);
    })
  );
});
