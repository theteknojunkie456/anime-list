# WatchList

A personal anime / manga / show / movie tracker that runs entirely in the browser — no accounts, no database. Installable as an app on your phone (PWA) and hosted free on GitHub Pages. Tracks both what you **watch** and what you **read** (manhwa, webtoons, light novels), with real cover art, airing schedules, and episode notifications.

**App:** https://theteknojunkie456.github.io/anime-list
**Friends (shareable) viewer:** https://theteknojunkie456.github.io/anime-list/friends.html — see [FRIENDS.md](FRIENDS.md)

## Two versions, one app

| File | Who it's for | Starting data |
|------|-------------|---------------|
| `index.html` | The main app | A small neutral demo list (your real list lives in your browser + private sync) |
| `friends.html` | Anyone — a read-only viewer for a friend's shared list | Blank |

Every list is saved in **your own browser** (localStorage) and, optionally, in a private cloud store gated by a secret sync code — nobody can see anyone else's data, and the two versions use separate storage so they never mix. See **[FRIENDS.md](FRIENDS.md)** for how sharing works.

> **Privacy:** the repo is public (that's just the app code), but no personal list is in it — `index.html` ships a neutral demo seed; your real titles stay in localStorage and, if you enable sync, in a private code-gated cloud copy.

## Features

- **Watch _and_ Read** — a Watch/Read toggle splits the app into two lists: anime/TV/movies, and manga/manhwa/webtoons/light novels. Each entry has statuses: Plan · Watching/Reading · Done · Dropped.
- **Real cover art (incl. manhwa/webtoons)** — every entry shows its real poster, fetched automatically in the background and captured during autofill from:
  - [AniList](https://anilist.co) — anime **and** manga/manhwa/webtoons/light novels (via `type: MANGA`), plus a per-title dominant color and wide banner art
  - [Jikan](https://jikan.moe) (MyAnimeList) — anime franchise relation graph for watch order
  - [TVMaze](https://www.tvmaze.com/api) — live-action TV, per-season breakdown
  - [Open Library](https://openlibrary.org/developers/api) — books
  You can also **upload your own** cover, and a wrong auto-match can be removed in Edit.
- **Autofill** — type a title and pick from real matches: the app searches **AniList** (anime for your watch list, manga/manhwa/webtoons for your reading list) and offers up to 6 results plus any **live-action** adaptation from TVMaze, each labelled with its format, year and episode count. Choosing one fills in episodes/chapters, hours, genres, notes and cover. It deliberately **asks instead of guessing** — one title can mean several things ("One Piece" is a 1999 anime, a 2027 remake, films, and a Netflix live-action), and the old behaviour of taking the first hit from whichever API answered first meant a MyAnimeList outage silently filled in the wrong show. Watch order (series chain + franchise movies, side OVAs, recaps marked SKIP) still comes from MyAnimeList's relation graph, but only as best-effort enrichment *after* you've chosen — a missing watch order beats a wrong title. Free public databases, no key needed.
- **Weekly schedule** — a calendar of your tracked shows' upcoming episodes, week by week (prev / next / "this week"), each day listing what airs and when in your local time. Powered by AniList airing data (delay-aware), with an offline fallback.
- **For You (recommendations)** — tailored anime picks *not on your list yet*, from AniList's community recommendation graph (real titles, not AI-generated). Aggregated across your list (weighted Finished > Watching > Plan) with a "Because you watched X" reason and one-tap **+ Plan**.
- **Airing times** — watch anime show their next-episode air time (local, delay-aware) on cards and detail.
- **Episode notifications** — opt in and get a push when a new episode of a show you're Watching/Planning actually airs, at the real air time. Backed by a Cloudflare Worker (cron every 15 min + Web Push). On iPhone, add the app to your Home Screen first (iOS 16.4+). See [cloud/](cloud).
  Because the worker only announces episodes that aired in the last 40 minutes, a list of mostly *finished* series can legitimately stay silent for weeks — which reads as "broken" when it isn't. So Settings → Notifications **says what it's doing**: how many shows are tracked and what's next (*"Next up: BLACK TORCH Ep 3 — Saturday 9:00 AM (in 3 days)"*), or plainly that nothing's airing soon and the quiet is expected. **Send a test notification** proves the whole chain — VAPID signing → Apple/Google push → service worker → lock screen — in two seconds instead of waiting for an episode; if your push endpoint has died (every Home Screen reinstall mints a new one) it detects that and re-subscribes.
- **Cinematic title page** — tapping any title opens a full-screen, streaming-style page (not a popup): a large banner-art hero that parallaxes and fades as you scroll, the title floating over it, and everything — progress, rating, status, watch order, notes — flowing below. Slides up; back button to exit.
- **Per-title theming** — each title's detail/hero uses its real **banner art** as a background (with a legibility scrim) and tints its accent from the cover's dominant color — automatically. You can also set your **own background photo** per title (auto-compressed).
- **Themes** — character-inspired color themes plus a custom theme builder (pick accent + background, name it, get the full palette). Every theme — including ones you build — is **WCAG AA** by construction: the three text tiers are lifted until they clear 4.5:1 against that theme's own surfaces, and each accent gets the foreground that actually contrasts with it (near-black on Naruto's orange, white on Sasuke's purple) rather than assuming white.
- **Responsive** — auto-adapts between portrait and landscape (and tablets/wide screens): a widescreen hero, fluid poster grids, and modal sheets in landscape.
- **No duplicates** — adding a title you already have opens the existing entry instead of creating a second copy. Matching ignores case, spacing and punctuation; your watch and reading lists are separate namespaces, so the anime and the manga of the same name can both live in your library.
- **Import** — paste a plain-text list (one title per line, optional `- watching` / `- finished` tags) and bulk-import with a preview.
- **AI chat (optional)** — a real conversational AI companion that knows your list: streaming replies, markdown, chat history that persists, a model picker, and quick prompts tuned to your list (plus one-shot Suggest & Rank helpers). Paste a **free** key from [Groq](https://console.groq.com), [Google AI Studio](https://aistudio.google.com), or [OpenRouter](https://openrouter.ai) (or paid Claude). Auto-detects the provider; key stored only on your device. Everything else works without one.
- **Password lock (end-to-end encryption + recovery key)** — optionally set a password that encrypts your **entire list** with AES-GCM. Under the hood the list is sealed with a random **master key**, which is then wrapped twice — once by your password, once by a one-time **recovery key** — so *either* can unlock it (both via PBKDF2, 150k iterations). The list is stored as ciphertext on your device **and** in the cloud sync copy — genuinely unreadable without a secret, even in browser devtools. On launch the app shows a lock screen. **Forgot your password?** Tap "Use recovery key" and paste the code you saved at setup (accepts any spacing/case) to get back in and set a new one. Set / change / remove the password and re-issue a recovery key in Settings → Password. **Face ID / Touch ID unlock** (iOS 18.4+): a passkey's WebAuthn **PRF** extension derives a stable secret, and the master key is wrapped a third time with it — so biometric unlock is real cryptography, not a key left in localStorage behind a check. Password and recovery key keep working; the option is hidden where the platform can't do it. It stays **zero-knowledge** — no server, no account, no backdoor — so if you lose *both* the password and the recovery key, the data cannot be recovered. (A friend viewing an encrypted list via `friends.html` must be given the password.)
- **Typography & colour** — titles are set in **Bricolage Grotesque**, body in **Manrope** (deliberately not Inter, which every AI-generated UI converges on). Text runs on a three-tier ramp that is WCAG AA on every surface *and* keeps ~1.75× lightness between tiers, so "muted" still reads as muted instead of collapsing into the tier above. The accent marks primary actions and warnings only; section headers and settings rows wear the status palette (amber/blue/green/grey) so a theme tints the app without flattening it to one hue.
- **Tutorial** — a short "How it works" guide that **opens on the first frame** for a genuinely new install — before any content, no delay, no slide-in — and is never shown to anyone with an existing list. Reachable any time from Settings → *How WatchList works* (the first row). Eight steps, with **"Back up your list — do this first"** deliberately second, on the opening screen: it's the only step whose absence costs someone their entire list. It walks through adding titles, the Watch/Read switch, the schedule and notifications, and recommendations — and deliberately front-loads the thing that actually loses people their data: **turn on cloud backup and save your sync code**, plus how the password and recovery key relate.
- **Cloud sync + Friends** — sync your list across devices with a secret code, and share it read-only with friends. See [FRIENDS.md](FRIENDS.md).
- **Works offline** — service worker caches the app.

## Project structure

```
anime-list/
├── index.html            # The app (all CSS/JS inline, no build step)
├── friends.html          # Read-only friend-list viewer (blank start, separate storage)
├── manifest.json         # PWA manifest
├── sw.js                 # Service worker — offline cache + Web Push handlers
├── icons/                # App icons (icon.svg master + 192/512 PNG)
├── cloud/
│   ├── sync-worker.js    # Cloudflare Worker — list sync (pull/push by secret code)
│   ├── notify-worker.js  # Cloudflare Worker — episode push notifications (cron + Web Push)
│   └── wrangler.toml     # Worker deploy config
├── .github/workflows/    # GitHub Actions → Pages deploy
├── README.md
└── FRIENDS.md            # How the friends/sharing feature works
```

Each HTML file is fully self-contained — there is no build step. **Never edit `friends.html` directly**: edit `index.html`, then regenerate it (blank the `DEFAULT_DATA` array and swap the storage key `animelist_v4` → `animelist_friends_v4`).

## Development

Two agent skills are installed **project-locally** (`.claude/skills/`, gitignored — see the deploy note below):

| Skill | What it does |
|-------|--------------|
| [impeccable](https://github.com/pbakaus/impeccable) | Design guidance + a deterministic detector. A `PostToolUse` hook scans UI edits and flags AI-generated-design tells, contrast failures, and readability problems. `npx impeccable detect index.html` for a full pass. |
| [find-skills](https://github.com/vercel-labs/skills) | Discovers and installs other agent skills from the open ecosystem. |

> **Why gitignored:** the Pages workflow uploads `path: .` — the *entire repo* — so anything tracked is published to the live site. Local tooling (and `skills-lock.json`, and `.look-backup/`) stays out of git so it never ships.

Design tags mark restore points before visual overhauls: `look-v1` (pre-typography), `look-v2` (pre-prose-pass). Restore with `git checkout <tag> -- index.html friends.html`.

## Deploying changes

1. Edit and push to `main` → GitHub Actions deploys to Pages (live in ~a minute).
2. The **workers** (`cloud/`) deploy separately to Cloudflare. Notifications need `wrangler deploy` + a `VAPID_PRIVATE_KEY` secret + a KV namespace (see `cloud/wrangler.toml`).
3. The app fetches fresh files whenever online, so updates appear on next launch.

## Adding it to your phone

Open the link in Safari (iPhone) or Chrome (Android) → Share → **Add to Home Screen** — launches full-screen like a native app. (Required on iPhone for episode notifications, iOS 16.4+.)
