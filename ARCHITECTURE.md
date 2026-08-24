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
| **Public web** | `theteknojunkie456.github.io/anime-list` (GitHub Pages) | Personal tracker **+ Friends**, watch-routing (your own services + inline YouTube). No watch parties. |
| **Official app** | TestFlight / native iOS (`ios-broadcast/`) | Everything above **+** watch parties, screen broadcast, "My Services". |

> **Watch-routing moved to both builds.** `routeFree()` used to be gated behind
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
  aniScore,                         // AniList community score 0-100; ranks the picker + "Top rated" sort
  scoreTried,                       // stamped even when a title has no score, so it isn't refetched forever
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

## 6. External data (all keyless)

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

### Chapter data — why it comes through a GitHub Action

AniList's `chapters` field is null for most ongoing manga, so chapter counts and
release dates come from **MangaUpdates**. That API cannot be called from where
you'd expect: it returns **403 to Cloudflare Worker egress and 403 to browsers**
(an `Origin` header alone is enough). A GitHub runner is neither, so
`.github/workflows/chapters.yml` fires `scripts/chapters.mjs` hourly and commits
`data/chapters.json`. The script decides whether to do anything: it works every
hour on the days a tracked series actually releases (and the day after, since the
runner is UTC and a late chapter lands on the next date), and falls back to a
six-hour floor otherwise — polling MangaUpdates and the readers 24 times a day is
rude, rate-limit bait, and pointless for a weekly series. The release days come
from each series' own `weekday`, not from the workflow, so a series that moves to
Sundays is followed without editing anything; Pages serves it, and both the app and the notify
Worker read it from there. Nothing secret is published — only public series data.

Per series the file carries:

| field | what it is |
|---|---|
| `names` | every alias — AniList synonyms, MangaUpdates associated titles, whatever the user typed |
| `chapter` | latest chapter (`latest_chapter`), verified against the readers themselves |
| `releases` | up to 16 real dated releases, `{ch, date}` |
| `cadence` | days per chapter — median of per-pair rates, from the live stream |
| `weekday` | the day it actually posts on (0=Sun), when it keeps one |
| `readSlug` | what each reader calls it, resolved by probing aliases |
| `readChapter` / `readAt` / `readHost` | what the reader itself is serving, and when it last updated |

Two API quirks are load-bearing. `releases/search` **ignores `series_id`** and
lets `orderby` override the query — the only parameter it honours is `search`,
so releases are fetched by name and every row is checked against `names` before
it's kept (fuzzy search alone once matched "Lore Olympus" to "Olimpos"). And
readers like AsuraScans stamp a **rotating site-wide code** onto every series
URL, so the code is scraped each run rather than hardcoded; the constant in
`index.html` is only a fallback.

Cadence is deliberately **not** a median gap between releases. A gap is measured
between the rows the harvest happened to catch, so one miss reads a weekly series
as biweekly — it called The Stellar Swordmaster 14-day while 15 of its 16
releases were on a Wednesday. Rate (chapters per day) is immune to holes, and the
median of per-pair rates ignores the pairs that straddle one.

The other trap is **merged release streams**: two groups translate the same
series under different chapter numbers on different days (The Extra's Academy
Survival Guide has a Monday source near ch 94 and a Thursday source near ch 116,
together reading as a 3-day cadence). Neither is a majority, so "most rows wins"
can't separate them — whichever posted *last* is the stream still running, and
that's the one measured.

**The reader is scraped too, and it is the better anchor.** MangaUpdates'
release feed indexes one scanlation stream and can sit dozens of chapters
behind what is actually published — it had The Stellar Swordmaster at ch 120
while the reader was serving 131 — so a projection anchored on its last row
starts two weeks stale. The reader's chapter list is what the user opens, and
its timestamps are relative (`4 days ago`, `last week`), so only the newest row
is precise; that is exactly the row an anchor needs, and the ±1 day relative
dates carry is absorbed by the weekday snap. Chapter alerts fire on
`max(chapter, readChapter)`: if a chapter is already sitting on the reader,
"it's out" is true whether or not the database agrees yet.

A note on domains: **`asuratoons.com` is no longer Asura** — it redirects to an
ad-campaign tracker (`anast-nch.com/zokvisitor/…`) and must not be read from.
`asuracomic.net` redirects to `asurascans.com`, which is the live site.

`feedRec(a)` is the app's lookup into this file — by AniList id, falling back to
alias matching for items that don't have one yet. `feedSlug()` (deep links) and
`schedReadEntries()` (the calendar) both go through it.

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
- **`LISTS`** (KV) — per-code list backup/sync (`push` / `pull` ops). **Every
  `push` is one KV write, and the free plan allows 1,000 a day** across all
  users — see *The write budget* below before adding anything that pushes.
- **`PARTY`** (Durable Object `PartyRoom`) — one instance per party code; live
  watch party over WebSockets. *(Official app only.)*
- **`CHAN`** (Durable Object `UserChannel`) — one per user friend-code; holds the
  user's open WebSocket so friend requests & recommendations arrive instantly.

> Free-plan Durable Objects require `new_sqlite_classes` in the migration (not
> `new_classes`).

### The write budget

KV bills per write **operation**, not per byte: a 50-byte change and a 2 MB list
both cost exactly one of the 1,000 writes a day. So the only thing that reduces
cost is not writing — payload size is irrelevant to the limit, and "send a
smaller delta" would have bought nothing.

On 2026-08-23 the quota was exhausted before 03:00 UTC and `push` was failing
account-wide with `KV put() limit exceeded for the day`. Because pushes are
fire-and-forget, the app showed no error — it looks exactly like the app losing
your data and asking for the cloud key again.

Three things were spending it:

**Pulls were writing.** `localStorage.setItem` is wrapped to schedule a push on
any change, and `pullRecs()` rewrites `recs_in` / `recs_passed` / `recs_echo` /
`parties_in` on every pull. So each pull spent a write re-saving a list that had
not changed. Those keys are now in `syncSkip()` — nothing is lost, since the pull
that fills them re-fetches them.

**The list was sent twice.** `syncSkip()` covered `LSKEY` but not `LSKEY+'_bak'`,
its byte-identical mirror, so `collectExtra()` swept the whole library into the
settings bundle alongside the copy already in `list`. Now skipped — which, because
`applyExtra()` filters through the same function, also stops a stale `_bak` from
another device being written over yours.

**Identical pushes.** `syncPush()` fingerprints the *plaintext* (list + extra) and
returns early when it matches the last **confirmed** push. Plaintext, not payload:
an encrypted envelope carries a fresh IV each time, so hashing what goes on the
wire would differ on every call and the guard would never fire for exactly the
people relying on it most. A failed push clears the fingerprint, so the failure
mode is an extra write, never a backup that quietly stops.

Timing is a debounce **with a ceiling** (`PUSH_WAIT` 10s, `PUSH_MAX` 45s). The
ceiling is not decoration: a plain debounce is starved by anything that writes
more often than the wait, and this app has a background save that runs about once
a second — which would have starved the old 2.5s wait just as surely. Once a
change has waited `PUSH_MAX`, the next scheduling attempt fires instead of
deferring. `visibilitychange`/`pagehide` flush immediately, so the longer wait
never costs anyone their backup.

Measured in a real browser by counting `op:'push'` requests: ten no-op pulls cost
0 writes, five rapid episode ticks cost 1, re-saving identical content costs 0,
and a dropped connection is retried rather than mistaken for "nothing changed".

**Friends** flow through KV mailboxes (`fr_send`/`fr_accept`/`fr_pull`,
`rec_send`/`rec_pull`) **plus** a live push over `CHAN`. The push **carries the
payload** (`mergeRec` / `mergeFriendMsg`) so delivery doesn't wait on KV
propagation — that's what makes it feel instant. Client side: `connectFriendWS()`
opens the socket; the app also pulls on focus and on network reconnect.

Turning a recommendation down is an answer, so it travels back: `rec_pass` files
a `{from,title,aniId,at}` record under `pass:<sender>`, one per friend per show,
and `rec_pull` returns it alongside `recs`. The sender sees it as a quiet line in
their **You recommended** list — never a push, and the `CHAN` nudge carries only
the title, so nothing on the wire says who turned it down. `dismissRec()` sends
it fire-and-forget: hiding a card is a local act and never waits on the network.

**Finding a party** (`party_tell` / `party_untell`, read back through
`rec_pull`). A party used to be reachable only by sending someone its code out
of band, which meant it only ever happened between people already talking
somewhere else — capable, and invisible. Now the host announces it and every
friend sees a live row above everything on home.

The shape is *one write, many reads*. The obvious build — drop a row in each
friend's mailbox — costs one KV write **per friend per party**, and writes are
the scarce resource (1,000/day on the free plan, shared with every list sync).
Instead the host writes a single key, `pinv:<hostCode>`, and `rec_pull` takes a
`friends` array and reads those keys. A party costs exactly one write whether
you have two friends or fifty, and the trust model comes for free: `pinv:<host>`
is only findable by someone who already holds that host's friend code.

Three rules the rows follow:
- **No push.** A recommendation keeps; a party is happening now. Interrupting
  everyone each time somebody presses start is how an app teaches people to turn
  notifications off, so the row is passive — it is there when you open the app.
- **Three hours and it's gone**, checked on read and again on the client, with a
  six-hour KV TTL underneath. A Join button leading to a dead room is worse than
  no button, and a host who closed the tab never cleared theirs.
- **One row per host**, because the key *is* their code. Starting again or
  switching show overwrites; it never stacks into a log of attempts.

The rail is deliberately **not** one of the re-orderable home sections, and it
renders above the empty-state box too — someone with nothing in their list has
no shelves for it to sit above, and a friend already watching something is a
better reason to stay than a box telling them to import.

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

- **No custom source (either build):** `routeFree(a)` lists where the title
  actually is — the user's own services first, then AniList's official
  `externalLinks`, then free searches — and remembers the pick.
- **A source the user chose** → inline player, always. `_own` is true when
  `a.srcUrl` is set (a per-title pick or a pinned link) or a global custom source
  exists. The player's iframe is sandboxed **without** `allow-popups` or
  `allow-top-navigation`, so a framed site cannot spawn tabs or navigate the app
  away — that sandbox is the reason to prefer the player at all. The overlay
  frame in `openYT()` carries the same sandbox.
- **`embedTarget()`** is a separate allowlist used for *auto-embedding* things
  nobody configured: YouTube, archive.org, and a **private/LAN address** (your
  own Jellyfin/Plex/Emby). Absence of a blocking header is not permission, so the
  list is explicit.
- **Anything else** → `openExternal`, with `armExternalWatch()` starting the
  time-away clock so progress is still tracked on return.

**Which hosts actually frame (`frame_ok`).** A site refusing to be framed looks
identical to one still loading, and cross-origin rules mean the app can't ask —
so it remembers instead of re-testing. Two behavioural signals, not a timer:
tapping *Open in browser* while the blank panel is up records a failure, and a
session past 20s that never needed the escape hatch records a success. Two
failures with no successes and that host skips the player entirely rather than
showing a blank rectangle for eight seconds; one good session clears the record.
Counts only, per hostname — nothing about what was watched.

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

### Progress marking — what the app is allowed to know

The frame is cross-origin. `iframe.contentWindow.location` is unreadable and
always will be; this is the same rule that stops the app telling a blocked frame
from a loading one. Two signals are readable and everything below is built on
them: **that the frame navigated** (the `load` event fires on the element for
every completed navigation, whatever the origin) and **how long the current
episode had been open** when it did.

`pvFrameNavigated()` is wired to that `load` event. Navigations the app caused
are excluded by intercepting `src` on the element itself with
`Object.defineProperty` — one interception covers all eleven assignment sites,
including the retry, the in-frame search and the `about:blank` on close, and
`_pvOwnNav` is consumed by the next load.

| | gate | on close |
|---|---|---|
| Watching | `pvMovedOnMs(a)` — 60% of `a.dur`, floor 5 min (14.4 min for a 24-min episode) | `pvReached()` — one episode per `pvEpLenMs` elapsed, capped at `PV_TIME_MAX` (3) |
| Reading | `PV_READ_MS` — flat 90s | current chapter only; 90s banks, `PV_READ_PEEK_MS` (45s) asks |

Reading gets **no** time-based multi-chapter settle. A chapter has no duration,
so minutes in the reader carry no information about how many were read — and
page-by-page readers navigate constantly, which is what the 90s gate is for.

Watching banks on close; reading banks **as it happens**, because an iOS purge
mid-read would otherwise lose the whole sitting. `_pvReadFrom` records where the
sitting started so one Undo still covers all of it.

The time-based path is capped because it cannot distinguish a binge from a phone
in a pocket. Following along has no such problem — it requires a real navigation
— so it is uncapped. Everything auto-applied surfaces an Undo.

`settleExternalWatch()` runs the same `pvReached()` maths on time *away* for
sources that opened in the browser.

### AI providers

Key prefix picks the provider: `AIza` Google AI Studio, `gsk_` Groq, `sk-or-`
OpenRouter, `sk-ant-` Claude. An unrecognised key is rejected by name rather
than posted at Anthropic.

**Google AI Studio is what the walkthrough recommends.** `chatContext()` sends
the whole list every message — ~3,200 tokens on a 108-title list — and Groq's
free tier meters tokens per minute (6K–12K), so a long conversation 429s. Google
meters requests. Groq is still offered, faster, with the trade stated.

`modelChain(prov)` = the model picked in Settings, then `AI_MODELS[prov]`, then
`AI_EXTRA[prov]`. **Every** provider has a chain — a hardcoded model name is a
dead app the day it is retired. Both `callAI()` (recommend, rank, Insight,
autofill) and `callAIChatStream()` walk it, and a model is only ever swapped
before a token has been emitted. `modelRejected()` distinguishes "this model is
gone" from a real failure so one bad key doesn't burn the whole chain.

Every failure goes through `aiFail()`, which keeps the response **body** —
`aiReason()` needs it to tell a retired model from a rate limit from a bad key.
Raising a bare `new Error('API ' + status)` carries no `.status` and degrades to
"check your connection", which is what the chat used to do.

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
1. **Never host video.** Never embed a service's stream, never handle streaming
   credentials, never build a scraper or auto-resolver that goes looking for one.
   The two moves available are opening the user's *own* service (official app)
   and the neutral user-configured custom-source field. See §10.
2. **No adult content.** Enforced by the gate in §7 — don't weaken it.

## Your own AI endpoint

The four built-in providers are recognised by the **shape of the key** — `gsk_`
Groq, `sk-or-` OpenRouter, `AIza` Google, `sk-ant-` Claude. That works right up
until you put a router in front of them: a Manifest / LiteLLM / self-hosted proxy
key starts with none of those prefixes and was rejected as "not a key".

Setting a base URL (AI Key sheet → *Use your own endpoint*) switches the app to
`custom`, and it is checked **before** the prefixes — the whole point is that the
key's shape no longer tells you where the request goes. From then on:

- the key can be any shape, because the endpoint decides what it means;
- the address is normalised, so the root, `/v1`, or the full
  `/v1/chat/completions` all work;
- the **model name is yours to give** — a router routes on it, and guessing one
  would send every request to something that isn't there. There are no fallbacks
  for a custom endpoint, so an unset model is an explicit error rather than an
  empty chain that throws `null`;
- the model dropdown hides, because the name you typed *is* the choice;
- both paths speak the same protocol: one-shot calls and the streaming chat.

The base URL and key are localStorage-only and are **never synced**, for the same
reason the provider keys aren't: a credential in cloud storage is a credential
given away.
