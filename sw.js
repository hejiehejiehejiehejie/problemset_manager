const CACHE_NAME = "plm-cache-v6";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
  "./supabase-config.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null)))
    )
  );
  self.clients.claim();
});

// 仅缓存同源 GET；导航失败时回退 index.html；其余失败返回 503
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  e.respondWith((async () => {
    try {
      const resp = await fetch(req);
      const copy = resp.clone();
      caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
      return resp;
    } catch {
      const cached = await caches.match(req);
      if (cached) return cached;
      if (req.mode === "navigate") return caches.match("./index.html");
      return new Response("Offline", { status: 503, statusText: "Offline" });
    }
  })());
});
