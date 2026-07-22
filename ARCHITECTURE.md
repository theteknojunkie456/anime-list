# WatchList — Architecture

Onboarding doc for anyone (human or otherwise) working on WatchList. Read this
before touching the code. It covers what the app is, how the files fit together,
the data model, the render/update flows, and the conventions and hard rules you
must follow.

---

## 1. What WatchList is

A personal **anime & manga tracker**, built as a **single-file vanilla-JS PWA**.
No framework, no build step — the HTML file *is* the app. It ships two products
from one codebase, split at runtime by the `IS_NATIVE` flag:

| Build | Where | What it has |
|---|---|---|
| **Public web** | `theteknojunkie456.github.io/anime-list` (GitHub Pages) | Personal tracker **+ Friends**, legal watch-routing (your own services + inline YouTube). No watch parties. |
| **Official app** | TestFlight / native iOS (`ios-broadcast/`) | Everything above **+** watch parties, screen broadcast, "My Services". |

> **Watch-routing moved to both builds.** `routeLegal()` used to be gated behind
> `IS_NATIVE`; web fell back to one hardcoded free-search default, so web users
> could never reach their own regional services. It now runs on both — nothing in
> that path is native-only (official AniList links, user-added services, and a
> licensed YouTube embed).

```js
const IS_NATIVE = /WatchListNative/i.test(navigator.userAgent); // native WKWebView tags the UA
```

Everything native-only is gated behind `IS_NATIVE` (and CSS classes like
`body.no-party`). The web build hides parties entirely.

---

## 2. Files

```
index.html            The entire app: HTML + <style> + <script>, ~6,000 lines.
friends.html          A generated TWIN of index.html (see §3). Do not hand-edit.
sw.js                 Service worker: network-first cache + web-push + auto-reload.
manifest.json         PWA manifest (installable, icons, theme).
cloud/
  sync-worker.js      Cloudflare Worker: list sync + real-time friends/parties.
  sync-wrangler.toml  Worker config (KV + Durable Object bindings + migrations).
ios-broadcast/        Native iOS shell (Swift/SwiftUI) — see §8.
ARCHITECTURE.md       This file.
```

`index.html` has three inline sections, in order: the **markup**, one big
**`<style>`** block (all CSS), and one big **`<script>`** block (all logic).
There is no bundler — what you write is what ships.

---

## 3. The two builds & `friends.html`

`friends.html` is **not** hand-maintained. It's a byte-for-byte copy of
`index.html` with a single substitution — the localStorage key — so a second
identity can run on the same origin for testing Friends end-to-end:

```bash
sed "s/const LSKEY='animelist_v4'/const LSKEY='animelist_friends_v4'/" index.html > friends.html
```

**Rule: after every change to `index.html`, regenerate `friends.html` with that
command.** Never edit `friends.html` directly — your change will be overwritten.

---

## 4. Data model

The list is an array of plain objects on the global `anime`. Reading vs. watching
is a per-item `kind`, not a separate list.

```js
let anime = [];   // the whole library
// an item, roughly:
{
  id, title, kind:'watch'|'read', status:'watching'|'plan'|'finished'|'dropped',
  ep, epTotal, eps,                 // progress + episode/chapter counts
  rating, fav, genre, notes, order, // user metadata
  img, banner, aniColor,            // artwork/theming (from AniList)
  aniId, malId,                     // external ids (dedup + metadata refresh)
  airAt, airEp, airChk,             // next-episode airing (watch only)
  dur,                              // per-episode minutes → total watch-time
  adultChk,                         // stamped once verified non-adult (§7)
  upd                               // last-updated timestamp (sort + sync)
}
```

Helpers you'll use constantly:
- `kindOf(a)` — `'watch'` or `'read'`.
- `normTitle(t)` — lowercased, alphanumeric-only; the basis for dedup.
- `dupeKeys(a)` / `dedupeList(list)` / `dedupeAnime()` — dedup by `aniId` / `malId`
  / normalized title, keeping the richest copy. **No duplicates, ever** — call
  dedup after any path that adds items.

### Storage & sync
- `writeLocal()` persists `anime` to `localStorage` under `LSKEY`.
- `save()` = `writeLocal()` + `schedulePush()` (debounced cloud push) +
  `scheduleNotifyUpdate()`.
- The stored blob can be **end-to-end encrypted** behind a password + recovery
  key; `appLocked` gates the UI until unlocked (Face ID on native).

---

## 5. Render pipeline

Rendering is plain string-building into `innerHTML` — no virtual DOM. The entry
point is `render()`, which runs a few chunked steps:

```
render()
  ├─ renderKindSeg()   Watch-list / Reading-list segmented control
  ├─ renderFiltRow()   the 3 filter chips (All / Watching / Plan) + counts
  ├─ renderSortRow()   the pinned Sort dropdown (+ Finished/Dropped in the menu)
  └─ renderHome()      the actual home screen
```

`renderHome()` (when no search/filter is active) builds, top to bottom:
1. a top banner (backup nudge, or "you're behind" nudge),
2. the **spotlight billboard** (`billboardHTML`, up to 5 hero items),
3. the **Continue Watching** rail (`resumeItems` → `resumeRailHTML`) — the single
   "watching" surface on home,
4. the friends-recommend row (web build),
5. per-status rows (Plan / Finished / Dropped), Favorites, and genre collections.

**Invariant: a show appears at most once on the home screen.** The billboard is
computed first (`spotSet`), the rail excludes `spotSet`, and the rows exclude
both. Preserve this when editing home — overlapping sets were a real bug.

Other key render functions: `renderDetail()` (the per-title sheet),
`posterCard()` (grid/row card), `collapseSeries()` (folds multi-season series
into one card).

---

## 6. External data (all keyless, all legal)

- **AniList GraphQL** (`https://graphql.anilist.co`) — primary. CORS-enabled, no
  key. Metadata, covers, banners, dominant color, episode counts, per-episode
  duration, `nextAiringEpisode`, the `isAdult` flag, and official streaming
  `externalLinks`.
- **Jikan / MyAnimeList**, **TVMaze**, **OpenLibrary** — secondary lookups &
  account imports.

`fetchCovers()` is the **universal enrichment loop**: it walks `coverNeedy()`
items in visible-first order, batches ~25 per AniList query, and fills in
art/metadata/airing. It's also the enforcement point for the adult gate (§7).
Entry points that add items — `submitForm()` (typed add), `doImport()` (paste),
`aniListEntries()`/`malEntries()` (account import) — all funnel through it.

---

## 7. Content safety — the adult gate (do not weaken)

WatchList does not allow adult/hentai content. It's enforced in layers:

1. **Autofill** excludes adult (`isAdult:false` + `isAdultMedia` filter), so adult
   titles never appear as suggestions.
2. **Typed add** — `submitForm()` calls `isAdultTitle()` **before inserting** and
   refuses if it matches. The title never enters the list.
3. **Universal sweep** — `fetchCovers()` requests AniList's `isAdult` flag and
   **deletes** any item where `isAdultMedia(m)` is true (isAdult flag OR "Hentai"
   genre), catching anything that arrived via import.
4. **One-time re-scan** — `coverNeedy()` returns any item without `adultChk`, so
   every existing title is verified once and adult ones swept, even if imported
   before the gate existed.
5. **Load-time backstop** — `purgeAdult()` removes stored titles whose genre
   string contains "hentai".

`isAdultMedia(m)` is the single detector; route new checks through it.

---

## 8. Real-time & sync (Cloudflare Worker)

`cloud/sync-worker.js` is a **Cloudflare Worker** (JavaScript on the edge
runtime — not Node). Deploy:

```bash
cd cloud && npx wrangler deploy -c sync-wrangler.toml
```

Bindings (`sync-wrangler.toml`):
- **`LISTS`** (KV) — per-code list backup/sync (`push` / `pull` ops).
- **`PARTY`** (Durable Object `PartyRoom`) — one instance per party code; live
  watch party over WebSockets. *(Official app only.)*
- **`CHAN`** (Durable Object `UserChannel`) — one per user friend-code; holds the
  user's open WebSocket so friend requests & recommendations arrive instantly.

> Free-plan Durable Objects require `new_sqlite_classes` in the migration (not
> `new_classes`).

**Friends** flow through KV mailboxes (`fr_send`/`fr_accept`/`fr_pull`,
`rec_send`/`rec_pull`) **plus** a live push over `CHAN`. The push **carries the
payload** (`mergeRec` / `mergeFriendMsg`) so delivery doesn't wait on KV
propagation — that's what makes it feel instant. Client side: `connectFriendWS()`
opens the socket; the app also pulls on focus and on network reconnect.

The client never uploads the plaintext list to the friends mailboxes — only
metadata + per-show notes.

---

## 9. Auto-update (seamless)

The app updates itself from GitHub Pages without the user quitting:

- `sw.js` is **network-first**, so web changes reach existing users (and the
  native shell) on next open — **no re-archive needed for web-only changes.**
- `checkUpdate()` polls the deployed file's ETag (`_liveVer()`) every minute, on
  refocus, and on network reconnect. On a new version it calls `_applyUpdate()`.
- **Seamless restore:** before reloading, `_snapUpd()` snapshots your tab, filter,
  sort, and scroll position; after reload `_restoreUpd()` puts you back exactly
  where you were. It never interrupts a video or mid-typing (`_updBusy()`).

Only **Swift** changes require an Xcode rebuild; web changes propagate on their
own.

---

## 10. Watching / playback

`watchAnime(id)` decides how to play. **One rule on both builds:** if the source
is embeddable it plays inline, otherwise it opens in the browser.

- **No custom source (either build):** `routeLegal(a)` lists where the title
  actually is — the user's own services first, then AniList's official
  `externalLinks`, then free searches — and remembers the pick.
- **Embeddable source** → inline player. `embedTarget()` is an allowlist:
  YouTube, archive.org, and a **private/LAN address** (your own Jellyfin/Plex/
  Emby). Absence of a blocking header is not permission, so the list is explicit.
- **Anything else** → `openExternal`, with `armExternalWatch()` starting the
  time-away clock so progress is still tracked on return.

Previously a custom source always framed and a preset always opened, so the same
"watch" behaved differently depending on which settings field had been filled —
and a custom source that blocks framing (TVING, Prime, Crunchyroll…) rendered a
black rectangle.

**Admin-recommended sources.** Built-in services are hidden by default (clean
Watch sheet). An admin curates a network-wide set from the admin panel, pushed
to the notify worker (`POST /sources-set`, admin-token-gated; stored at
`cfg:sources`). Clients pull it (`POST /sources`) on boot and focus, cache it in
`localStorage` (`admin_sources`), and surface it as a **Recommended** group in
the Watch sheet. Each push carries an `id`; a new id unhides exactly the
recommended names once (`admin_sources_seen`), so a member's later manual hide
sticks until the admin pushes a fresh set. Templatized like custom sources via
`customServiceURL()`.

### What's new (§9 companion)
Updates apply silently, so `RELEASE` in `index.html` carries a date-stamped,
plain-language changelog and `maybeShowWhatsNew()` shows it once per version to
**returning** users (new installs get the tutorial instead). **Bump `RELEASE.v`
and write `notes` on every user-visible change** — plain sentences, no jargon.

---

## 11. Native iOS shell (`ios-broadcast/`)

A thin **Swift / SwiftUI** wrapper that loads the same web app in a `WKWebView`
(tagging the UA `WatchListNative`) and adds the native-only features:

- `ContentView.swift` — the WebView host + native bridge.
- `PartySignaling.swift` — watch-party signaling.
- `SampleHandler.swift` — ReplayKit screen broadcast extension.
- `AppGroup.swift` — shared storage between app & broadcast extension.
- `project.yml` — XcodeGen project definition.

The web app is the source of truth; the shell just adds capabilities the browser
can't.

---

## 12. Conventions & hard rules

**Style**
- **Feather icons and brand fonts only.** Custom controls, not platform defaults.
- **No emoji in the UI** — clean typography / Feather icons on brand colors.
- **Surgical edits, not rewrites.** One action per job; no duplicate paths.
- Match the surrounding code's density and idiom; comments explain *why*.

**Workflow**
- After editing `index.html`, **regenerate `friends.html`** (§3).
- Syntax-check the inline JS before shipping.
- Web changes go live via GitHub Pages; the app auto-updates (§9).

**Hard rules (non-negotiable, both builds)**
1. **No piracy.** Never embed/host a service's video, never handle streaming
   credentials, never build a scraper/auto-resolver that locates unlicensed
   streams. The only legal moves are opening the user's *own* service (official
   app) or the neutral user-configured custom-source field. See §10.
2. **No adult content.** Enforced by the gate in §7 — don't weaken it.
