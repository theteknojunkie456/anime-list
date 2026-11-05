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
some readers stamp a **rotating site-wide code** onto every series URL, so the
code is scraped each run rather than hardcoded — there is no constant in
`index.html` to go stale, because there is no built-in reader to hold one.

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

### Which device is right

Devices normally **merge**: union by id, newest `upd` per item wins. That is the
right default and the wrong one for a device that has drifted, so there is a way
to say "this one is correct, everywhere".

It used to be a flag written *inside* the synced blob — and the blob is what the
next `push` from anybody replaces, so the first device to publish before it had
caught up erased the decision, its stale titles merged back into everyone, and
the device that had been declared right quietly reverted.

The marker lives on the **record**, beside the blob, and only moves forward:

| field | meaning |
|---|---|
| `adopt` | the decision's timestamp. Monotonic; a later one supersedes an earlier one. |
| `adoptBy` | the device that made it. |
| `devs{}` | the last blob each device published, five most recent, never evicting the device currently writing. |

Every `push` carries `adoptSeen` — the last decision that device honoured. A
device behind the current decision is refused with **409 `stale-adopt`**; the
client answers by pulling, adopting, and pushing again, and does not count it as
a backup failure. The pull side evaluates `adopt` even when this device already
holds the newest write, because that device is precisely the one that overruled
everyone and so the one that most needs to hear it.

`devs{}` is what makes the choice answerable from a device that is *not* the one
being chosen: the phone reads the Mac's copy (`op:'pull_dev'`) rather than
needing the Mac in hand. Snapshots are dropped before the record is ever allowed
to exceed the size cap — a backup that fails is worse than a picker that has
forgotten a device — and `op:'pull'` strips them, so an ordinary open does not
download five copies of the list.

Ops: `pull` · `push` · `devices` · `pull_dev`. Covered by
`cloud/adopt-sync.test.mjs` and `scripts/device-dominance-test.mjs`.

### Erasing a backup

`syncOff()` only ever dropped the key from the device. The blob stayed in KV —
list, settings, friends — under a key nothing in the world could still reach, so
"off" meant *"I can no longer see it"*, which is the wrong meaning for that
word. Every device that mints its own key and is later pointed at another one
leaves one of these behind too.

`op:'forget'` deletes `list:<code>`. Holding the code is the authority, and that
grants nothing new — a holder can already `pull` the whole blob and `push` an
empty list over the top. What it adds is honesty: the record is **gone** rather
than blanked, because a blank record still says somebody was here. It reports
`existed` so the client can tell an erase from a no-op and not claim a
destruction that did not happen.

Client side, `syncForget()` has two orderings that are the whole correctness of
it:

1. **Erase before clearing the key locally** — the key is the only thing that
   can reach the copy, so dropping it first strands the blob permanently.
2. **Cancel the scheduled push before erasing** — otherwise the debounce fires a
   moment later and writes the entire list straight back under the key just
   deleted, which looks exactly like the erase silently not working.

A failed call keeps the key, so the copy stays reachable rather than being
orphaned by a network blip. Afterwards `BACKUP_OFF` is set, or `ensureBackup()`
mints a fresh key on the next save and the erase undoes itself.

Covered by `cloud/forget.test.mjs` (8) and `scripts/forget-backup-test.mjs` (18).

### Pairing — how a second device joins the first one's key

`mergeFromCode()` (below) folds another key's list into this one but leaves the
two devices on separate keys, which is the right behaviour for a rescue and the
wrong one for "these are both mine". **Pairing** is the door that actually puts
them on one key, and it is now the primary one.

The old route was "read the 20-character key off the laptop and type it into the
phone", and the button that accepted it **replaced** the list. Nobody walks
through a door that asks them to gamble their library on typing twenty
characters correctly, so in practice both devices kept the key each had minted
for itself. A door nobody uses is not a door.

A pairing code is a **short-lived bearer of the real key**, not the key:

| | |
|---|---|
| length | 8 characters, from the 32-letter alphabet with the look-alikes removed |
| life | 10 minutes (`expirationTtl`, plus an explicit clock check for the gap before eviction) |
| uses | one device — re-claimable by *that* device, refused to everyone else |

Eight characters is ~1.1e12 codes. Six was the first instinct and is a thousand
times weaker for one character less to type.

Ops: `pair_new` (needs the real key, and refuses a key with no backup behind it —
otherwise the join hands the other device an empty list and calls it a merge) ·
`pair_claim` · `pair_cancel` (only the device that offered it may withdraw it,
or cancelling becomes sabotage-by-guessing).

**The join merges.** `pairJoin()` claims the code, pulls the target key, folds
this device's list into it with `dedupeList(anime.concat(migrate(inner)))` —
local first, so the surviving copy is this device's — writes a restore point to
`wl_prepush_backup`, and only *then* adopts the key. The ordering is the point:
everything that can fail happens before this device gives up the key it had.

Three things are refused before adoption: a password-locked blob, **anything
that is not an array**, and a claim the worker turned down. That middle one is
not hypothetical — without it the join falls through a shape it cannot merge,
merges nothing, and adopts the key anyway, leaving the device pointed at a
backup it cannot read with its own key already gone. `scripts/pair-join-test.mjs`
caught exactly that.

An *empty* key is fine and different: both devices end up on it and this one
publishes what it has.

Covered by `cloud/pairing.test.mjs` (15) and `scripts/pair-join-test.mjs` (27).

### Putting two devices back together

`ensureBackup()` mints a sync code on any device that has titles and no code.
That is the right behaviour for a device nobody has set up — and it means two
devices that were each used before either was pointed at the other end up
**each backing up alone, under a code of its own**. Neither is broken, nothing
failed, and the device picker offers nothing to pick, because from either side
there genuinely is no other device.

"Use code" cannot fix it. Adopting a code means this device backs up there from
now on, and two lists cannot both be the backup — so the one you did not adopt
is simply dropped. Export/Import nearly works and quietly costs you things:
`doImport()` carries title, status, episode and rating, and blanks **notes and
favourites**.

`mergeFromCode()` is the third door: pull another code's list, fold it into this
one, change nothing about where this device backs up.

The implementation detail that matters: it **cannot merge by id**. `mergeLists()`
matches on `a.id`, and two devices that minted their own codes also generated
their own `uid()` for the same show — so every shared title would arrive as a
stranger and the list would double. It goes through
`dedupeList(anime.concat(migrate(inner)))` instead, which matches the way the
rest of the app matches
(AniList id, then normalised title) and folds the pair field by field: the
further episode, the stronger status, both sets of notes, either favourite.
Local goes in **first**, so the copy that survives is this device's and the
other one fills the gaps.

Before anything is touched it writes `wl_prepush_backup` — the same slot a push
already uses, so the recovery route is the one that exists rather than a second
one to maintain. A password-locked list is refused rather than merged as
garbage, this device's own code is refused, and a malformed code never reaches
the network.

Merging the same code twice is a no-op, because the second pass dedupes against
a list that already contains it. Covered by `scripts/merge-code-test.mjs`.

### What the Cloud panel is allowed to claim

`syncPayloadSize()` measures **this device**: the size of the blob that would be
sent. The panel printed it as "Backed up: 3.20 MB of 19.07 MB · 17%" under a
heading that said `Cloud backup · ON`, which turned a local measurement into a
claim about a server nobody had asked.

A device whose first push never landed therefore read as fully backed up while
its key held nothing at all. The only thing in the app that disagreed was
`pair_new` refusing with *"that key has no backup yet"* — correct, surfaced four
lines below the sentence saying the opposite, and followed by advice that could
not be taken: **"give it a moment and try again"**. A push is scheduled by
`schedulePush()`, which fires on a **list change**, not on a timer. A device
whose first backup failed is not waiting for a moment; it is waiting for an edit.
And after three failures the backoff in `syncPush()` holds the next attempt for
up to an hour.

So the panel now reads the same two facts Settings has always read
(`backupStatusLine`): `syncAt()` — has anything ever landed — and `pushState().n`
— how many pushes have failed in a row. Until something lands it says *ready to
send*, leaves the meter empty, and shows a **Back up now** button.

`backupNow()` clears `setLastPushFP('')` and `setPushState({n:0,at:0,why:''})`,
which are exactly the two invisible things that can hold a push, then calls
`syncPush()`. It is deliberately **not** `forcePushList()`: that one stamps
`adopt`, telling every other device to take this copy whole, which can discard
their work and is why it asks first. `backupNow()` writes the key's own blob and
nothing else, so there is nothing to confirm.

**Locked is its own state, and it outranks every number.** While the list is
locked, `anime` is an empty placeholder standing in for the ciphertext. The
panel measured the placeholder, so a phone that had just joined a protected list
read *"nothing has reached the cloud yet · 166 KB ready to send"* and the
diagnosis said *"Titles here 0"* — which is exactly what losing a library looks
like. Nothing was lost and nothing was ever at risk: `_syncPushInner()` returns
immediately while `appLocked`, and below that are guards against pushing a list
that has collapsed or emptied. Only the person reading the panel was misled. The
panel and the diagnosis now say *locked* before they say any count, and the
button offered is **Unlock your list**, not Back up now.

Covered by `scripts/backup-truth-test.mjs` (23) and
`scripts/typing-and-undo-test.mjs` (28).

### Joining a list that has a password on it

A protected list is stored as a **master-key envelope**: the list is encrypted
with a random master key, and that master key is wrapped twice — once by the
password, once by the recovery key (`wrapMaster`/`unwrapMaster`). Either one
opens it. The envelope is what goes to the cloud, every time: `syncPush()` sends
`buildEnvelope()` whenever `cryptoKey && envWraps`.

Both join paths used to refuse an envelope outright, with
*"unlock it on its own device and back it up again first"*. That cannot be done.
Backing it up again produces another envelope — a protected list has no
plaintext form in the cloud — so the sentence asked for something the app can
never produce, and **two devices could not be paired at all if either had a
password**. The message read as the user's fault.

`askListPassword(env, opts, onList)` is the fix, and it is the same unwrap the
restore-by-code path already does. One field takes either secret, because from
here the password and the recovery key are the same thing: whichever unwraps the
master key. A device that already holds the right `cryptoKey` is never asked.
Nothing merges ciphertext — the plaintext comes back first, and the merge runs on
that.

The two callers differ on purpose, because the actions mean different things:

| | adopts the key | adopts the password |
|---|---|---|
| `pairJoin` — *Add a device* | yes | **yes** (`adoptProtection`) |
| `mergeFromCode` — *Merge it in* | no | no |

Pairing makes the two devices one list, so the joining device takes the wraps
with the key. Adopting the key *without* them would leave it pushing plain text
to a key whose owner set a password — a downgrade nothing would report.
`adoptProtection()` therefore runs **before** `writeLocal()`, or the merged list
lands on disk unencrypted first.

`mergeFromCode` keeps its own key, so it keeps its own protection, and its
confirmation says which it is: if this device has no password, the arriving
titles will not be protected here.

Covered by `scripts/pair-join-test.mjs` (41), which builds the envelope with the
app's own `encList`/`wrapMaster` — a fixture hand-rolled from constants would
keep passing after the wrapping changed — and asserts that a wrong password
changes nothing, that the right one merges rather than replaces, that what is
then written to disk and pushed is ciphertext, and that the recovery key opens
the same envelope.

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

### Two kinds of copy, and they are not the same copy

The cloud copy is **not** a copy of a device, and trying to make it one is the
bug above. It carries what belongs on every device and refuses what belongs to
one. That refusal is load-bearing.

A copy of a *device* is the other thing, and it lives in the admin panel
(`fullCopyRead` / `fullCopyWrite`, `scripts/full-copy-test.mjs`). It takes
every `localStorage` key with no exceptions — including every key `syncSkip()`
refuses — plus the artwork offloaded into the `wl_media` IndexedDB store, which
is the only state that does not live in `localStorage` at all. Written back onto
an empty install, the device returns as itself: same identity, same adopt
marker, same cloud key.

It is admin-gated because the file holds the cloud key and the admin token in
the clear. That is correct for a copy of everything and wrong for anything that
could be shared, so it lives behind the one panel that asks for a token.

Restoring writes inside `withoutPush()`: every `setItem` schedules a push, so a
few hundred keys would queue a few hundred pushes, each racing the reload with a
half-restored device. And the restore saves a copy of what is already there
first — if that copy cannot be written, nothing is replaced, because there would
be nothing to go back to.

### A fact about THIS device is not a setting

`collectExtra()` is an allowlist by omission: it uploads every `localStorage`
key `syncSkip()` does not refuse, and `applyExtra()` writes the lot onto every
other device. That is right for a theme and wrong for anything a device knows
only about itself, so a new key is a decision, not a default.

The one that cost a real library was `wl_adopt_seen` — this device's note of
the newest "use this device's list everywhere" decision it has already applied,
which is what makes the guard fire **once** per device. Shared, a device still
holding an old value overwrote it; the device that had already taken the newest
list then read a decision it honoured days ago as new, and took that older copy
whole. On the next push, again. `wl_device` travelling put two machines behind
one identity, which is why the roster could show one row for both and mark the
wrong one "this one". `wl_prepush_backup` travelling meant every device
overwrote every other's restore point, while a second full copy of the library
rode along inside every push.

Auditing the rest of the keys afterwards found one more with the same shape and
real teeth: `ext_watch`, the note saying "I left for a site to watch episode N
at time T". `settleExternalWatch()` turns that note into `autoMarkWatched()`,
which **writes to the list**. Shared, it arrived on a device that never left,
carrying the other device's departure clock — always older than the fifteen
minutes that mean "watched" — so a title jumped several episodes ahead on a
machine nobody had watched anything on. `src_draft` (an unsaved custom source)
and `src_tab` went the same way for smaller reasons. The rule this gives:
**if a key answers "what is happening on this machine right now", it is not a
setting**, however much it looks like one.

Left alone on purpose: `notify_on` is AND-ed with the device's own permission
at every read (`notifyOn()&&granted`), so a travelling "on" cannot make a
device claim notifications it has no permission for, and the toggle is a
preference people reasonably want everywhere.

Two tests hold the line, deliberately from different ends. `setting-sync-test`
asserts the key list — each per-device key is refused by `syncSkip()`, is absent
from `collectExtra()`, and cannot be written by an incoming `applyExtra()` —
while real settings still travel. `device-dominance-test` reproduces the
user-visible failure instead: honour a decision, take an edit, pull a stale
device's whole settings bundle, and the newest progress must still be there.

That second test detects the re-adopt through `wl_prepush_backup` rather than by
re-reading `wl_adopt_seen`, because adopting **writes** that marker on its way
past — reading it afterwards shows the fixed value on a broken build. Any
assertion here should be checked against the revision before the fix
(`aecf7ae`); three of these rows went green on the broken code until they were.

**Identical pushes.** `syncPush()` fingerprints the *plaintext* (list + extra) and
returns early when it matches the last **confirmed** push. Plaintext, not payload:
an encrypted envelope carries a fresh IV each time, so hashing what goes on the
wire would differ on every call and the guard would never fire for exactly the
people relying on it most. A failed push clears the fingerprint, so the failure
mode is an extra write, never a backup that quietly stops.

**What the fingerprint is allowed to see.** A guard that hashes everything is
not a guard. The enrichers stamp bookkeeping on each item to remember they
already tried — `imgTried`, `detTried`, `bannerTried`, `idTried`, `scoreTried`,
`svcTried`, `adultChk`, and `airChk`, which is a **timestamp** refreshed every
time the airing data is re-checked. Those belong in the payload, so another
device does not repeat the lookups. They do not belong in the hash: inside it,
merely *checking* something counted as a change, so an enrichment pass that
learned nothing still moved the fingerprint and armed a push — the app spending
a KV write to record that it had looked. `PUSH_FP_IGNORE` + `fpList()` strip
them for hashing only. On a plan whose thousand daily writes are already gone,
this is the difference between syncing when your list changes and syncing
because a timer fired. It was also the real cause of a long-standing test flake:
the list grew mid-push, which is exactly what it looks like from outside.

**One push at a time.** There was no overlap protection at all. The fingerprint
is written when the response comes back, so two pushes started inside each
other's round trip both saw the old fingerprint and both wrote — identical bytes,
twice, two writes. `_pushInFlight` holds the door and `_pushAgain` re-schedules
whatever arrived while it was shut, so nothing is dropped. The flag is set
**after** the backoff check, not before: setting it above that `return` leaves it
stuck true the first time the network is down, which permanently disables syncing
for that session. `scripts/quota-backoff-test.mjs` is what caught that.

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

**Who may read a mailbox.** `rec_pull` identified the caller by friend code
alone — and the friend code is handed out on purpose: there is a copy button for
it, `rec_send` addresses recommendations to it, and the notify worker explicitly
**refuses** to accept it as an authentication secret (see `adoptByIdentity`).
This worker was still doing exactly that, so anyone holding your code could read
every recommendation sent to you, including the note the sender wrote.

The sync code is the private one, and the setup blob stored at `list:<sync>`
already carries `extra.friend_code` — the code that device publishes. Matching
them proves ownership with no new secret, no new storage and one cheap read.

Unproven callers still get titles and sender names; only the **note** is
redacted (with `redacted: true` on the envelope), and `passes` / `echoes` come
back empty — those are a record of your own sending, and unlike a title they
have no harmless half. `src_clear` goes further and returns **403**: it deletes,
and it writes, so an unproven caller could both clear the offers waiting for you
and burn the daily write budget in a loop.

`src_pull` is deliberately left open. It returns which sites a friend offered to
share — genuinely not sensitive — and gating it would cost the feature entirely
for anyone with cloud backup off, who has no sync code to present. Redacting beats refusing:
refusing would break every cached client at once, and the titles were never the
private part. One consequence worth knowing — someone who has turned cloud
backup off has no sync code to present, so they see their own recommendations
without notes until they turn it back on.

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

### The app mark, and why it has its own test

`icons/icon.svg` is the mark. `icons/icon-1024.png` is the one render of it that
everything else comes from — the web sizes, the native app's asset catalogue, and
the Safari extension's. Nothing re-draws the mark; a copy is either that file or a
downscale of it.

That rule exists because it was broken in the obvious way. The mark was changed,
`icons/` was re-rendered, and the two asset catalogues were not — so the phone's
home screen showed three different versions of the logo at once, one of them the
orange-to-magenta one from July. No build failed and no test complained, because a
stale picture looks exactly like a current one. The only report was the user saying
he could not see the new logo.

`scripts/icon-parity-test.mjs` (12) asks the two questions that can be answered
without a PNG decoder, and between them they are the shape of that bug:

- every **1024×1024** icon in the repo is byte-for-byte `icons/icon-1024.png` —
  that is the size every catalogue carries at full resolution, so a catalogue that
  missed an update fails here;
- no derived icon was **last committed before the master was**. "The mark moved and
  this copy stayed behind" is literally a timestamp comparison. A file with
  uncommitted changes is skipped, or the commit that fixes the drift would fail on
  the drift it is fixing.

It also reads the SVG's palette back, since byte-identical copies of the *wrong*
picture would satisfy everything above.

Changing the mark therefore means: edit `icons/icon.svg`, re-render
`icons/icon-1024.png` from it, downscale the rest from that file, and commit the
lot together.

---

### The admin Updates feed shows strangers your commit log

`loadUpdates()` reads the public repo's commits live and renders the subject
line of each one. That makes every commit message user-facing copy, written by
someone in developer mode who was not thinking about a reader. Three rules keep
it readable, and `scripts/updates-feed-test.mjs` holds them (node-only, no
browser — it lifts the real regexes out of `index.html` with `new Function`
rather than restating them, because a test carrying its own copy of the rules
passes while the app is wrong).

1. **`UPD_SKIP` drops anything carrying the CI-skip marker.** A commit that opts
   out of CI is a scheduled job, not a change someone asked for. Nightly
   chapter-count refreshes were filling whole days with one repeated row, and
   printing the marker itself — build notation in front of a reader who has
   never seen a build.
2. **Repo plumbing is matched first, as `Build`.** It used to fall through to the
   `Feature` catch-all, so "Delete index.html" and "Add .nojekyll to skip Jekyll
   processing" both read as things the app had gained.
3. **`Security` needs a noun.** Matching bare `lock` tagged a keyboard change
   SECURITY because its subject ended "none of it past the lock". The rule wants
   *lock screen*, *locked list*, *password*, *passkey*, *encrypt*.

### A commit must not cancel its own deploy

GitHub reads the CI-skip marker from **anywhere** in a commit message, not just
the subject. A commit whose body merely *quoted* the marker — while documenting
rule 1 above — pushed successfully and never deployed, which is indistinguishable
from a deploy that worked until you notice the site has not changed. Recovered
with a manual `workflow_dispatch`.

`scripts/hooks/commit-msg` refuses the marker in a body and allows it in a
subject, where it is visibly deliberate. `scripts/install-hooks.sh` installs it
alongside `pre-commit`; `.git/hooks` is not in the repo, so a fresh clone has
neither until that script is run.

### The tab bar holds five, and the + owns the middle

`.nav` is `repeat(5,minmax(0,1fr))`. The count is odd deliberately. The `+` is
the only filled, accented object in the bar, so the eye finds it first and reads
the bar's balance from it — which requires a middle track to put it in. Six
tabs leave it in track 3 of 6, two items left and three right, the bar's true
centre falling on the gap beside it. Nothing is misaligned by a pixel; the
arrangement is lopsided, which is worse, because there is nothing to nudge.

The five are **Home, Stats, +, Sources, Settings**. Sources is there because it
is the panel you reach for *while using the app* — a title opens somewhere
wrong and you want your services immediately. Cloud is set up once and then
never touched, so it lives on the first tile in Settings, which carries its live
status line and goes red the moment a backup stops landing; it is also `c` on a
keyboard. Anything added to the bar later has to displace a tab, not join them.

`scripts/nav-layout-test.mjs` measures this rather than trusting it: odd tab
count, `+` at the middle index, its centre within 1px of the bar's, Sources
present, Cloud absent, and Settings still containing a route to `backupSheet` —
that last one is the guard that matters, because Cloud leaving the bar makes
Settings the only always-visible way in.

Sources opens from three places (the tab, the Settings tile, and the player's
no-source prompt), so **Back** has two right answers. `openSources(fromNav)`
records which, and `sourceBack()` either closes or returns to Settings. Wiring
Back straight to Settings dropped you into a panel you had never been in — a
back button that walks you forward.

## 12. Conventions & hard rules

**Voice — the app informs the user; it does not explain itself**

The copy had drifted into sounding like the person who wrote it talking to the
person using it: *"Nothing is stored in the cloud under this key yet, so there is
nothing for another device to join"*, *"The cloud copy could not be read on this
device, so the two sides cannot be compared here"*. Every one of those sentences
is true, and every one of them is a mechanism being explained to somebody who
only needed to know what happened and what to do.

- Say **what happened** and **what to do**. One fact per sentence.
- The *why* belongs in a code comment or in this file. Not in the UI.
- Avoid "so that", "which means", and em-dash asides that carry a second clause.
- Don't name internals — key, blob, envelope, device id, push — unless the
  person has to act on that word.
- Applies to toasts, panel text, diagnostics, release notes and empty states.
- **There is no author inside the app.** The tour told people a key could not be
  recovered "not even by me". There is no me here; there is the app and the
  person using it.

`scripts/app-voice-test.mjs` enforces the last two points, because this drifted
back three times — Cloud was cleaned up, then the admin panel, the tour and the
toasts each turned out to have their own copy of the same habit. It reads only
surfaces that are definitely rendered (toast literals, `ai-desc` / `hint`
paragraphs, and `WT_STEPS`), never comments, which is where the reasoning is
supposed to live. Scoping it to toasts and panels alone missed the tour, and the
tour held the worst line in the app — so the scope is part of the test, not an
implementation detail. Point it at an older revision to see it fail on the copy
that actually shipped:

    node scripts/app-voice-test.mjs /tmp/old-index.html

**Style**
- **Feather icons and brand fonts only.** Custom controls, not platform defaults.
- **No emoji in the UI** — clean typography / Feather icons on brand colors.
- **Surgical edits, not rewrites.** One action per job; no duplicate paths.
- Match the surrounding code's density and idiom; comments explain *why*.

**Keyboard**

One handler, at the bottom of the file, holds the whole map. The combos the app
claims are listed **before** its `⌘/Ctrl` bail, so they share its `_kbTyping()`
and `_kbBlocked()` guards instead of growing a second set that drifts from them.
Everything else with a modifier is left to the browser.

| | |
|---|---|
| `/`, `⌘K` | search |
| `1`…`5` | filter: all, watching, plan, finished, dropped |
| `a`, `s`, `c`, `⌘,` | add a title, Stats, Cloud, Settings |
| `?`, `⌘/` | the shortcut card |
| `h j k l` / arrows, `⇧`, Space, Enter | move, select, open |
| `⌘A`, `⌘⇧A` | select everything on screen, clear the selection |
| `e`, `f` | edit / favourite the focused card |
| `⌘⌫` | remove the focused card, or the selection — still asks |
| `⌘Z` / `⌘⇧Z`, `⌘Y` | undo / redo (⌘Y because it is redo everywhere else) |
| `.` `,` `f` `e` `⌫` *(title open)* | episode forward / back, favourite, edit, remove |
| `w` `p` `d` `x` *(title open)* | watching, plan, done, dropped |

`⌘A` takes what the page is **showing**, not everything owned. A filter or a
search is a statement about what you are working on, and ⌘A meaning "all 285"
inside a filtered view would be a nasty surprise one keypress from the bulk
menu. The four status keys are safe to put one press away precisely because
every one of them is undoable.

The open-title keys run **before** the `_kbBlocked()` check: "a sheet is open"
is the state they exist for, not a reason to ignore them.

`pushUndo(label, undo, redo)` stores **the fields to put back**, never a
snapshot of the list — a library here is several megabytes, so a stack of
snapshots would spend tens of megabytes to buy an undo of the last action. It is
recorded on every device, not only ones with a keyboard: the first version gated
it on a `(hover:hover) and (pointer:fine)` media query, which an iPad with a
keyboard attached does not reliably answer, so the undo was missing on exactly
the device that had something to press. A step that fails to apply is pushed
back onto its stack rather than lost.

Removal's undo takes the **tombstone** off as well, and its redo puts it back.
Without that the title returns and the next sync deletes it again, so the undo
appears to work for about ten seconds.

**Typed codes**
- `formatCodeInput(el, max, group)` upper-cases, strips punctuation and groups
  in fours **as you type** — 8 for a pairing code, 20 for a key. Submit already
  did this; the field now shows it. It restores the caret by counting the
  characters that matter before it, so editing the middle of a code works.

**Workflow**
- After editing `index.html`, **regenerate `friends.html`** (§3).
- Syntax-check the inline JS before shipping.
- Web changes go live via GitHub Pages; the app auto-updates (§9).
- After changing the app mark, re-render **every** copy from `icons/icon-1024.png`
  and run `node scripts/icon-parity-test.mjs` (§11).

**Hard rules (non-negotiable, both builds)**
1. **Never host video.** Never embed a service's stream, never handle streaming
   credentials, never build a scraper or auto-resolver that goes looking for one.
   The two moves available are opening the user's *own* service (official app)
   and the neutral user-configured custom-source field. See §10.
2. **No adult content.** Enforced by the gate in §7 — don't weaken it.

## Setup kits — a link that arrives configured

Handing someone this app used to mean a call: let them in, read them a code,
walk them through the sources, notifications, the AI key. Every one of those
steps has an answer the sender already knows, which is the definition of work
that should not happen on a call.

A kit is that answer set, stored once and claimed once. Endpoints on the notify
worker: `/kit-new` and `/kit-list` / `/kit-revoke` (admin-gated), `/kit-peek`
(public, says who it is from and whether it is spent, never the payload), and
`/kit-claim`.

**Single use, bound on first claim.** A link cannot know who will open it, and
pretending otherwise would be a lie told in a UI — so the first device to claim
one takes it and every other device is refused. The claiming device may re-claim
freely: the same person reopening the link, or finishing a reinstall, is not an
attack. Claiming also *joins* — that is the whole point — but it still counts
against the member cap and still notifies the admin, because a member who
appears without a trace is how a roster becomes a mystery.

**What a kit carries is an allow-list, never a deny-list.** `collectExtra()`
already exists and is exactly this shape — it is the settings bag sync sends —
and reusing it would have been one line. It also carries the sender's cloud
code, which in a backup of your own is harmless and in an invite is the keys to
your list. So `KIT_KEYS` names what travels: the source setup and the
recommended sites. Not `sync_*`, not `anthropic_key`, not `friends`, not
`wl_device` / `friend_code` / the admin token, not the list.

**The look deliberately does not travel.** Theme, retro, accent, density and
home layout were in the first version, and handing those over means the first
thing somebody sees of their own app is somebody else's taste, arriving as a
setting they did not choose. The setup worth inheriting is the part that is
tedious and has one right answer.

**A kit does not claim to have finished setting anyone up.** It skips the three
cards explaining what the app is and lands on the checklist, because two of its
rows are jobs a link physically cannot do: Add to Home Screen, which the browser
owns and which on iPhone is the only way an alert ever arrives, and the
notification permission, which needs their own tap.

## Borrowed AI — the sender's key, spent on the server

`callAI` goes straight from the browser to Anthropic or Gemini, which is right
for a key somebody typed in themselves and exactly wrong for one handed out in
an invite: ship that key to the browser and it is in the recipient's developer
tools in five seconds, and any limit counted in their localStorage is a number
they can edit. **A cap is either enforced where the key lives or it is
decoration.**

So a borrowed key never leaves the worker. `/ai` takes a prompt and a device id,
reads the budget written at claim time (`aib:<dev>`), spends it **before** the
upstream call — a reply that fails to arrive still cost the request, and
counting on the way back makes a loop of failing calls free — and forwards using
`env.AI_KEY`. When it runs out the app asks for a key of their own, which goes
back to being a direct browser call. `/ai-budget` reads the remainder without
spending anything.

The write cost is bounded by the cap itself: a 200-request budget can cost at
most 200 KV writes, ever.

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

---

## Joining a key, and the one time merging is wrong

**Add a device** (`pairOffer` → `pairJoin` → `pairFinish`) folds two lists
together. That is right nearly every time: two devices that have both been used
each hold something the other does not, and a merge cannot lose anything.

It is wrong in exactly one case, and it is a case people hit on purpose: *the
device in your hand is the copy you want gone.* The phone drifted, the computer
is right, and the person is holding the phone. Merging then does three things
they did not ask for — the phone's stale titles enter the good list, `pairFinish`
calls `schedulePush()` and sends them to the cloud, and from there every other
device pulls them. None of that is undoable from the far end, because KV keeps
no history.

So `pairFinish(code, inner, wraps, key, replace)` has a second mode, offered as
**Replace what is on this device** beside both copies of the join field (the
panel renders a different one depending on whether backup is already on, and a
phone that minted its own key sees the *on* branch — the mode has to exist in
both or it is missing exactly where it is needed).

What `replace` changes, and nothing else:

- `anime = migrate(inner)` instead of `dedupeList(anime.concat(...))`. The
  joined list arrives whole; this device's does not survive.
- An **empty** `inner` is refused outright — list untouched, key not adopted.
  This is the `forcePushList` / `adoptFromDevice` rule in a third place: an empty
  list replacing a full one is never what anybody meant. Merging needs no such
  guard, since it can only ever add.
- The restore point is still written first, into `wl_prepush_backup`, before
  anything is dropped.

What it deliberately does **not** change: it does not apply the other device's
`extra` (ordinary sync carries settings across on the next pull — see §8), and it
does not stamp `adopt`. Replacing is a statement about *this* device only. The
list being joined is not disturbed by being joined, which is the property that
makes it safe to run from the wrong device.

`scripts/replace-join-test.mjs` holds it to that: the Mac's rows arrive id for
id, the phone's note (the most specific thing a merge preserves) is gone, and
nothing matching `phone-` reaches `__pushed` after `flushPush()`. On the build
before this existed, that last row fails — the titles went up.

### Erasing a copy two devices share

`syncForget()` has the same shape of problem one step later. Once a join has
happened there is **one** copy under the key, and the other machine restores from
it — but the button is read on whatever device is in your hand, where "Erase the
stored copy" naturally parses as *erase this device's backup*. The old confirm
said "Any OTHER device still using this code keeps its own copy", which is true
and is exactly the kind of true sentence people read past.

It now answers the question instead of posing it. Before the dialog can be
accepted it calls `syncDevices()`, filters out `wlDevice()`, and if anyone else
is there the title and message are rewritten to name them with their title
counts, say what erasing costs those machines, and point at **Turn off** — which
is the button somebody means when they only want this device to stop.

Two details are load-bearing:

- The confirm opens **immediately** with the generic wording and the Yes button
  `disabled`, reading "Checking…". A destructive button must not be pressable
  while the app is still working out what it destroys, and an instant dialog
  whose text changes under a reader is worse than one that waits.
- The lookup is raced against a **2.5s** timeout and wrapped in `try`. A read
  must never be the thing standing between somebody and a button, so a cloud
  that never answers gets the old wording and a working Erase, not a dead one.

Before rewriting the dialog it re-checks `confirmBox.classList.contains('on')`
and `_confirmCb === doErase`: the dialog may have been answered or dismissed
while the lookup was in flight, and the next one along is not ours to rewrite.
