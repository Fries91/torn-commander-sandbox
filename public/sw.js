"use strict";

const CACHE_NAME = "arena-commander-notifier-v39.0.0";
const APP_SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/clean-home.css?v=39.0.0",
  "/meta-library.css?v=39.0.0",
  "/commander-theme.css?v=39.0.0",
  "/app.js",
  "/clean-home.js?v=39.0.0",
  "/meta-library.js?v=39.0.0",
  "/lobby-notifier-ui.js?v=39.0.0",
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
  if (url.origin !== self.location.origin || url.pathname.startsWith("/socket.io/") || url.pathname.startsWith("/api/") || url.pathname.endsWith(".user.js")) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone)).catch(() => undefined);
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match("/index.html")))
  );
});
