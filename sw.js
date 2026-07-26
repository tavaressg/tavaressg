// SERVICE WORKER PUSH-ONLY (v305).
//
// Substitui o kill-switch anterior. A decisão de "app online-only, sem cache
// offline" CONTINUA VALENDO: este SW não tem handler de `fetch`, então não
// intercepta requisição nenhuma — tudo segue indo direto pra rede/Supabase.
// Ele existe só porque Web Push exige um SW vivo pra receber a mensagem
// quando o app está fechado.
//
// Ao ativar, ainda apaga caches remanescentes de instalações antigas
// (a versão cache-first pré-v2xx) — mas NÃO se desregistra mais.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    try { const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k))); } catch (_) {}
    try { await self.clients.claim(); } catch (_) {}
  })());
});

// Notificação recebida com o app fechado ou em segundo plano.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data && e.data.text() }; }
  const title = d.title || 'Yama Jiu-Jitsu';
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || '',
    icon: 'brand/icon-192.png',
    badge: 'brand/icon-192.png',
    tag: d.tag || 'yama-aviso',      // mesma tag substitui — nunca empilha
    data: { url: d.url || '/' },
  }));
});

// Toque na notificação: foca a aba aberta (se houver) em vez de abrir outra.
// SEGURANÇA: a URL vem do payload do push. Se o token da Edge Function vazar,
// um atacante mandaria notificação com a cara da academia apontando pra um site
// de phishing. Aqui só se navega para a PRÓPRIA origem — qualquer coisa externa
// (ou malformada) cai na home. Defesa em profundidade: vale mesmo com o token
// intacto, porque o custo é uma linha e o estrago evitado é grande.
function _urlSegura(u) {
  try {
    const alvo = new URL(u || '/', self.registration.scope);
    return alvo.origin === self.location.origin ? alvo.href : self.registration.scope;
  } catch (_) { return self.registration.scope; }
}

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const alvo = _urlSegura(e.notification.data && e.notification.data.url);
  e.waitUntil((async () => {
    const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of cs) {
      if ('focus' in c) { try { await c.navigate(alvo); } catch (_) {} return c.focus(); }
    }
    if (self.clients.openWindow) return self.clients.openWindow(alvo);
  })());
});
