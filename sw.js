const CACHE = 'animelist-v4';
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

// ── Web Push: show a notification when the notify-worker pushes an aired episode ──
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; }
  catch { data = { title: 'WatchList', body: e.data ? e.data.text() : '' }; }
  const title = data.title || 'WatchList';
  const options = {
    body: data.body || '',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    tag: data.tag,               // collapses duplicate pushes for the same episode
    renotify: true,
    data: { url: data.url || './' },
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

// Focus an existing tab (or open one) when a notification is tapped
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
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
