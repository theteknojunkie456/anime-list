# WatchList — product context

Register: **product** (design serves the product; this is app UI, not a landing page)
Platform: **adaptive** — a web PWA is the primary build, with a native iOS shell
(`ios-broadcast/`) wrapping the same HTML in a WKWebView.

## What it is

A tracker for anime, manga, manhwa, webtoons and live-action TV. It remembers
what you're part-way through, tells you when a new episode airs or a new chapter
drops, and opens the thing on whatever source you already use.

The entire app is one file: `index.html`, ~900KB, no build step, no framework.
`friends.html` is generated from it by a pre-commit hook — never edit it by hand.

## Who uses it

The owner and a small circle of invited friends, almost entirely on iPhone, most
often one-handed and often in bed with the lights off. Sessions are short and
purposeful: "what's next", "is it out yet", "carry on where I stopped". The
desktop layout exists but is the secondary case.

That scene decides the theme: **dark is not a style choice here, it's the room.**

## What matters, in order

1. **The list must not be lost.** Everything else is a view onto it. It lives in
   localStorage, is mirrored to IndexedDB, and is backed up to a Cloudflare
   Worker by default. Any change that can lose or overwrite a list is the most
   serious class of bug in this codebase.
2. **Nothing interrupts playback.** No reload, no re-render, no toast that steals
   focus while something is playing. Timers stand down; the home list doesn't
   even re-render behind the player.
3. **Progress keeps itself.** People don't press "mark watched". The app infers
   it — and in the native shell measures it — rather than asking.
4. **Say what's true.** A status line that can't be wrong because it never checks
   is worse than no status line. Prefer "the last 5 backups failed" over "On".

## Non-goals

- No accounts, no login, no email. A 20-character sync code is the whole identity
  system.
- No ads, no upsell, no growth surfaces.
- Not a social network. Recommendations are an explicit act; ambient presence
  ("here's what your friends are watching") was built and deliberately removed —
  watching something is not the same as choosing to tell someone.

## Hard constraints

- **No emoji anywhere in UI chrome.** Feather-style icons or clean typography.
  Two deliberate exceptions the owner wants kept: the theme-picker emoji and
  party reactions.
- **Never use the words "legal" or "piracy"** in UI copy or when describing the
  app. It reads as suspicious.
- **Brand over platform defaults.** Custom controls, the brand type pair and the
  Feather icon set stay, even where a HIG/Material audit would call them
  non-conformant. That's a chosen trade, not an oversight.
- **One action per job.** No duplicate paths to the same outcome; a small request
  means a small change, not an expanded one.
