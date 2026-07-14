// KILL-SWITCH — o app deixou de usar cache offline (decisão do usuário: sempre online via Supabase).
// Este Service Worker NÃO cacheia nada. Ao ativar, apaga todos os caches, se desregistra e
// recarrega as abas abertas. Instalações antigas (que tinham o SW cache-first) são limpas
// automaticamente: o navegador re-busca este script no próximo acesso, instala esta versão e
// ela se autodestrói. O app.js também não registra mais nenhum SW (fica só o manifest/instalável).
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    try { const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k))); } catch (_) {}
    try { await self.registration.unregister(); } catch (_) {}
    try { const cs = await self.clients.matchAll(); cs.forEach(c => c.navigate(c.url)); } catch (_) {}
  })());
});
