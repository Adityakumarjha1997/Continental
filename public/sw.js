/* Avenza service worker: makes the app installable and gives an offline shell.
   Strategy: NETWORK-FIRST for the app shell/assets so a fresh deploy is picked
   up immediately (falling back to cache only when offline); API and websocket
   traffic is never cached (always hits the network).

   The cache name is versioned — bump it whenever the shell changes so old
   caches are purged on activate. This is the fix for "my changes don't show up
   after an update": network-first + a version bump guarantee fresh code online. */
const CACHE = 'avenza-v3-dinein';
const SHELL = [
  '/',
  '/index.html',
  '/owner.html',
  '/admin.html',
  '/waiter.html',
  '/kitchen.html',
  '/css/styles.css',
  '/js/api.js',
  '/js/customer.js',
  '/js/owner.js',
  '/js/admin.js',
  '/js/waiter.js',
  '/js/kitchen.js',
  '/icon.svg',
  '/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // let cross-origin assets pass through
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/')) return;

  // Network-first: always try the live version; cache it for offline; only fall
  // back to the cached copy when the network is unavailable.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
