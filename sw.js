/**
 * sw.js – Service Worker für Offline-Betrieb.
 *
 * Update-Ablauf: CACHE_VERSION erhöhen → Browser lädt neuen Worker → alle Dateien
 * werden frisch in einen neuen Cache geladen → die App zeigt "Neue Version verfügbar"
 * → nach Tipp auf "Aktualisieren" übernimmt der neue Worker und alte Caches werden gelöscht.
 */
const CACHE_VERSION = 'v1.0.0';
const CACHE = `kopfrechnen-${CACHE_VERSION}`;

const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './levels.js',
  './generator.js',
  './storage.js',
  './manifest.json',
  './icons/icon.svg',
  './icons/favicon-32.png',
  './icons/apple-touch-icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // cache: 'reload' umgeht den HTTP-Cache, damit wirklich die neue Version landet.
      cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' }))),
    ),
  );
  // Kein automatisches skipWaiting: Die App fragt nach, damit keine Runde unterbrochen wird.
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('kopfrechnen-') && k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Seitenaufrufe: Cache zuerst (sofortiger Start, auch offline), Updates kommen über den Worker.
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html', { cacheName: CACHE }).then((hit) => hit || fetch(request)),
    );
    return;
  }

  // Übrige Dateien: Cache zuerst, sonst Netz (und nachträglich cachen, z. B. Splash-Bilder).
  event.respondWith(
    caches.match(request, { cacheName: CACHE, ignoreSearch: true }).then(
      (hit) =>
        hit ||
        fetch(request).then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return res;
        }),
    ),
  );
});
