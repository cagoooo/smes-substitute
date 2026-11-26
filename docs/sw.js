const BUILD_VERSION = '2026.11.26-6';   // 每次部署改它（bump-version.ps1 會一起改）
const CACHE = 'smes-sub-' + BUILD_VERSION;
const PRECACHE = [
  './', './index.html', './favicon.svg', './favicon.ico', './apple-touch-icon.png',
  './manifest.webmanifest', './icon-192.png', './icon-512.png', './og-preview.png'
];

self.addEventListener('install', (e) => {
  // 不自動 skipWaiting → 讓新 SW 進 waiting，由使用者在通知列決定何時套用
  e.waitUntil(caches.open(CACHE).then(c =>
    Promise.allSettled(PRECACHE.map(u => c.add(u).catch(() => {})))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('smes-sub-') && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
    (await self.clients.matchAll({ type: 'window' }))
      .forEach(c => c.postMessage({ type: 'SW_ACTIVATED', version: BUILD_VERSION }));
  })());
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url; try { url = new URL(req.url); } catch { return; }
  if (url.origin !== self.location.origin) return;   // 只處理同源；GAS API 走網路
  if (url.pathname.endsWith('version.json')) {         // 版本檔永遠拿最新
    e.respondWith(fetch(req).catch(() => caches.match(req))); return;
  }
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    // HTML network-first，且一律向伺服器確認（cache:'no-cache'，沒變只回 304）：
    // GitHub Pages 的 HTML 是 max-age=600，直接 fetch(req) 會吃到瀏覽器 10 分鐘內的舊網頁。
    // 導覽請求不能 new Request(req, init)（mode 'navigate' 會丟錯），要用網址重建；
    // redirect:'manual' 讓 GitHub Pages 的 301（少結尾斜線）交回瀏覽器處理。
    const fresh = req.mode === 'navigate'
      ? new Request(req.url, { method: 'GET', cache: 'no-cache', credentials: 'same-origin', redirect: 'manual' })
      : new Request(req, { cache: 'no-cache' });
    e.respondWith(fetch(fresh).then(res => {
      if (res && res.ok && res.type === 'basic') {
        const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req).then(r => r || caches.match('./index.html')))); return;
  }
  e.respondWith(caches.match(req).then(cached => {      // 其他資源 cache-first + 背景更新
    const net = fetch(req).then(res => {
      if (res && res.status === 200 && res.type === 'basic') {
        const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy));
      } return res;
    }).catch(() => cached);
    return cached || net;
  }));
});
