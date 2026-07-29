# WatchList Party Sync — the extension, on iPhone

Generated from `../extension` with `safari-web-extension-converter`. It is the same
content script, wrapped so Safari on iOS and macOS can run it.

## Why this exists

Screen sharing from an iPhone web app is impossible — WebKit has no
`getDisplayMedia`, and no embed can add one. But screen sharing was never the goal;
**watching in sync** was. This achieves that without moving a single pixel.

The content script runs *inside* the streaming site, where it is same-origin with
the `<video>` and can read and drive it. The host's play, pause and seek go through
the WatchList party WebSocket, and everyone else's copy follows. Same trick
Teleparty uses, and the only one that works on a phone.

## What it does NOT do

It runs in **Safari**, not inside the WatchList home-screen app — iOS runs
extensions in the browser only. So a synced session on a phone means watching on
the site in Safari with the party in another tab, rather than inside WatchList's
own frame. That is the cost of the capability existing at all on iOS.

Chrome on iOS cannot use it (no extension support). On Android, Chrome has no
extensions either; Firefox and Kiwi do, and can load `../extension` directly.

## Build and install

1. `open "ios-safari-ext/WatchList Party Sync.xcodeproj"`
2. Select the **iOS (App)** scheme, set **Team** to your Apple ID team on both the
   app and extension targets.
3. Run it on the phone once — installing the app is what registers the extension.
4. On the phone: **Settings → Apps → Safari → Extensions → WatchList Party Sync**,
   switch it on, and set the streaming site to **Allow**.

To share it, archive and upload alongside the main app; a Safari extension is
distributed as an ordinary app.

## Keeping it in step with the source

`../extension` stays the single source of truth. After changing it:

```sh
rm -rf ios-safari-ext
xcrun safari-web-extension-converter extension \
  --project-location ios-safari-ext \
  --app-name "WatchList Party Sync" \
  --bundle-identifier com.humblezone.watchlist.sync \
  --swift --no-open --no-prompt --force
```
