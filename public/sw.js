"use strict";

const CACHE_NAME = "arena-commander-table-v41.0.0";
const APP_SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/clean-home.css?v=39.0.0",
  "/meta-library.css?v=39.0.0",
  "/commander-theme.css?v=39.0.0",
  "/card-automation.css?v=40.0.0",
  "/gameplay-hotfix.css?v=40.1.0",
  "/arena-table-v41.css?v=41.0.0",
  "/app.js",
  "/deck-import-fix.js?v=39.2.0",
  "/card-automation-ui.js?v=40.0.0",
  "/gameplay-hotfix.js?v=40.1.0",
  "/arena-table-v41.js?v=41.0.0",
  "/clean-home.js?v=39.0.0",
  "/meta-library.js?v=39.0.0",
  "/lobby-notifier-ui.js?v=39.1.0",
  "/notifier-install.html",
  "/notifier-icon.svg",
  "/manifest.webmanifest",
  "/icon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
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
    url.pathname.startsWith("/api/") ||
    url.pathname.endsWith(".user.js")
  ) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => undefined);
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match("/index.html")))
  );
});
