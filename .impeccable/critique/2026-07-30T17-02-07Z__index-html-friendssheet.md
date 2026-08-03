---
target: friends sheet
total_score: 29
p0_count: 0
p1_count: 1
timestamp: 2026-07-30T17-02-07Z
slug: index-html-friendssheet
---
⚠️ DEGRADED: single-context (session policy forbids spawning sub-agents unless the user asks; standing user preference is solo, token-efficient work)

Target: `index.html` — Friends sheet (`#friendsSheet` / `renderFriends` / `friendRow` / `paintPresence`)
Re-run after commit `377d6f4`. Inspected live with stub friends, one incoming request and one pending outgoing; nothing written to localStorage.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Presence is live and honest now; still no "checking" state on the first paint, no save confirmation on Your name |
| 2 | Match System / Real World | 3 | "Nothing recorded since this app started keeping track" is still release-note voice |
| 3 | User Control and Freedom | 3 | Two-tap remove that disarms itself; unsend intact |
| 4 | Consistency and Standards | 3 | Friend rows measure 69px against 63px for request/pending rows in the same list |
| 5 | Error Prevention | 3 | Input wipe fixed and verified; invite hidden without a party; remove guarded |
| 6 | Recognition Rather Than Recall | 3 | Code and "aka" now in the open row; two unnamed friends still both read "A friend" until opened |
| 7 | Flexibility and Efficiency | 3 | Rows are keyboard-operable; no Esc to collapse an open row |
| 8 | Aesthetic and Minimalist Design | 3 | Roster leads now, but the red CTA is still the loudest thing on the sheet and duplicates the row action |
| 9 | Error Recovery | 3 | Inline add-friend errors; unsend-everything sweep |
| 10 | Help and Documentation | 2 | Still nothing says "online" means their app is open |
| **Total** | | **29/40** | **Good — solid foundation, weak areas left** |

Cognitive load: 1 of 8 fails (visual hierarchy — the CTA still outweighs the roster) → low.

## Anti-Patterns Verdict

**LLM assessment**: Still not slop. The chip vocabulary is consistent now — Recommend dropped the `.on` selected-state styling, and Remove reads as danger without shouting. The presence ring is the kind of detail that reads as authored rather than generated.

**Deterministic scan** (`detect.mjs --json index.html`): 10 warnings, identical to the previous run and identical in distribution — five `layout-transition`, three false-positive `broken-image`, one `em-dash-overuse`, one `dark-glow` at line 720 (the player's paused button). None inside the friends surface. The friends work neither introduced nor cleared any detector hit.

**Visual overlays**: not attempted (no dev server; the target is a sheet inside a stateful PWA). Inspected live in a tab instead.

## Overall Impression

21 → 29. The five issues from the last run are genuinely fixed, and the input-wipe fix is verified rather than assumed. What's left is one broken promise and a handful of polish items. The broken promise is the interesting one: the sheet still claims online friends rise to the top, and they don't.

## What's Working

- **The P0 fix holds under test.** Typed text and focus both survive a presence tick. The in-place patch is also the right shape: it updates only what presence owns.
- **The presence ring.** Identity colour and availability now occupy separate channels, so a friend whose hash colour is green no longer contradicts their own label.
- **Two-tap remove that disarms itself.** No modal, no dialog, and an armed button can't sit around waiting to be hit by accident.

## Priority Issues

**[P1] Online friends never actually sort to the top.** `renderFriends()` sorts by presence, but the first paint always runs with `frOnline` empty, and `paintPresence()` deliberately doesn't reorder. Measured live with Yaseen online: DOM order came back `A friend, Yaseen, Z` — alphabetical, unchanged.
- *Why it matters*: the header says "1 online" while the online person sits in the middle of the list. The sort is advertised in the UI and in the release note, and it does not happen.
- *Fix*: reorder inside `paintPresence()` by re-appending the `.fr-row` nodes. The add-friend inputs live in a separate `<details>` subtree, so moving rows can't disturb them — the reason the tick avoided re-rendering doesn't apply to reordering.
- *Command*: `/impeccable harden friends sheet`

**[P2] The presence tick narrows what a screen reader hears.** `paintPresence()` sets `aria-label` on the row button, which overrides the button's own text. Before the first tick there's no label and a screen reader reads name + presence + rec counts; after it, it reads only "Yaseen, offline". Verified: `["A friend, offline", "Yaseen, offline", "Z, offline"]`.
- *Why it matters*: the accessible name changes shape mid-session, and the counts silently disappear for exactly the users who can't see them.
- *Fix*: drop the `aria-label` and let the visible text be the name, or set the full string including counts.
- *Command*: `/impeccable audit friends sheet`

**[P2] The red CTA still outranks the roster it sits under.** "Recommend shows to friends" is the only saturated element on the sheet, and every row now offers the same action scoped to one person.
- *Why it matters*: the loudest control duplicates a quieter one, and nothing signals that the row version pre-selects that friend.
- *Fix*: demote it to a secondary button, or drop it and let the empty state carry the first-time path.
- *Command*: `/impeccable layout friends sheet`

**[P3] Friend rows are taller than their siblings.** `.fr-row` keeps `padding: 9px 0` and the new `.fr-open` button adds its own — 69px against 63px for request and pending rows in the same column.
- *Fix*: zero the padding on `.fr-row` when it contains `.fr-open`.
- *Command*: `/impeccable polish friends sheet`

**[P3] Nothing explains what "online" means.** A first-timer reads the green ring as "this person is available", not "this person has WatchList open right now".
- *Fix*: one line under the Friends label, or in the fold.
- *Command*: `/impeccable clarify friends sheet`

## Persona Red Flags

**Casey (distracted mobile)**: fine now — codes survive interruption, and the roster is the first thing on the sheet. The red CTA is still the natural thumb target while the per-person action sits above it.

**Sam (accessibility)**: rows are focusable, `aria-expanded` flips correctly, focus rings are visible on rows and chips. Two gaps left: the `aria-label` override drops the rec counts, and presence changes in a container with no live region, so nobody is announced coming online.

**Riley (stress tester)**: the header claims "1 online" while the list order says otherwise — first thing a methodical user notices. Two unnamed friends still read "A friend" in the collapsed list; the code disambiguates only after opening a row.

## Minor Observations

- No Esc handler to collapse an open row; only another tap on the same row.
- Request and pending rows kept the old markup. Appropriate — they carry their own buttons — but they're now the only rows without a chevron.
- Mobile width was not re-verified in a real narrow viewport this run; `.sheet` is `left:0;right:0` so it's fluid by construction, but that's inference, not measurement.

## Questions to Consider

- If online friends really rose to the top, would the "N online" counter in the header still be needed?
- Does the sheet need a global Recommend button at all now that every row has one?
