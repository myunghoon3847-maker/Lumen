'use strict';

const CACHE_PREFIX = 'lumen-ai-';
const CACHE_NAME = `${CACHE_PREFIX}v165-security1`;
const APP_ROOT = new URL('./', self.registration.scope);
const OFFLINE_PAGE = new URL('./index.html', APP_ROOT).href;
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './favicon.ico',
].map((path) => new URL(path, APP_ROOT).href);
const STATIC_ASSETS = new Set(ASSETS);
const API_PATH = new URL('./api/', APP_ROOT).pathname;
const APP_ENTRY_PATHS = new Set([
  APP_ROOT.pathname,
  new URL(OFFLINE_PAGE).pathname,
]);

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      )),
      self.clients.claim(),
    ]),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith(API_PATH)) return;

  if (request.mode === 'navigate') {
    if (!APP_ENTRY_PATHS.has(url.pathname)) return;
    event.respondWith(
      fetch(request)
        .catch(() => caches.match(request).then((cached) => cached || caches.match(OFFLINE_PAGE))),
    );
    return;
  }

  if (!STATIC_ASSETS.has(url.href)) return;
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)));
        }
        return response;
      });
    }),
  );
});
