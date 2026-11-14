const CACHE = "loves-stories-pedido-total-adjunto-v2";
const DOWNLOAD_PATH = /^\/pedido-total-pdf\/(\d{13})-[\da-f-]{36}\.pdf$/;
const LIFETIME = 5 * 60_000;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const match = DOWNLOAD_PATH.exec(url.pathname);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || !match) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const response = await cache.match(url.href);
    if (!response || Date.now() - Number(match[1]) > LIFETIME) {
      await cache.delete(url.href);
      return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
    }

    return response;
  })());
});
