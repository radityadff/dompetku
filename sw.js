/* DompetKu – Service Worker: aplikasi tetap terbuka cepat & bisa dipakai saat sinyal lemah.
   Data transaksi TIDAK disimpan di sini; hanya file tampilan aplikasi. */
const CACHE = 'dompetku-v1.2.0';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'manifest.webmanifest?v=2',
  'icons/icon-v2.svg', 'icons/icon-192-v2.png', 'icons/icon-512-v2.png', 'icons/apple-touch-icon-v2.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;               // permintaan ke spreadsheet tidak pernah di-cache
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isFont = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (!sameOrigin && !isFont) return;

  // Halaman utama: ambil versi terbaru dari internet dulu (agar pembaruan langsung terlihat),
  // pakai versi tersimpan hanya saat offline.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req, { cache: 'no-store' }).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put('index.html', copy));
      return res;
    }).catch(() => caches.match('index.html').then((r) => r || caches.match('./'))));
    return;
  }

  // File lain: tampilkan versi tersimpan, perbarui di latar belakang.
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(req, { ignoreSearch: sameOrigin && req.mode === 'navigate' });
    const network = fetch(req).then((res) => {
      if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
      return res;
    }).catch(() => cached);
    return cached || network;
  }));
});
