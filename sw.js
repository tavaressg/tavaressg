const CACHE = 'yama-v1';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './app.css',
  './fonts.css',
  './manifest.json',
  './logo.png',
  './yama-logo.png',
  './fonts/montserrat-400.woff2',
  './fonts/montserrat-500.woff2',
  './fonts/montserrat-600.woff2',
  './fonts/montserrat-700.woff2',
  './fonts/montserrat-800.woff2',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).then(resp => {
      const clone = resp.clone();
      caches.open(CACHE).then(c => c.put(e.request, clone));
      return resp;
    })).catch(() => caches.match('./index.html'))
  );
});
