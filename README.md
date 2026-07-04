# 📺 Anime Watchlist

A personal anime / show / movie / book tracker that runs entirely in the browser — no accounts, no server, no database. Installable as an app on your phone (PWA) and hosted free on GitHub Pages.

**My list:** https://theteknojunkie456.github.io/anime-list
**Shareable version:** https://theteknojunkie456.github.io/anime-list/friends.html

## Two versions, one app

| File | Who it's for | Starting data |
|------|-------------|---------------|
| `index.html` | Me | Pre-loaded with my list |
| `friends.html` | Anyone — share the link freely | Blank slate |

Everyone's list is saved in **their own browser** (localStorage). The same `friends.html` link gives every new person a fresh, private list — nobody can see anyone else's data, and the two versions use separate storage so they never mix. Both files are the identical app; `friends.html` is regenerated from `index.html` with blank data.

## Features

- **Track anything** — anime, TV shows, movies, books — with three statuses: 📋 Plan · ▶ Watching · ✓ Done
- **Official cover art** — every entry shows its real poster (MyAnimeList / TVMaze / Open Library). Covers are found automatically in the background, captured during autofill, or **upload your own** from your photo library (add/edit form → 📷 Upload; images are downscaled on-device). A wrong match can be removed in Edit and stays removed
- **✦ Autofill** — type a title and the app fills in episodes, total hours, genres, notes, and a full **watch order**: the series chain in order, plus **every franchise movie** (Naruto's 12, One Piece's 14…), side OVAs, and recaps marked SKIP. When there are 3+ films they collapse into a tap-to-expand "🎬 N side films" section so the main path stays readable. Powered by free public databases, no key needed:
  - [Jikan](https://jikan.moe) (MyAnimeList) for anime — walks the whole franchise relation graph
  - [TVMaze](https://www.tvmaze.com/api) for live-action TV — per-season episode breakdown
  - [Open Library](https://openlibrary.org/developers/api) for books — page count and reading time
- **📋 Import** — paste a plain-text list from Notes or anywhere (one title per line, optional `- watching` / `- finished` tags) and bulk-import with a preview
- **✦ AI panel** — the floating button at the bottom-right opens Suggest (what to watch next), Ask (questions about your list), and Rank (best viewing order for your plan list). Paste an API key into the panel — either a **free Gemini key** ([aistudio.google.com](https://aistudio.google.com), no card needed) or a Claude key ([console.anthropic.com](https://console.anthropic.com)). The app auto-detects which kind it is; the key is stored only on that device. Everything else works without one
- **🎨 Themes** — character-inspired color themes, plus a custom theme builder: pick an accent and background color, name it, and the app generates the full palette. Custom themes can be deleted from the grid (✕)
- **Works offline** — service worker caches the app; your list lives on-device anyway

## Project structure

```
anime-list/
├── index.html            # The app (my copy, seeded with my list)
├── friends.html          # Identical app, blank start, separate storage
├── manifest.json         # PWA manifest (name, icons, standalone display)
├── sw.js                 # Service worker — network-first, offline fallback
├── icons/                # Home-screen icons (192px & 512px)
├── .github/workflows/    # GitHub Actions deploy to Pages
└── README.md
```

Each HTML file is fully self-contained (all CSS and JS inline) — there is no build step. **Never edit `friends.html` directly**: edit `index.html`, then regenerate it (blank the `DEFAULT_DATA` array and swap the storage key `animelist_v4` → `animelist_friends_v4`).

## Deploying changes

1. Edit the files and push to `main`
2. The GitHub Actions workflow deploys to Pages automatically — usually live in under a minute (check the Actions tab if something fails)
3. The app fetches fresh files whenever online, so updates appear on next launch — no cache clearing needed

## Adding it to your phone

Open the link in Safari (iPhone) or Chrome (Android) → Share → **Add to Home Screen**. It launches full-screen like a native app.
