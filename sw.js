// Bumped v9 -> v10: notificationclick now rebases onto the app's own scope.
// Bumped v8 -> v9 to drop the caches the old fetch handler had grown (see below).
// Bumped v7 -> v8 deliberately. The activate handler deletes every cache whose
// name isn't the current one, so changing this name forces every installed app
// to drop what it stored and refetch. Network-first should already keep things
// current, but an installed iOS app that has been offline or backgrounded can
// hold an old bundle for a long time — and "the fix didn't work" has looked
// exactly like that more than once.
const CACHE = 'animelist-v51';
// The typeface lives on a THIRD-PARTY origin, and the fetch handler below only
// ever touched same-origin requests — so it was never stored. Two consequences,
// both real: an installed app that goes offline renders in system fonts, losing
// the brand entirely, and every cold start pays a DNS + TLS round trip to
// fonts.gstatic.com before text can paint in the right face. Google's font URLs
// are versioned and immutable, which makes cache-first exactly right for them.
//
// Kept in its OWN cache, deliberately: the app cache is wiped on every version
// bump to force a fresh bundle, and wiping the fonts with it would re-download
// them on every release for no reason.
const FONT_CACHE = 'animelist-fonts-v1';
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
const ASSETS = ['./index.html', './friends.html', './manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE && k !== FONT_CACHE).map(k => caches.delete(k)))
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

// The notify worker sends ROOT-relative paths ("/", "/?show=123"). This app is
// served from a subpath — /anime-list/ — so "/" resolves to the domain root,
// which is not WatchList. Tapping a notification landed on the wrong page
// entirely. Rebase whatever arrives onto this worker's own scope, which IS the
// app, so a tap always opens WatchList however the payload is written.
function appURL(raw) {
  try { return new URL(String(raw || './').replace(/^\/+/, ''), self.registration.scope).href; }
  catch (e) { return self.registration.scope; }
}
// Focus an existing tab (or open one) when a notification is tapped
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = appURL(e.notification.data && e.notification.data.url);
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        // Only ours: matchAll can hand back windows for other pages on this
        // origin, and focusing one of those is how a tap ends up somewhere else.
        if (!c.url || c.url.indexOf(self.registration.scope) !== 0) continue;
        if (!('focus' in c)) continue;
        // Focusing alone left them on whatever screen they were already on, so the
        // notification's deep link did nothing. Tell the page where to go — and
        // navigate as a fallback for clients that ignore the message.
        try { c.postMessage({ type: 'wl-open', url: target }); } catch (e) {}
        if (c.navigate && c.url !== target) { try { c.navigate(target); } catch (e) {} }
        return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});

// Cache entries are keyed by PATH, with the query string dropped. Two reasons,
// both of which the old full-URL keying got wrong:
//
//  1. Unbounded growth. The version check requests `./?_ck=<Date.now()>` — a URL
//     that is unique every single time. It uses HEAD (not cacheable) on GitHub
//     Pages, but falls back to a plain GET whenever a proxy strips the ETag, and
//     the bundle is ~880KB. Under full-URL keying each of those was kept
//     forever. The chapter feed's hourly `?cb=` bucket added 24 more a day. On
//     iOS, an origin over its quota is evicted whole — and the list goes with it.
//
//  2. Offline misses. Nothing ever requests `data/chapters.json` without a
//     `?cb=`, so a cache keyed on the full URL never matched offline and fell
//     through to the index.html fallback — handing HTML to something that was
//     about to call .json() on it.
//
// A query string on a same-origin URL here is always a cache-buster or a deep
// link into the same document (?admin=1, ?join=CODE), never a different
// resource, so one entry per path is both correct and enough.
function cacheKey(request) {
  const u = new URL(request.url);
  return u.origin + u.pathname;
}
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  // Only handle same-origin requests; API calls (Jikan, TVMaze, Anthropic…) go straight to the network
  if (u.origin !== self.location.origin) {
    // …except the fonts, which ARE the app's appearance. Cache-first: immutable
    // URLs, so a hit is always correct, and it makes the second launch and every
    // offline launch look right instantly.
    if (e.request.method === 'GET' && FONT_HOSTS.indexOf(u.hostname) >= 0) {
      e.respondWith(
        caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
          // Font files are served cross-origin without CORS unless asked, so the
          // response can be opaque. An opaque response still renders and still
          // caches; it just can't be inspected. Store it either way.
          if (res && (res.ok || res.type === 'opaque')) {
            const copy = res.clone();
            caches.open(FONT_CACHE).then(c => c.put(e.request, copy)).catch(() => {});
          }
          return res;
        }).catch(() => caches.match(e.request)))
      );
    }
    return;
  }
  // Network-first so updates show up without clearing Safari data; cache is the offline fallback
  e.respondWith(
    fetch(e.request).then(res => {
      // Only GET, OK responses are cacheable (HEAD version-checks would throw).
      if (e.request.method === 'GET' && res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(cacheKey(e.request), copy)).catch(() => {});
      }
      return res;
    }).catch(() =>
      caches.match(cacheKey(e.request)).then(r => r || caches.match('./index.html'))
    )
  );
});
