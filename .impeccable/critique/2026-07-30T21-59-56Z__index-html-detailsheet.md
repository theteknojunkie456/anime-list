---
target: detail sheet
total_score: 24
p0_count: 0
p1_count: 4
timestamp: 2026-07-30T21-59-56Z
slug: index-html-detailsheet
---
⚠️ DEGRADED: single-context (session policy forbids spawning sub-agents unless the user asks; standing user preference is solo work)

Target: `index.html` — detail sheet (`#detailSheet` / `renderDetail` / `loadRichDetail` / `loadFranchise`)
Measured live on a real item (Attack on Titan, 25 episodes, franchise + rich detail loaded).

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Franchise and rich detail inject mid-sheet after load, shifting everything below them |
| 2 | Match System / Real World | 3 | Plain labels, but "Watch this on" and "Watch on" are different things with the same name |
| 3 | User Control and Freedom | 3 | Delete confirms, progress is reversible, back is always there |
| 4 | Consistency and Standards | 2 | Five button vocabularies in one sheet; a stray empty label renders a gap |
| 5 | Error Prevention | 3 | Delete confirms, the pin field has a Test |
| 6 | Recognition Rather Than Recall | 3 | Nothing is hidden — that's also the problem |
| 7 | Flexibility and Efficiency | 1 | The +1 episode button sits 1,511px down; it's the thing you press most |
| 8 | Aesthetic and Minimalist Design | 1 | 3,392px tall, 70 buttons, 11 sections, 25 episode buttons rendered inline |
| 9 | Error Recovery | 3 | Pin test prints the resolved URL; franchise failure degrades quietly |
| 10 | Help and Documentation | 3 | The `{ep}` token explainer is genuinely good contextual help |
| **Total** | | **24/40** | **Acceptable — significant work needed** |

Cognitive load: 6 of 8 checklist items fail (single focus, chunking, visual hierarchy, one-thing-at-a-time, minimal choices, progressive disclosure) → high.

## Measured

- Sheet content: **3,392px**. On a phone that's roughly five screens.
- **Episode progress at 1,511px.** Cover at 0, Favorite 224, Continue Watching 296 — then 1,200px of source picker before the control you press after every episode.
- **Your rating at 3,050px**, actions at 3,286px.
- **70 buttons**, 25 of them episodes, 11 of them streaming-source chips.
- Two sections labelled "Watch this on" and "Watch on".

## Anti-Patterns Verdict

**LLM assessment**: not slop — the content is real and the copy is specific. The failure is product-register: everything the app knows got poured onto one surface in load order, so the sheet reads as a data dump with a tracker buried inside it.

**Deterministic scan**: `detect.mjs` reports the same 10 whole-file warnings as the previous runs, none inside this sheet.

**Visual overlays**: not attempted. The browser window is in a broken state this run — `innerHeight` reports 0 and screenshots error out — so this critique is measurement- and code-based, with no visual pass. Stated rather than glossed.

## What's Working

- **The runtime line.** "10h to watch all 25 episodes" is the kind of fact a tracker exists to tell you, and it's placed where you see it first.
- **The franchise list.** Showing every season including ones not on your list, loaded async and cached, is real work and it pays off.
- **The pin explainer.** One line, names the `{ep}` token, says what it does. Contextual help at the moment of use.

## Priority Issues

**[P1] The thing you press most is two screens down.** Episode progress sits at 1,511px. Finishing an episode means opening the sheet and scrolling past a banner, a favourite button, a watch button, eleven source chips and an advanced link form.
- *Fix*: progress goes directly under the title block, above everything optional. Nothing else on this sheet is pressed daily.
- *Command*: `/impeccable layout detail sheet`

**[P1] A settings panel is sitting in the middle of a content sheet.** `titleWatchPickerHTML` renders all eleven presets plus the "Advanced: paste a direct episode link" form inline — 1,200px of configuration between the watch button and the progress control, on every open, whether or not you ever change it.
- *Fix*: collapse to one line showing the current source with an "Change" affordance; the full list opens on demand.
- *Command*: `/impeccable distill detail sheet`

**[P1] Two different sections both mean "where to watch".** "Watch this on" is your own source picker; "Watch on" is AniList's streaming links. Same words, different jobs, ~1,300px apart.
- *Fix*: one section. Your chosen source at the top of it, the services AniList knows about under it.
- *Command*: `/impeccable clarify detail sheet`

**[P1] Twenty-five episode buttons render inline.** A 100-episode show renders 100. They're in a horizontal scroller, but they're all in the DOM and all in the tab order.
- *Fix*: show a window around your current episode (say ±5) with a "see all" that expands.
- *Command*: `/impeccable distill detail sheet`

**[P2] The sheet moves under your finger.** `#dt-franchise` and `#dtRich` are placeholders filled after network calls, both above the rating and actions. Anything below them jumps when they land.
- *Fix*: reserve height for both, or render them below everything interactive.
- *Command*: `/impeccable harden detail sheet`

## Persona Red Flags

**Alex (power user)**: watches an episode, opens the sheet, scrolls two screens to press +1, closes. Every night. There is no keyboard path and no way to bump progress from the card.

**Casey (mobile, one-handed)**: five screens of thumb-scrolling to reach a rating; the first thing under the fold is a settings form for a source they set once, months ago.

**Riley (edge cases)**: a 100-episode show puts 100 buttons in this sheet; a show with no AniList id silently loses the franchise block, the rich block and the watch button, leaving a much shorter sheet with no explanation of what's missing.

## Minor Observations

- `<div class="dt-label" style="margin-top:18px"></div>` renders an empty label — a stray gap above the AI box.
- Five button vocabularies in one sheet: `.dt-watch`, `.parse-btn`, `.dact`, `.dpick`, `.src-chip`, plus `.star`.
- The rating sits at 3,050px, below the synopsis, characters and recommendations — you rate a show you just finished, so it's below three things you read before you started.

## Questions to Consider

- If the sheet opened on progress instead of the poster, what would you lose?
- Does the source picker belong on a show at all, or only in Sources with a per-title override?
- Which of these eleven sections would you miss if it were one tap away instead of already open?
