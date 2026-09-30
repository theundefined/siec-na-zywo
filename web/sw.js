// Service worker: pozwala zainstalować stronę jako aplikację i otworzyć ją bez sieci (ostatnia wersja plików strony).
// Dane (PSE, ENTSOG, pliki aplikacji, ceny gazu) zawsze pobieramy z sieci — nie są buforowane.
const CACHE = 'siec-na-zywo-v9';
const SHELL = ['./', 'index.html', 'gaz.html', 'style.css', 'app.js', 'gas.js', 'common.js', 'charts.js', 'stats.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Pliki strony: najpierw sieć (zawsze świeża wersja), bufor tylko awaryjnie bez połączenia.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/data/')) return;
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return r;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
