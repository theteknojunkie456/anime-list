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
- **Autofill** — type a title and the app fills episodes/chapters, hours, genres, notes, and a full **watch/read order** (series chain + franchise movies, side OVAs, recaps marked SKIP). Kind-aware: reading titles pull chapters/volumes from AniList manga. Free public databases, no key needed.
- **Weekly schedule** — a calendar of your tracked shows' upcoming episodes, week by week (prev / next / "this week"), each day listing what airs and when in your local time. Powered by AniList airing data (delay-aware), with an offline fallback.
- **Airing times** — watch anime show their next-episode air time (local, delay-aware) on cards and detail.
- **Episode notifications** — opt in and get a push when a new episode of a show you're Watching/Planning actually airs, at the real air time. Backed by a Cloudflare Worker (cron + Web Push). On iPhone, add the app to your Home Screen first (iOS 16.4+). See [cloud/](cloud).
- **Per-title theming** — each title's detail/hero uses its real **banner art** as a background (with a legibility scrim) and tints its accent from the cover's dominant color — automatically. You can also set your **own background photo** per title (auto-compressed).
- **Themes** — character-inspired color themes plus a custom theme builder (pick accent + background, name it, get the full palette).
- **Responsive** — auto-adapts between portrait and landscape (and tablets/wide screens): a widescreen hero, fluid poster grids, and modal sheets in landscape.
- **Import** — paste a plain-text list (one title per line, optional `- watching` / `- finished` tags) and bulk-import with a preview.
- **AI panel (optional)** — Suggest / Ask / Rank helpers. Paste a **free** key from [Groq](https://console.groq.com), [Google AI Studio](https://aistudio.google.com), or [OpenRouter](https://openrouter.ai) (or paid Claude). Auto-detects the provider; key stored only on your device. Everything else works without one.
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

## Deploying changes

1. Edit and push to `main` → GitHub Actions deploys to Pages (live in ~a minute).
2. The **workers** (`cloud/`) deploy separately to Cloudflare. Notifications need `wrangler deploy` + a `VAPID_PRIVATE_KEY` secret + a KV namespace (see `cloud/wrangler.toml`).
3. The app fetches fresh files whenever online, so updates appear on next launch.

## Adding it to your phone

Open the link in Safari (iPhone) or Chrome (Android) → Share → **Add to Home Screen** — launches full-screen like a native app. (Required on iPhone for episode notifications, iOS 16.4+.)
