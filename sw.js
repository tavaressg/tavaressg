const CACHE = 'yama-v139';
const ASSETS = [
  './',
  './index.html',
  './app.js?v=139',
  './app.css?v=98',
  './fonts.css?v=1',
  './manifest.json',
  './logo.png',
  './yama-logo.png',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png',
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
      .then(() => self.skipWaiting())   // auto-ativa: previne cache stale infinito
  );
});

// fallback: permite o app forçar update via postMessage({type:'SKIP_WAITING'})
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first para HTML/manifest (sempre busca versão nova; cai no cache se offline).
// Cache-first para tudo mais (assets versionados com ?v=N).
function isHTMLNav(req){
  if (req.mode === 'navigate') return true;
  const accept = req.headers.get('accept') || '';
  return accept.includes('text/html');
}
function isManifest(req){
  return req.url.endsWith('manifest.json') || req.url.includes('manifest.json?');
}

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const req = e.request;

  if (isHTMLNav(req) || isManifest(req)){
    e.respondWith(
      fetch(req).then(resp => {
        if (resp && resp.status === 200 && resp.type === 'basic'){
          const clone = resp.clone();
          caches.open(CACHE).then(c => c.put(req, clone));
        }
        return resp;
      }).catch(() => caches.match(req).then(c => c || caches.match('./index.html')))
    );
    return;
  }

  // demais assets: cache-first
  e.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(resp => {
        if (!resp || resp.status !== 200 || resp.type !== 'basic') return resp;
        const clone = resp.clone();
        caches.open(CACHE).then(c => c.put(req, clone));
        return resp;
      });
    }).catch(() => caches.match('./index.html'))
  );
});
