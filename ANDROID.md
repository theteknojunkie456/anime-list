# WatchList on Android

Android already runs WatchList better than iOS does: Chrome supports a real
install *and* Web Push, so new-episode alerts actually arrive. The iOS app is a
WKWebView, and WebViews never receive web push — which is why alerts can't reach
it. Nothing here needs the Play Store.

Two ways in, both pointed at from **[android.html](android.html)**:

1. **Install from Chrome** (recommended) — Chrome offers *Install app*, or
   ⋮ → *Add to Home screen*. Own icon, full screen, offline, and it updates
   itself on every deploy. Nothing to build or host.
2. **An APK** — the same site wrapped in a Trusted Web Activity, for sideloading
   or handing to someone directly.

## Building the APK

The PWA already satisfies everything a wrapper needs (valid manifest, 192/512
icons, service worker, HTTPS), so the APK is a shell — the same arrangement as
the iOS app.

**PWABuilder + sign it yourself.** [pwabuilder.com](https://www.pwabuilder.com/)
→ enter `https://theteknojunkie456.github.io/anime-list/` → package for Android.
Note that it produces an **unsigned** APK — it no longer generates signing keys
at all, on either the Google Play or Other Android tab. An unsigned APK cannot be
installed, so it has to be signed here:

```sh
export PATH="/opt/homebrew/opt/openjdk/bin:$PATH"
java -jar uber-apk-signer.jar --apks WatchList-unsigned.apk \
  --ks ~/Projects/ForShow/anime-list-signing/watchlist.keystore \
  --ksAlias watchlist --ksPass '<see KEY-INFO.txt>' --ksKeyPass '<same>'
```

`uber-apk-signer` handles zipalign plus v1/v2/v3 signatures; Android 11+ rejects
v1-only, which is what `jarsigner` alone produces. The keystore and its password
live in `~/Projects/ForShow/anime-list-signing/` — **back that folder up off this
machine.** Losing it means never being able to update the app.

**Bubblewrap (local builds).** `npx @bubblewrap/cli init --manifest
https://theteknojunkie456.github.io/anime-list/manifest.json`. Same output, but
it pulls a JDK and the Android SDK — roughly 4–6 GB. Only worth it for
repeatable local builds.

Suggested package name: `io.github.theteknojunkie456.animelist`.

## Where assetlinks.json actually has to live

**The domain root, not this project path.** Android reads Digital Asset Links
per *origin*, so it fetches
`https://theteknojunkie456.github.io/.well-known/assetlinks.json` and never looks
at `/anime-list/.well-known/`. A project Pages site can't serve its own root, so
the file lives in the separate **`theteknojunkie456.github.io`** repo. Publishing
it under `/anime-list/` returns 200 and verifies nothing — check with Google's
verifier rather than a curl to the path you published:

```sh
curl -s "https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://theteknojunkie456.github.io&relation=delegate_permission/common.handle_all_urls"
```

## After the APK is signed — the one step that matters

Without this, the app runs with Chrome's URL bar pinned across the top. It
works, but it reads as a browser rather than an app. The fix is proving that
this site and that APK have the same owner:

```sh
node scripts/set-assetlinks.mjs <SHA256_FINGERPRINT>   # from PWABuilder, or keytool -list -v
git add .well-known/assetlinks.json && git commit -m "Android: verify the app against the site" && git push
```

Then confirm it's actually being served — GitHub Pages only publishes dotfolders
because this repo has a `.nojekyll` file, so it's worth checking rather than
assuming:

```sh
curl -s https://theteknojunkie456.github.io/anime-list/.well-known/assetlinks.json
```

Reinstall the APK afterwards; Android caches the verification result.

## Publishing the APK

Attach `watchlist.apk` to a GitHub Release — `android.html` already links to
`/releases/latest`, so the download page starts working the moment a release
exists. No store, no review, no fee.

Play Store is optional and separate: it needs a Google Play developer account
and a one-time $25 fee, and it wants the **AAB**, not the APK.

## What does NOT need rebuilding

The APK loads the live site, so every change deployed to Pages reaches installed
Android apps immediately — exactly like the iOS app. You only rebuild the APK to
change the icon, name, or package identity.
