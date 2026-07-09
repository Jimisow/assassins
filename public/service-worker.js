// Service worker minimal : met en cache le shell statique de la PWA pour un
// chargement rapide. Le jeu depend de Firestore pour tout le temps reel, donc
// aucun objectif de fonctionnement 100% hors-ligne : les requetes vers
// Firebase (autre origine) ne sont jamais interceptees ici.
const CACHE_NAME = "assassins-shell-v3";
const SHELL_ASSETS = [
  "/",
  "/index.html",
  "/host.html",
  "/player.html",
  "/manifest.json",
  "/css/style.css",
  "/js/firebase-config.js",
  "/js/lobby.js",
  "/js/chat.js",
  "/js/roles.js",
  "/js/night-cycle.js",
  "/js/host.js",
  "/js/player.js",
  "/js/ui-utils.js",
  "/js/network-status.js",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // On ne touche qu'aux requetes GET de meme origine (le shell statique).
  // Tout le reste (Firestore, autres origines) part directement au reseau.
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
