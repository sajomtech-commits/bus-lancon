const CACHE='bus-lancon-v2';
const ASSETS=['./','./index.html','./manifest.json','./horaires.json','./pdfs/ligne-12.pdf','./pdfs/ligne-12-retour.pdf','./pdfs/ligne-17.pdf','./pdfs/ligne-530.pdf'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)))});
self.addEventListener('fetch',e=>{e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(res=>{caches.open(CACHE).then(c=>c.put(e.request,res.clone()));return res})))});
