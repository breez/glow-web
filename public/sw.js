// Glow Service Worker
const CACHE_NAME = 'glow-v16';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/Glow_favicon.png',
  '/icons/Glow-icon-192.png',
  '/icons/Glow-icon-512.png',
  '/icons/Glow-icon-maskable-192.png',
  '/icons/Glow-icon-maskable-512.png',
  '/assets/Glow_Logo.png',
  '/assets/logo-breez-header.svg',
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching static assets');
      return cache.addAll(STATIC_ASSETS);
    })
  );
  // Activate immediately
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    })
  );
  // Take control of all pages immediately
  self.clients.claim();
});

// Fetch event - network first, fall back to cache
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip cross-origin requests
  if (!event.request.url.startsWith(self.location.origin)) return;

  // Skip API calls and WebSocket connections
  if (event.request.url.includes('/api/') ||
      event.request.url.includes('wss://') ||
      event.request.url.includes('ws://')) {
    return;
  }

  // Vite emits content-hashed, immutable files under /assets/ (the hash in the
  // filename changes whenever the content changes). Serve those cache-first so a
  // warm launch reads the ~11 MB wasm + JS bundle straight from cache instead of
  // re-fetching over the network. index.html / navigations stay network-first
  // (below) so a new deploy is always picked up. Non-hashed static assets
  // (e.g. /assets/Glow_Logo.svg) don't match and keep the network-first path.
  const path = new URL(event.request.url).pathname;
  const isHashedAsset = /\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.(js|mjs|css|wasm|woff2?|ttf)$/.test(path);
  if (isHashedAsset) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  event.respondWith(
    // Try network first
    fetch(event.request)
      .then((response) => {
        // Clone the response before caching
        const responseClone = response.clone();
        
        // Cache successful responses
        if (response.status === 200) {
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        
        return response;
      })
      .catch(() => {
        // Fall back to cache if network fails
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          
          // For navigation requests, return the cached index.html
          if (event.request.mode === 'navigate') {
            return caches.match('/index.html');
          }
          
          return new Response('Offline', { status: 503 });
        });
      })
  );
});
