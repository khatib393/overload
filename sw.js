/* Only app shell is cached. Never touch IndexedDB, LocalStorage, or private records. */
const SHELL='overload-shell-v9-2-5';
const ASSETS=['./','./index.html','./styles.css?v=2-5','./app.js?v=2-5','./version.json','./manifest.webmanifest','./icon.svg'];
self.addEventListener('install',event=>event.waitUntil(caches.open(SHELL).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>(k.startsWith('overload-shell-')||k==='overload-v2')&&k!==SHELL).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('message',event=>{if(event.data==='SKIP_WAITING')self.skipWaiting()});
self.addEventListener('fetch',event=>{
 const req=event.request,u=new URL(req.url);
 if(req.method!=='GET'||u.origin!==self.location.origin||!u.pathname.startsWith(new URL('./',self.registration.scope).pathname))return;
 if(!req.mode.includes('navigate')&&!ASSETS.some(asset=>new URL(asset,self.registration.scope).pathname===u.pathname))return;
 event.respondWith((async()=>{
  const cache=await caches.open(SHELL);
  try{const response=await fetch(req,{cache:'no-store'});if(response.ok)await cache.put(req,response.clone()).catch(()=>{});return response}
  catch(err){const cached=await cache.match(req,{ignoreSearch:true});if(cached)return cached;throw err}
 })());
});
