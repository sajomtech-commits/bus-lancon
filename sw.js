const CACHE = 'bus-lancon-v5';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './horaires.json',
  './pdfs/ligne-12.pdf',
  './pdfs/ligne-12-retour.pdf',
  './pdfs/ligne-17.pdf',
  './pdfs/ligne-530.pdf',
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (e.request.method !== 'GET') return;
  // Navigation & HTML : réseau d'abord (toujours la dernière version), sinon cache
  if (req.mode === 'navigate' || req.destination === 'document') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
    );
    return;
  }
  // Ressources : cache d'abord, sinon réseau puis mise en cache
  e.respondWith(
    caches.match(req).then((r) => {
      const fallback = fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      });
      return r || fallback;
    }).catch(() => caches.match(req))
  );
});