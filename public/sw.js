"use strict";

const CACHE_NAME = "arena-commander-walkers-v52.0.0";
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
  "/arena-table-v41-1.css?v=41.1.0",
  "/arena-autotap-v42.css?v=42.0.0",
  "/zone-choices-v43.css?v=43.0.0",
  "/targeting-v44.css?v=44.0.0",
  "/effects-v45.css?v=45.0.0",
  "/mechanics-v46.css?v=46.0.0",
  "/permissions-v47.css?v=47.0.0",
  "/triggers-v48.css?v=48.0.0",
  "/forms-v49.css?v=49.0.0",
  "/casting-v50.css?v=50.0.0",
  "/combat-v51.css?v=51.0.0",
  "/walkers-v52.css?v=52.0.0",
  "/app.js",
  "/deck-import-fix.js?v=39.2.0",
  "/card-automation-ui.js?v=40.0.0",
  "/gameplay-hotfix.js?v=40.1.0",
  "/arena-table-v41-1.js?v=41.1.0",
  "/arena-table-v41.js?v=41.0.0",
  "/arena-autotap-v42.js?v=42.0.0",
  "/zone-choices-v43.js?v=43.0.0",
  "/targeting-v44.js?v=44.0.0",
  "/effects-v45.js?v=45.0.0",
  "/mechanics-v46.js?v=46.0.0",
  "/permissions-v47.js?v=47.0.0",
  "/triggers-v48.js?v=48.0.0",
  "/forms-v49.js?v=49.0.0",
  "/casting-v50.js?v=50.0.0",
  "/combat-v51.js?v=51.0.0",
  "/walkers-v52.js?v=52.0.0",
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
