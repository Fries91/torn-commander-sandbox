"use strict";

const CACHE_NAME =
  "arena-commander-session-v60.7.0";

const STARTUP_FILES = [
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
  "/app.js?v=60.7.0",
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
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        cache.addAll(STARTUP_FILES)
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key.startsWith("arena-commander") &&
                key !== CACHE_NAME
            )
            .map((key) =>
              caches.delete(key)
            )
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);

  if (
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/socket.io/") ||
    url.pathname.startsWith("/api/")
  ) {
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          caches
            .open(CACHE_NAME)
            .then((cache) =>
              cache.put(
                request,
                response.clone()
              )
            )
            .catch(() => undefined);
        }

        return response;
      })
      .catch(() =>
        caches
          .match(request)
          .then(
            (cached) =>
              cached ||
              caches.match("/index.html")
          )
      )
  );
});
