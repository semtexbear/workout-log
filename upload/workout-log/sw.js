/**
 * sw.js – Service worker: makes the app work offline.
 *
 * On first visit, all app files are stored in a cache on the phone. After
 * that, every request is answered straight from the cache (instant, works
 * without internet). In the background the newest version is fetched and
 * stored, so after you publish an update it appears on the next app start.
 */

const CACHE = 'workout-log-v1';

const APP_FILES = [
  './',
  './index.html',
  './styles.css',
  './js/app.js',
  './js/db.js',
  './js/logic.js',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// 1. Install: download and cache all app files.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(APP_FILES))
      .then(() => self.skipWaiting()),
  );
});

// 2. Activate: remove caches from older versions of this file.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// 3. Fetch: answer from the cache, then refresh the cache from the network.
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request, { ignoreSearch: true });

    const fresh = fetch(request, { cache: 'no-cache' }).then((response) => {
      if (response.ok && !response.redirected) cache.put(request, response.clone());
      return response;
    });

    if (cached) {
      event.waitUntil(fresh.catch(() => {})); // offline: just keep the cached copy
      return cached;
    }
    try {
      return await fresh;
    } catch (err) {
      // Offline and not cached: for page loads, show the app itself.
      if (request.mode === 'navigate') return cache.match('./index.html');
      throw err;
    }
  })());
});
