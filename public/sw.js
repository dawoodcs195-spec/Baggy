/* BA GGY service worker — installable app + offline shell.
 *
 * Deliberately conservative:
 *  - only GET requests, same-origin
 *  - never intercepts /api, /admin, /checkout, /account, /cart, /orders (money
 *    and account traffic always goes to the network)
 *  - pages: network-first (fresh HTML wins, cache is the offline fallback)
 *  - /public/* assets: stale-while-revalidate (instant paint, then refresh)
 */
const VERSION = 'baggy-v1';
const OFFLINE_URLS = [
  '/',
  '/public/css/main.css',
  '/public/js/main.js',
  '/public/images/icon.svg',
  '/public/images/placeholder.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(OFFLINE_URLS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

const PRIVATE = /^\/(api|admin|checkout|account|cart|orders|wishlist|track)(\/|$)/;

async function networkFirst(request) {
  const cache = await caches.open(VERSION);
  try {
    const response = await fetch(request);
    // Only cache real, complete HTML documents
    if (response && response.ok && response.type === 'basic') {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    const shell = await cache.match('/');
    if (shell) return shell;
    throw err;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(request);
  const network = fetch(request).then((response) => {
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => cached);
  return cached || network;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (PRIVATE.test(url.pathname)) return;

  if (url.pathname.startsWith('/public/')) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
  }
});
