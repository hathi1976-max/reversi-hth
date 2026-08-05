/* Service Worker für Reversi.
 *
 * Strategie: **network-first** für die eigenen Dateien. Der Cache ist reiner
 * Offline-Rückfall. Cache-first wäre für ein Offline-Spiel zwar vertretbar,
 * hat aber in mehreren Sitzungen Tests verfälscht: Der Browser servierte den
 * alten Stand, und geprüft wurde Code, der gar nicht mehr galt.
 *
 * Trotzdem gilt weiter: Bei jeder Änderung an ausgelieferten Dateien `CACHE`
 * hochzählen, damit installierte Apps den alten Bestand verwerfen.
 */
const CACHE = "reversi-v6";
const SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./engine.js",
  "./ai-worker.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

// Nur diese Adressen werden nachgecacht – sonst landet z. B. der Testlauf
// unter tests/ im App-Cache und wird offline als App-Datei ausgeliefert.
const SHELL_URLS = new Set(SHELL.map((p) => new URL(p, self.location).href));

self.addEventListener("install", (e) => {
  // skipWaiting gehört in die Kette: sonst kann es laufen, bevor der Cache
  // gefüllt ist, und der neue Worker übernimmt ohne App-Shell.
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    fetch(e.request)
      .then((resp) => {
        // Nur brauchbare Antworten cachen – sonst liegt später eine
        // Fehlerseite im Cache und wird offline als App ausgeliefert.
        if (resp.ok && SHELL_URLS.has(url.href)) {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return resp;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match("./index.html")))
  );
});
