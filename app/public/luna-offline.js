/* Hosted offline map and science assets, stored on this device. */
const tiles = "luna-offline-tiles-v1";
const files = "luna-offline-files-v1";
const nasa = /^\/tiles\/Moon\/EQ\/(?:LRO_WAC_Mosaic_Global_303ppd_v02|LRO_LOLA_ClrShade_Global_256ppd_v06|LRO_LOLA_Shade_Global_128ppd_v04|LRO_LOLA_ClrSlope_Global_16ppd)\/1\.0\.0\/default\/default028mm\/\d+\/\d+\/\d+\.(?:jpg|png)$/;
self.addEventListener("install", (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin === "https://trek.nasa.gov" && nasa.test(url.pathname)) {
    event.respondWith(caches.open(tiles).then(async (cache) => (await cache.match(url.href)) || fetch(request)));
    return;
  }
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  const immutable = /^\/(?:assets|browser-data|browser-vendor|browser-spice)\//.test(url.pathname);
  event.respondWith(caches.open(files).then(async (cache) => {
    const stored = await cache.match(url.href);
    if (immutable && stored) return stored;
    try {
      const response = await fetch(request);
      if (response.ok || !stored) return response;
    } catch (error) {
      if (!stored) throw error;
    }
    return stored;
  }));
});
