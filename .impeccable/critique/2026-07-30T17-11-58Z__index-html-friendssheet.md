---
target: friends sheet
total_score: 40
p0_count: 0
p1_count: 0
timestamp: 2026-07-30T17-11-58Z
slug: index-html-friendssheet
---
⚠️ DEGRADED: single-context (session policy forbids spawning sub-agents unless the user asks; standing user preference is solo work)

Target: `index.html` — Friends sheet (`#friendsSheet` / `renderFriends` / `friendRow` / `paintPresence` / `frFocusGuard`)
Third run, after `7494aec`, `2445cfa`, `e80b7e1`. Every claim below was checked in a live tab.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 4 | Checking… before the first probe, dims again if a probe fails, live count, saved hint, arrivals announced |
| 2 | Match System / Real World | 4 | Plain, specific copy; no release-note voice left |
| 3 | User Control and Freedom | 4 | Two-tap remove plus a 12s undo; Escape unwinds a layer at a time; rename cancellable |
| 4 | Consistency and Standards | 4 | Row heights match siblings (50px); rename left the browser prompt box |
| 5 | Error Prevention | 4 | Code problems named while typing; paste tolerated; Enter sends; destructive action guarded |
| 6 | Recognition Rather Than Recall | 4 | Unnamed friends carry the last four of their code; full code and self-name in the open row |
| 7 | Flexibility and Efficiency | 4 | Rows keyboard-operable, Enter/Escape throughout, per-row and multi-friend recommend |
| 8 | Aesthetic and Minimalist Design | 4 | Roster leads, CTA demoted, setup folded, one hint line |
| 9 | Error Recovery | 4 | Specific inline errors, code survives a failure, removal undoable |
| 10 | Help and Documentation | 4 | Contextual: the ring is explained, the code says what it's for, pending says who acts next |
| **Total** | | **40/40** | **Excellent** |

Cognitive load: 0 of 8 fail.

## Verified this run

- Before any probe: `["Checking… · …cc33", "Checking…", "Checking…"]`. After a probe with Yaseen online: `["Yaseen / Online now", "Friend / Offline · …cc33", "Z / Offline"]` — online sorted to the top, which is what the previous run proved was broken.
- Live region read `"Yaseen is online"`.
- Two-tap remove → undo bar shown → friend count back to 3 after Undo.
- Inline rename committed `"Zaid the menace"` with no `window.prompt`.
- Escape closed the open row (`frOpenCode` null).
- Friend row height 50px, matching request rows.
- Sheet open: 23 elements inert, `aria-modal="true"`, focus on Close. Sheet closed: 0 inert.

## Anti-Patterns Verdict

**LLM assessment**: not slop. Nothing in this sheet is a generated default — the undo strip, the two-tap arm, the ring-not-recolour decision and the Checking… state are all specific answers to specific problems.

**Deterministic scan**: 10 warnings, unchanged across all three runs, none inside the friends surface.

## Where a stricter reviewer could push back

Being honest about the 40, since a perfect score is a claim worth defending:

- **Heuristic 10** is contextual help only. There's no searchable documentation anywhere in the app. For a single sheet, help at each decision point is what a 4 means; for the product as a whole, that question is open.
- **Heuristic 7**: no bulk friend operations (remove several, recommend to everyone at once) and no keyboard shortcut to reach the sheet. Defensible for a mobile-first sheet with a handful of friends; a desktop-heavy tool would want them.
- **Scope**: the focus guard is on this sheet only. Every other sheet in the app still leaves focus behind it. That is the honest limit of "the friends system scored 40" — it's this surface, not the app.

## Questions to Consider

- The friends sheet now sets a bar the rest of the app doesn't meet. Which sheet is next?
- With presence live and honest, is the "N online" counter in the header still earning its place now that the order says the same thing?
