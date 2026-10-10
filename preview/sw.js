/* Cache app code only. No health, workout, or other user records are cached here. */
const SHELL = 'overload-shell-v4-3themes-data-safe';
const ASSETS = ['./','./index.html','./styles.css','./app.js','./manifest.webmanifest','./icon.svg'];
self.addEventListener('install',ev=>ev.waitUntil(caches.open(SHELL).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',ev=>ev.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith('overload-shell-')&&k!==SHELL).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',ev=>{const u=new URL(ev.request.url);if(ev.request.method!=='GET'||u.origin!==location.origin)return;if(!ASSETS.some(a=>new URL(a,location.href).pathname===u.pathname))return;ev.respondWith(caches.match(ev.request).then(m=>m||fetch(ev.request)));});
