const scope = self.registration.scope;
const cacheName = "zenith-sudoku-cache-1.1.0-iphone1";
const appFiles = [
  "./",
  "./index.html",
  "./manifest.json",
  "./offline-state.js",
  "./local-backup.js",
  "./backup-ui.js",
  "./assets/index-5A7zXtsj.js",
  "./assets/sudoku-core.js",
  "./assets/index-wdCE_Sf4.css",
  "./assets/polyfills-Dsx7USdx.js",
  "./assets/xinweimei-sudoku-icon-BbJwgseY.png",
  "./fonts/inter-latin.woff2",
  "./icon-180.png",
  "./icon-192.png",
  "./icon-512.png",
].map(path => new URL(path, scope).href);
const appUrls = new Set(appFiles);

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    await cache.addAll(appFiles.map(url => new Request(url, {cache: "reload"})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const all = await caches.keys();
    await Promise.all(all.filter(key =>
      key !== cacheName && key.startsWith("zenith-sudoku-cache-")
    ).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET" || !appUrls.has(request.url)) return;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    return await cache.match(request) || fetch(request);
  })());
});

self.addEventListener("message", event => {
  if (event.data?.type !== "sudoku-offline-status" || !event.ports[0]) return;
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    const cached = new Set((await cache.keys()).map(request => request.url));
    event.ports[0].postMessage({
      version: cacheName,
      ready: appFiles.every(url => cached.has(url)),
    });
  })());
});
