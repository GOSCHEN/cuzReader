// cuzReader service worker: app shell offline, network passthrough for data.
const VERSION = 'cr-v1.0.0';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/api.js', 'js/feeds.js', 'js/util.js', 'js/nav.js', 'js/sheet.js', 'js/ui.js',
  'js/feedview.js', 'js/detail.js', 'js/browser.js', 'js/github.js', 'js/bookmarks.js', 'js/filtersheet.js',
  'vendor/marked.esm.js', 'vendor/purify.es.mjs',
  'icons/icon.svg', 'icons/apple-touch-icon.png', 'icons/icon-192.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Stale-while-revalidate for the app shell.
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const hit = await cache.match(e.request, { ignoreSearch: true });
      const net = fetch(e.request).then((res) => {
        if (res.ok) cache.put(e.request, res.clone());
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
