const CACHE = 'animelist-v2';
const ASSETS = ['./index.html', './friends.html', './manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Only handle same-origin requests; API calls (Jikan, TVMaze, Anthropic…) go straight to the network
  if (new URL(e.request.url).origin !== self.location.origin) return;
  // Network-first so updates show up without clearing Safari data; cache is the offline fallback
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() =>
      caches.match(e.request).then(r => r || caches.match('./index.html'))
    )
  );
});
