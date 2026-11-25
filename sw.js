// Service worker: maakt de app installeerbaar en laat de schil offline openen.
// Koersen zelf worden nooit door deze worker gecachet (die zitten in localStorage).
const CACHE = "koersen-v9";
const SHELL = ["./", "index.html", "style.css", "manifest.webmanifest", "js/storage.js", "js/analysis.js", "js/providers.js", "js/prices.js", "js/sync.js", "js/ocr.js", "js/sealedbox.js", "js/vendor/blake2b.js", "js/app.js", "icons/icon-192.png"];
self.addEventListener("install", (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // proxy's en CDN gewoon via het netwerk
  // eerst netwerk (altijd nieuwste versie), anders de cache
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
});
