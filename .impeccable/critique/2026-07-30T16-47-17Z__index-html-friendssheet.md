---
target: friends sheet
total_score: 21
p0_count: 1
p1_count: 4
timestamp: 2026-07-30T16-47-17Z
slug: index-html-friendssheet
---
⚠️ DEGRADED: single-context (session policy forbids spawning sub-agents unless the user asks; standing user preference is solo, token-efficient work)

Target: `index.html` — Friends sheet (`#friendsSheet` / `renderFriends` / `friendRow`)
Inspected live at https://theteknojunkie456.github.io/anime-list/ with three in-memory stub friends (no localStorage was written).

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Everyone reads "Offline" until the first presence probe returns; no "checking" state; no save confirmation on Your name |
| 2 | Match System / Real World | 3 | Plain language throughout; "You recommended" empty copy reads like a changelog |
| 3 | User Control and Freedom | 2 | Remove is a one-tap chip with no confirm and no undo |
| 4 | Consistency and Standards | 2 | `.src-chip.on` (a selected state elsewhere) used as the Recommend CTA; row is a div behaving as a button |
| 5 | Error Prevention | 1 | The 25s presence re-render wipes what you're typing in "Their friend code"; Invite to party offered when no party exists |
| 6 | Recognition Rather Than Recall | 2 | Friend code no longer shown per friend; two unnamed friends both render "A friend" |
| 7 | Flexibility and Efficiency | 2 | No keyboard path to any row action; multi-select recommend is a genuine accelerator |
| 8 | Aesthetic and Minimalist Design | 2 | Identity + friend code dominate; the friends list is the quietest thing on the sheet |
| 9 | Error Recovery | 3 | Add-friend errors are inline and specific; unsend/unsend-everything is excellent |
| 10 | Help and Documentation | 2 | Nothing explains that "online" means their app is open |
| **Total** | | **21/40** | **Acceptable — significant improvements needed** |

Cognitive load: 3 of 8 checklist items fail (single focus, visual hierarchy, working memory) → moderate.

## Anti-Patterns Verdict

**LLM assessment**: Not AI slop. The sheet reads as someone's own app: real copy, an alias system, a retraction flow nobody generates by default. The failure mode here is the product one — strangeness without purpose — in two spots: a selected-state chip style doing primary-action duty, and a presence dot that overwrites each friend's identity colour.

**Deterministic scan** (`detect.mjs --json index.html`, whole file — it can't scope to a sheet): 10 findings, all `warning`. Five `layout-transition` (`transition: width`, lines 318/327/433/853; `transition: margin` line 3648) — none in the friends surface. Three `broken-image` — false positives; those `<img>` get their `src` at runtime. One `em-dash-overuse` (28 in body copy) — partly fair, the friends empty states use two. One `dark-glow` at line 720 (`.pv-host-main.paused` green glow) — player, not friends. Net: the detector found nothing inside this sheet the review didn't.

**Visual overlays**: not attempted. No dev server, and the target is a sheet inside a stateful PWA rather than a standalone page; I inspected it directly in a live tab instead.

## Overall Impression

The bones are good and the new row is the right idea. What undermines it is that the sheet is still organised around *you* — your name, your code, your add-friend form — and the friends only start halfway down. The biggest single opportunity is inverting that: this is a roster, not a profile.

## What's Working

- **The expanding row.** Four actions, one tap, scoped to the person they apply to. It replaced a genuinely worse pattern (actions split between the row and the sheet).
- **Unsend, and unsend-everything.** A retraction path that sweeps beyond the local log is real craft; most apps don't let you take anything back.
- **Presence with no storage.** Reading the live channel means offline is instant and truthful, with nothing to expire or clean up.

## Priority Issues

**[P0] The presence tick wipes what you're typing.** `pullFriendPresence()` calls `renderFriends()`, which replaces `innerHTML` wholesale. Measured live: typed `abc123typing` into "Their friend code", ran one presence poll, field came back empty with focus lost.
- *Why it matters*: friend codes are 12–16 random characters, usually pasted then checked. A 25-second timer silently deleting them blocks the sheet's one irreversible task. This is a regression from today's presence change.
- *Fix*: don't re-render the whole body on a presence tick. Patch just the dots and sublines by code, or skip the re-render when the sheet contains a focused input with a value.
- *Command*: `/impeccable harden friends sheet`

**[P1] Remove is one tap, no confirm, no undo.** It sits as an equal-weight chip beside Rename, and `removeFriend()` writes straight to storage.
- *Why it matters*: a mis-tap costs a friendship link that can only be rebuilt by both people re-adding each other — and your standing rule is never to make anyone re-add.
- *Fix*: confirm step, or two-stage chip (tap → "Sure?"), and demote it visually away from Rename.
- *Command*: `/impeccable harden friends sheet`

**[P1] The presence dot destroys the friend's identity colour.** Online replaces `friendColor(code)` with green. In the live render, two of three offline friends had hash colours that read as green anyway — so the dot said green while the label said Offline.
- *Why it matters*: the same channel carries two meanings, and the colours collide by accident. Identity colour is used elsewhere (rec badges), so it disappears exactly for the people you interact with most.
- *Fix*: keep the identity colour in the dot; carry presence as a ring, a second micro-dot, or just the text. Never both in one swatch.
- *Command*: `/impeccable colorize friends sheet`

**[P1] Hierarchy is inverted.** Your name input and a 24px letterspaced friend code occupy the top third; "Friends · 3" starts at ~60% down, below the add-friend form.
- *Why it matters*: the code is a day-one, once-ever task. The roster is why you open the sheet. Every visit pays for setup you already did.
- *Fix*: friends and requests first; collapse "Your code / Add a friend" into one disclosure near the top or a header action.
- *Command*: `/impeccable layout friends sheet`

**[P1] Rows aren't reachable by keyboard.** `.fr-row` is a `div` with `onclick`; measured `tabIndex: -1`. No `role`, no `aria-expanded`, no focus style. `.src-chip` has no `:focus-visible` rule either.
- *Why it matters*: every per-friend action is now behind that tap, so a keyboard or switch user has lost Rename, Remove, Recommend and Invite entirely — they were reachable before today.
- *Fix*: make the row a `<button>` (or add `role="button"`, `tabindex="0"`, Enter/Space, `aria-expanded`), and give chips a visible focus ring.
- *Command*: `/impeccable audit friends sheet`

## Persona Red Flags

**Casey (distracted mobile)**: Pastes a friend code, gets interrupted, comes back to an empty field — no idea the app cleared it. The friends list sits below the fold on a phone, so the sheet opens on a form rather than on people. Row targets are fine (44px+), chips are comfortable.

**Sam (accessibility)**: Cannot reach any friend action — rows aren't focusable, chips have no focus ring, and the chevron rotation is the only cue that a row expands. Presence is announced only as a colour change plus a text label inside a container with no live region, so a screen reader never hears anyone come online.

**Riley (stress tester)**: Two friends with no self-set name both render "A friend", and the code is no longer shown per row, so they're indistinguishable — rename or remove and you can't verify which one you hit. "Invite to party" with no active party fails with a toast rather than being disabled. Presence goes stale silently the moment the sheet loses focus.

## Minor Observations

- The open row keeps its bottom border while gaining a rounded `--bg3` background — a divider line cuts under the chip strip.
- "Recommend" uses `.src-chip.on`, which everywhere else in the app means *currently selected*. Two vocabularies, one style.
- Two entry points to recommending (row chip, big red CTA). They differ meaningfully — one preselects the friend — but nothing says so.
- Five uppercase 10px tracked labels in one sheet. It's the app's established system, not a slop import, but it flattens this sheet's hierarchy specifically.
- "Nothing recorded since this app started keeping track" is release-note voice in a user-facing empty state.
- Nothing tells a first-timer that "online" depends on the other person having WatchList open.

## Questions to Consider

- If the roster came first and setup collapsed into one line, would the sheet need sections at all?
- Presence is currently a dot. What if it were the sort order and nothing else — the people who are around simply rise?
- Should "Remove" even live next to "Rename", or does it belong behind the same kind of confirm the unsend sweep already has?
