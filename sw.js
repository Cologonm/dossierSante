// Service worker : met le code de l'app en cache pour qu'elle s'ouvre sans réseau.
// Il ne voit jamais tes données (elles sont dans IndexedDB, chiffrées).
const VERSION = 'v1';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'app/main.js',
  'app/dom.js',
  'app/vault.js',
  'app/crypto.js',
  'app/store.js',
  'app/dates.js',
  'app/pdf.js',
  'app/ui.css',
  'vendor/pdf-lib.esm.min.js',
  'ds/dist/tokens.css',
  'ds/styles/foundation.css',
  'ds/fonts/Recia-VariableItalic.woff2',
  'ds/fonts/Synonym-Variable.woff2',
  'ds/assets/figurines/iso-09.png',
  'ds/assets/figurines/iso-14.png',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== VERSION).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()));
});

// Réseau d'abord (pour recevoir les mises à jour), cache si hors ligne.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(request, copy));
        }
        return res;
      })
      .catch(() => caches.match(request, { ignoreSearch: true })));
});
