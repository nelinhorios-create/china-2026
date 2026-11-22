// Service worker: guarda o app e as fotos para abrir sem internet e mostra as notificações.
const VERSION = "c26-v1";
const SHELL = ["./", "index.html", "config.js", "manifest.webmanifest", "icon-192.png", "icon-512.png",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => Promise.allSettled(SHELL.map(u => c.add(u)))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if(req.method !== "GET") return;
  // Supabase (dados e login) sempre pela rede; o app guarda a própria cópia dos dados
  if(url.hostname.endsWith("supabase.co") || url.hostname.endsWith("supabase.in")) return;
  // páginas e config: rede primeiro (pega a versão nova), cópia se estiver sem internet
  if(req.mode === "navigate" || url.pathname.endsWith("config.js") || url.pathname.endsWith("index.html")){
    e.respondWith(fetch(req).then(r => { const c = r.clone(); caches.open(VERSION).then(x => x.put(req, c)); return r; })
      .catch(() => caches.match(req).then(r => r || caches.match("index.html"))));
    return;
  }
  // fotos, ícones, fontes e bibliotecas: cópia primeiro
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => {
    if(r.ok || r.type === "opaque"){ const c = r.clone(); caches.open(VERSION).then(x => x.put(req, c)); }
    return r;
  })));
});

self.addEventListener("push", e => {
  let d = {};
  try{ d = e.data ? e.data.json() : {}; }catch(err){ d = {title:"China 2026", body:e.data ? e.data.text() : ""}; }
  e.waitUntil(self.registration.showNotification(d.title || "China 2026", {
    body:d.body || "", tag:d.tag || undefined, renotify:!!d.tag, icon:"icon-192.png", badge:"icon-192.png",
    data:{url:d.url || "./"}
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const target = new URL(e.notification.data && e.notification.data.url || "./", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({type:"window", includeUncontrolled:true}).then(list => {
    for(const c of list){ if(c.url.startsWith(self.registration.scope) && "focus" in c){ c.navigate(target); return c.focus(); } }
    return self.clients.openWindow(target);
  }));
});
