const CACHE = 'yama-v121';
const ASSETS = [
  './',
  './index.html',
  './app.js?v=121',
  './app.css?v=84',
  './fonts.css?v=1',
  './manifest.json?v=2',
  './logo.png',
  './yama-logo.png',
  './fonts/montserrat-400.woff2',
  './fonts/montserrat-500.woff2',
  './fonts/montserrat-600.woff2',
  './fonts/montserrat-700.woff2',
  './fonts/montserrat-800.woff2'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(resp => {
        if (!resp || resp.status !== 200 || resp.type !== 'basic') return resp;
        const clone = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return resp;
      });
    }).catch(() => caches.match('./index.html'))
  );
});
