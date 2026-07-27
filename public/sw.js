"use strict";

const CACHE_NAME = "arena-commander-stable-v63.1.2";

const STARTUP_FILES = [
  "/arena-commander-ui.css?v=63.0.0",
  "/mobile-hand-api-fix-v63-1-2.css?v=63.1.2",
  "/arena-commander-runtime.js?v=63.0.0",
  "/arena-commander-multiplayer.js?v=63.0.0",
  "/arena-commander-mobile.js?v=63.1.2",
  "/mobile-hand-api-fix-v63-1-2.js?v=63.1.2",
  "/arena-final-v61.css?v=63.0.0",
  "/artwork-leave-fix-v61-2.css?v=63.0.0",
  "/gameplay-automation-v62.css?v=63.0.0",
  "/tabletop-fix-v62-1.css?v=63.0.0",
  "/tabletop-fix-v62-2.css?v=63.0.0",
  "/home-stability-v62-3.css?v=63.0.0",
  "/tabletop-fix-v62-4.css?v=63.0.0",
  "/hand-collapse-v62-6.css?v=63.0.0",
  "/mobile-table-v62-8.css?v=63.0.0",
  "/hidden-v59.css?v=62.5.0",
  "/hidden-v59.js?v=63.1.2",
  "/mtg-card-back-v62-1.png?v=62.1.0",
  "/",
  "/index.html",
  "/styles.css",
  "/clean-home.css?v=39.0.0",
  "/meta-library.css?v=39.0.0",
  "/commander-theme.css?v=39.0.0",
  "/mobile-safe-v60-5.css?v=60.5.0",
  "/performance-v60-6.css?v=60.6.0",
  "/socket-mobile-v60-4.js?v=60.4.0",
  "/startup-session-v60-7.js?v=60.7.0",
  "/performance-bootstrap-v60-6.js?v=60.6.0",
  "/app.js?v=63.1.1",
  "/gameplay-hotfix.js?v=40.1.1",
  "/deck-import-fix.js?v=39.2.0",
  "/clean-home.js?v=39.0.0",
  "/meta-library.js?v=39.0.0",
  "/lobby-notifier-ui.js?v=39.1.0",
  "/performance-lite-v60-6.js?v=60.6.0",
  "/repair-v60-6.html",
  "/reset-session.html",
  "/manifest.webmanifest?v=60.6.0",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STARTUP_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith("arena-commander") && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/socket.io/") ||
    url.pathname.startsWith("/api/")
  ) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          caches.open(CACHE_NAME)
            .then((cache) => cache.put(request, response.clone()))
            .catch(() => undefined);
        }
        return response;
      })
      .catch(() => caches.match(request)
        .then((cached) => cached || caches.match("/index.html")))
  );
});
