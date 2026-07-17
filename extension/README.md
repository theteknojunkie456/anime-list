# WatchList Party (desktop extension)

Watch anime in **perfect sync** with friends on AniNeko — everyone's play, pause
and seek stay together. This is our own Teleparty: it works by running a small
script *inside* AniNeko's page so it can control the real video (a normal website
can't reach into an embedded player — this can, because it *is* in the page).

Free, no video streamed between people (each person streams their own copy — only
the controls sync), so there's no bandwidth cost and no group-size limit.

## Install (Chrome / Edge / Brave)
1. Download the extension (the **Get the extension** button in WatchList) and unzip it.
2. Go to `chrome://extensions`.
3. Turn on **Developer mode** (top-right).
4. Click **Load unpacked** and pick the unzipped `watchlist-party` folder.
5. Pin the 🎉 icon so it's easy to find.

## Install (Android — Kiwi Browser, easiest)
Kiwi Browser is a Chromium browser for Android that runs Chrome extensions, so the
same zip works with no signing.
1. Install **Kiwi Browser** from the Play Store.
2. Kiwi menu (⋮) → **Extensions** → turn on **Developer mode** (top-right).
3. Tap **+ (from .zip/.crx)** → pick the downloaded `watchlist-party.zip`.
4. Open `anineko.to` **in Kiwi** and tap the 🎉 icon.

## Install (Firefox desktop)
1. Download + unzip.
2. `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → pick `manifest.json`.
   (Firefox for **stable Android** needs the add-on signed on addons.mozilla.org; Kiwi above is simpler.)

## Use
1. Everyone opens the **same anime episode** on `anineko.to`.
2. One person clicks the 🎉 icon → **Start a party** → shares the code.
3. Everyone else clicks the icon → enters the code → **Join**.
4. The **host** (whoever started it) drives — their play / pause / seek controls
   the whole party. A little "WatchList Party" pill shows your status.

## Notes
- Desktop browsers + Firefox for Android. **iPhone can't** run it (iOS extension
  limits) — on iPhone use WatchList's screen-share or 3·2·1 modes instead.
- It only activates on `anineko.to` (and its player frame). It does nothing on any
  other site.
- Sync uses your WatchList party worker (WebSocket) — the same free backend.
