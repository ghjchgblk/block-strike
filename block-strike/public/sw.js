// 讓遊戲可以「加到主畫面」。永遠先抓最新版，沒網路時才用上次存的。
const CACHE = 'block-strike-v1';
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.pathname === '/ws' || u.pathname === '/config.json') return;
  e.respondWith(fetch(e.request).then(r => { if (r.ok && (u.origin === location.origin || /cdnjs|jsdelivr/.test(u.host))) { const c = r.clone(); caches.open(CACHE).then(cc => cc.put(e.request, c)); } return r; })
    .catch(() => caches.match(e.request)));
});
