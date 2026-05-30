// Service Worker for BIST Borsa Analiz PWA
const CACHE_NAME = 'Temist-v3';
const DATA_CACHE = 'Temist-data-v3';

// Static assets — cache-first
const STATIC_ASSETS = [
  '/Temist/',
  '/Temist/index.html',
  '/Temist/favicon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME && k !== DATA_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (!event.request.url.startsWith('http')) return;
  const url = new URL(event.request.url);

  // HTML / navigation requests: network-first, fallback to cache
  if (
    event.request.mode === 'navigate' ||
    url.pathname.endsWith('.html') ||
    url.pathname === '/Temist/' ||
    url.pathname === '/Temist/index.html'
  ) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Data JSON files: network-first, fallback to cache
  if (url.pathname.includes('/data/')) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const clone = res.clone();
          caches.open(DATA_CACHE).then((cache) => cache.put(event.request, clone));
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Static assets: cache-first, fallback to network
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((res) => {
        // Cache JS/CSS bundles on first load
        if (res.ok && (url.pathname.endsWith('.js') || url.pathname.endsWith('.css'))) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return res;
      });
    })
  );
});
