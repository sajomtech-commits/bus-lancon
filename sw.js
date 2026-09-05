const CACHE='bus-lancon-v1';
const ASSETS=['./','./index.html','./manifest.json','./pdfs/ligne-12.pdf','./pdfs/ligne-17.pdf','./pdfs/ligne-580.pdf'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)))});
self.addEventListener('fetch',e=>{e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(res=>{caches.open(CACHE).then(c=>c.put(e.request,res.clone()));return res})))});
