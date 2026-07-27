const CACHE='lumen-ai-v1.3';
const ASSETS=['/','/index.html','/manifest.webmanifest','/lumen-ai-logo.svg','/icons/icon-192.png','/icons/icon-512.png','/icons/apple-touch-icon.png','/favicon.ico'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET') return;
  event.respondWith(fetch(event.request).catch(()=>caches.match(event.request).then(r=>r||caches.match('/index.html'))));
});
