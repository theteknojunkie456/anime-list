# 📺 Anime Watchlist

A personal anime / show / movie / book tracker that runs entirely in the browser — no accounts, no server, no database. Installable as an app on your phone (PWA) and hosted free on GitHub Pages.

**Live app:** https://theteknojunkie456.github.io/anime-list
**Shareable version:** https://theteknojunkie456.github.io/anime-list/friends.html

## Two versions, one app

| File | Who it's for | Starting data |
|------|-------------|---------------|
| `index.html` | Me | Pre-loaded with my list |
| `friends.html` | Anyone — share the link freely | Blank slate |

Everyone's list is saved in **their own browser** (localStorage). The same `friends.html` link gives every new person a fresh, private list — nobody can see anyone else's data, and the two versions use separate storage so they never mix.

## Features

- **Track anything** — anime, TV shows, movies, books — with three statuses: 📋 Plan · ▶ Watching · ✓ Done
- **✦ Autofill** — type a title and the app fills in episodes, total hours, genres, notes, and a full **watch order** (sequels in order, optional OVAs, skippable recaps). Powered by free public databases, works for everyone with no setup:
  - [Jikan](https://jikan.moe) (MyAnimeList) for anime — walks the whole franchise graph
  - [TVMaze](https://www.tvmaze.com/api) for live-action TV — per-season episode breakdown
  - [Open Library](https://openlibrary.org/developers/api) for books — page count and reading time
- **📋 Import** — paste a plain-text list from Notes or anywhere (one title per line, optional `- watching` / `- finished` tags) and bulk-import with a preview
- **✦ AI panel** — Suggest what to watch next, Ask questions about your list, and Rank your plan-to-watch queue. Uses the Claude API and needs an [Anthropic API key](https://console.anthropic.com) pasted into the panel — the key is stored only on that device. Everything else works without one.
- **🎨 Themes** — character-inspired color themes
- **Works offline** — service worker caches the app; your list lives on-device anyway

## Project structure

```
anime-list/
├── index.html      # The app (my copy, seeded with my list)
├── friends.html    # Identical app, blank start, separate storage
├── manifest.json   # PWA manifest (name, icons, standalone display)
├── sw.js           # Service worker — network-first, offline fallback
├── icons/          # Home-screen icons (192px & 512px)
└── README.md
```

Each HTML file is fully self-contained (all CSS and JS inline) — there is no build step.

## Deploying changes

1. Edit the files and push to `main` (or upload via GitHub's web UI)
2. GitHub Pages rebuilds automatically in ~30 seconds
3. The service worker fetches fresh files whenever online, so updates appear on next launch — no cache clearing needed

## Adding it to your phone

Open the link in Safari (iPhone) or Chrome (Android) → Share → **Add to Home Screen**. It launches full-screen like a native app.
