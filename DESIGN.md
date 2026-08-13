# WatchList — design system

Everything below is committed and in use in `index.html`. Read this before
proposing a palette, a type pair or a component pattern: the system exists, and
identity preservation wins over any generic default.

## Shape

**The radius scale.** 6 tags · 10 controls · 14 cards · 18 panels · 22/26 sheets
and bars · 99 pills. There were **23 distinct corner values** in this file — 12,
13, 14 and 15 all doing the same job in different places. A 1px difference is too
small to read as a decision and just large enough to make everything feel
slightly misaligned. Add *to* the scale, never *between* it.

**Elevation: three levels.**
`0 2px 8px -2px` raised · `0 8px 24px -8px` floating · `0 20px 48px -18px`
overlay. Twenty-nine near-identical shadows were doing the work of three, which
is how a UI ends up feeling assembled rather than designed — nothing is wrong,
but nothing agrees either.

## Colour

Dark ground, one accent, semantic status colours. All tokens are CSS custom
properties on `:root`, re-declared per theme.

```
--bg   #0a0a0c   --bg2 #111114   --bg3 #18181c   --bg4 #202025   --bg5 #28282e
--t1   #f0ecea   --t2  #bcb7c3   --t3  #918e99          text ramp, all ≥4.5:1
--a    #da374f   --a2  #ff6070   --ag / --glow          accent + its washes
--aFg  #ffffff                                          text ON the accent
--b1/--b2/--b3                                          accent-tinted hairlines
--bn/--bn2                                              neutral hairlines
--r 16px  --r2 12px  --elev1  --elev2
```

Two things that look redundant and are not:

- **`--aFg`** exists because bright themes (Sanji yellow, Naruto orange) need
  near-black text on the accent while dark ones need white. Never hardcode
  `#fff` on an accent surface.
- **`--bn` / `--bn2`** are neutral hairlines held out of the per-theme accent
  tint, so borders don't turn orange in the Naruto theme.

The text ramp was rebuilt once already: `--t2` was failing at 3.9:1 on `--bg5`
and `--t3` was 2.0:1 on `--bg`. Nudging one collapsed it into another, so all
three are tuned together. **Don't lighten any of them "for elegance".**

**Two panes** (≥1200px, `:root.two-pane`). A bottom sheet is right on a phone —
it comes from the thumb, it covers a screen too small for two things, it goes
with a swipe. On a desktop the same gesture throws a curtain over a page with
room to spare, and hides the list you were choosing *from* at the moment you're
comparing against it. Above 1200px the detail is a 520px column beside the list,
the list is padded clear of it rather than sliding under, and the backdrop is
suppressed so the list stays live — click another title and the panel keeps up.
Scoped to `#detailSheet` only: settings, theme and sources are genuinely modal.
The class is set in `openSheet`, **after** `closeAll()` — setting it in
`openDetail` meant `closeAll` immediately undid it.

**Edition** (`data-ed`: `standard` | `focus` | `tv` | `pro`). Where the furniture
goes, not what colour it is — navigation position, whether a hero exists at all,
type scale, chrome density. `pro` is the one that genuinely *relocates* a region:
`.nav` drops `position:fixed` for `static; order:-1`, leaving the bottom of the
screen entirely and sitting under the header (verified: header 0–48, nav 48–108,
list from 108). Three axes stack and stay independent — edition arranges the
app, layout shows a title, look sets the corners.

**Layout** (`data-view`: `grid` | `list` | `cinema`). Three genuinely different
screens from *one* set of markup — no JS branch, so the data path can't diverge
between them. A card already carries artwork, status tag, title, sub-line,
progress bar and a "N new" tag; what changes is which the eye meets first and
how many titles fit. List is the only view where two shows can be compared
without scrolling; Cinema is for choosing, the others for finding.
Constraint worth knowing: the badge, the "new" tag and the bar live *inside*
`.pcard-wrap`, so in List they cannot move to the text column — they belong to
the thumbnail. List leans into that (the tag becomes a dot, since the word is
unreadable at 56px and the colour already says it) rather than fighting it.

**UI style** (`data-ui`: `soft` | `sharp` | `round`). Radius is *not* tokenised in
this file — 163 hardcoded values against zero uses of `--r` — so a style that
rewrote everything would be a refactor pretending to be a feature. Each style
overrides only the surfaces that carry the character: cards, sheets, bars,
buttons, chips, nav. Change those and the whole thing changes; change the other
140 and nobody can tell. If radii are ever tokenised, these collapse to three
values.

**Surface tint** mixes into the *active theme's* greys rather than replacing
them, so the relationship between the five surface steps survives and a tinted
Naruto still reads as Naruto. Strength rises with the step (5% → 21%): the
deepest ground barely moves, since that's what keeps the app dark. Re-mixes on
theme change, because the values it mixes into have changed.

**Your own accent.** `accent_override` writes `--a`, `--a2`, `--ag`, `--glow`
and `--aFg` on `:root`, over whatever theme is active — so a theme's ground and
its accent are no longer a package deal. `--aFg` is **computed, never chosen**:
text sitting on the accent is unreadable rather than merely ugly when it's wrong,
so it's picked by measured contrast (near-black vs white, whichever wins). Every
preset lands ≥4.19:1, most far above.

**Card size.** `--card-min` feeds the grid's `minmax()`. The grid is `auto-fill`,
so changing one number changes the column count at every screen width with no
per-breakpoint maths.

**Themes.** Seven named (`default`, `naruto`, `sasuke`, `luffy`, `sanji`, `zoro`,
`chopper`) plus user-built ones via Harmonize. Each redefines the full token set,
so any new component must be built from tokens only — a literal colour breaks six
themes silently.

**Per-title ambient.** Each title contributes its cover's dominant colour to the
surrounding UI, clamped into a vivid dark-theme-friendly band (hue kept,
saturation and lightness constrained). Raw cover colours are washed-out pastels
or muddy greys and look wrong as UI.

## Type

`--fd` **Bricolage Grotesque** — display: titles, section heads, numbers.
`--fb` **Manrope** — body: everything else.

**Hierarchy.** A section head is the only landmark on a long scrolling page, and
at 16px/800 it sat at the same visual weight as a card title four pixels below
it — so nothing outranked anything and the page read flat. Heads are 19px with
-0.035em tracking against a count that recedes; the *contrast between them* is
what makes one read as a heading rather than a label.

Card titles moved from the body face at 11.5/600 — which is a caption — to the
display face at 13/700. A title is a name, and the artwork and its name should
feel like one object.

The hero is the one place the display face is allowed to be loud:
`clamp(24px, 5.2vw, 34px)` at -0.04em, which is the tracking floor in the
general rules and correct here because it's the only thing on the page set that
large.

Honest note for anyone auditing this: these are both sans, which is the pairing
the general rules warn about. It works here because Bricolage is a variable
display grotesque used at 700–800 with negative tracking against Manrope at
400–600 — the contrast is width and weight, not family. Splitting display from
body is what stopped the UI reading flat when everything was one family at
600–900. Don't "fix" it into serif + sans.

## Components

- **Section header** — status dot, title in the display face, count in tabular
  figures, then a hairline running out to the margin. One treatment everywhere;
  there used to be three on one screen.
- **Cover card** — artwork, one corner-tab status badge, title, then a quiet
  sub-line (`~10h · S2 out`). Extra facts join that line rather than adding rows.
- **Detail hero** — the poster is a progress medallion: a wash of the title's own
  accent rises from the bottom to how far in you are (`.dt-level`), with a bright
  waterline where it stops and none at all when finished. Its height comes from
  the same `prog()` the bar uses, so the two cannot disagree. Beneath it, one
  `.dt-strip` of uniform 34px pills, then the counter. The old "Episode progress"
  heading is gone — the poster, the pill and the counter were three things
  naming one fact.
- **Derived, not stored** — the runtime pill says what's *left*, not the total.
  "~59h to watch all 148 episodes" is only true if you've watched none of it; on
  a finished show it is simply wrong. Prefer the number the person is actually
  asking for.
- **Player** — full-screen overlay, sandboxed cross-origin iframe. Its chrome is
  the only place a countdown chip or overlay sits on artwork.
- **Sheets** — bottom sheets for everything modal. No nested cards.
- **Bottom nav** — docked to the bottom edge, full width, rounded on the two
  corners that face the content only. A detached pill left a strip of page under
  it that did nothing, and on a phone that strip is where your thumb rests.
  It keeps the pill's material: blur behind, a hairline of light along the top
  lip (that edge is the only thing telling you the panel is in front of the
  list rather than smeared over it), and the active item as a filled pill,
  because at 9px colour alone can't carry "where you are". Capped at 520px and
  centred on desktop. Takes the full safe area as its own bottom padding.
- **The measure** — `--measure: clamp(1180px, 88vw, 2600px)` on `:root` at
  ≥900px. Continuous, not stepped: a 27-inch and a 34-inch ultrawide each get a
  layout suited to them rather than the nearest preset. It lives on `:root`
  because the bottom bar is a *sibling* of `#app` and a variable defined there
  is invisible to it. The poster grid is `auto-fill`, so every extra pixel of
  measure becomes another column with no per-breakpoint counts to maintain:
  6 columns at 1024, 10 at 1920, 15 at 3440.
  Hero heights are a fraction of the **measure**, never of `vw` — tied to the
  viewport they keep their own pace and the hero drifts back to a letterbox on
  an ultrawide. As a fraction of the container it holds ~3.5:1 everywhere.
- **Desktop layout** — at ≥900px `#app` becomes the grid and carries the 1180px
  measure, so every child is centred by one rule instead of four (the fix bar
  was once left out of that list and ran full-width while everything else sat in
  a column). Search and the filters share row 2 rather than stacking: the phone's
  vertical stack cost 251px before the first poster while several hundred pixels
  of horizontal room sat unused. Now 179px.
- **Top bar** (`.topbar`) — search and the filters in one floating panel that
  mirrors the nav exactly: same material, same blur, **same left/right inset at
  every width** (verified 10px at ≤360, 14px above). That shared inset is what
  makes the two ends read as one language rather than two.
- **Flat inside a panel** — anything inside `.topbar` loses its own border and
  fill: a bordered field inside a bordered track inside a bordered panel is
  three boxes deep. The panel owns the edge; the parts are divided by a hairline.
  Notices (the "not linked" bar) stay *outside* it — a notice is not a control,
  and nesting it would put a bordered box inside a bordered box.
- **Scroll edge** — the hairline under `.ctrl-row` fades in once `pageEl` has
  moved (`:root.pg-scrolled`). Suppressed inside `.topbar`, which draws its own.

## Mobile

Phone-first; desktop is the wide case. Verified at **320 / 390 / 430**.

- Narrow-screen overrides live in a `@media(max-width:360px)` block at the **end
  of the stylesheet**. This matters: an earlier attempt put a media block
  immediately before the rule it overrode, and the base rule won on source order.
  Everything looked applied except the one declaration that mattered.
- On narrow screens **shrink chrome, never content** — gutters 18→14px, buttons
  40→35px; artwork, titles and controls keep their size.
- Anything holding a pasted URL is a wrapping `<textarea>`, not an `<input>`. A
  single line shows ~40 characters of an address and silently hides the rest.
- Long values ellipsis; label rows wrap rather than squeeze.

## Bans specific to this project

Learned from a real "it looks AI generated" round, all previously present:

- **No rainbow icon tiles.** Settings had nine pastel-tinted icons. Colour marks
  a row that needs attention; everything else is neutral.
- **No diagonal accent gradients on buttons.** Flat `--a` with `--aFg`. Ten
  buttons shared one `135deg` gradient, and its light end broke text contrast.
- **No tiny letterspaced uppercase as the house voice.** Sixteen styles rendered
  labels that way. Caps survives only on genuine badges (status tag, hero
  kicker, release kind); headings and field labels are sentence case.
- **Sparkles mean AI and nothing else.** It had drifted onto a random picker, the
  release notes and a colour tool.
- **No emoji in chrome** (see PRODUCT.md for the two intended exceptions).

## Search

Searching your own list is scored, not filtered (`searchScore`). Exact title,
prefix, substring, then the AniList English/romaji/native names, then initials
("aot"), then punctuation-stripped, then a subsequence match for typos and
doubled-letter acronyms ("jjk"), and last the genre/notes. Results sort by score
over the normal sort, and `Array.sort` is stable so equal matches keep list
order. A weak match ranking below a strong one is fine; finding nothing is not.

## Checking it

`node scripts/smoke.mjs` — boots the real app and checks it works: no errors on
load, home renders, **every inline `onclick="fn("` name resolves** (268 of them,
and an out-of-scope one is invisible until someone clicks it), core helpers are
in scope, search finds `aot` / `shingeki` / a typo, right-click opens the menu on
one card, shift-click selects a range, the detail sheet opens carrying its deck
and facts. Exits non-zero on any failure.

It exists because a feature shipped whose every path threw `ReferenceError` on
line one. The logic had been tested in isolation and was right; what was never
tested was whether the code runs inside the app. Reintroducing that exact bug
now fails five checks, so the test is known to have teeth rather than assumed to.

`node scripts/preview.mjs 390x844 out.png` — renders the REAL app headlessly at
any width, with a list seeded in. It serves a copy with `NETWORK_GATE` flipped
off, because the invite gate holds the screen before `render()` ever runs, which
is why every visual check before this one was done on a harness page borrowing
the stylesheet. Below 520px it renders inside an iframe of the true width:
Chrome clamps a headless window to 500px, so asking for 390 gives a 500px
viewport cropped to 390 — which looks exactly like the app overflowing, and has
already cost one wrong diagnosis.

`node scripts/orphan-classes.mjs index.html` — every class the markup uses,
against every class the stylesheet defines. It exists because the same failure
shipped four times: an element is moved, renamed or added, its rule is left
behind or never written, and nothing throws. The result is a control with a
border and no padding, or a picker with no layout. The only other detector is
someone opening the app and screenshotting it.

Exits non-zero on anything unstyled. Containers that genuinely carry no styling
are listed in `INTENTIONAL` inside the script, so the next one is a real signal
rather than one more line of noise.

## Motion

Reduced-motion is respected globally (one `*` rule collapses every duration).

**Ambient.** The background glow is the title's own colour (`--amb`, an
`@property` so it can transition). A soft blob of it drifts on a 42s alternating
cycle — transform only, so the gradient rasterises once and the GPU moves it;
never animate the gradient itself. Keep it around 24%: it stacks on the two
static radials already there, and the point is that the background reads as lit,
not that it's more saturated.

**Hover.** Pointer devices only (`@media (hover:hover)`) — posters lift 4px and
pick up their own accent in the shadow. There is no hover on a phone, and touch
already has the press scale. Rotation freezes transitions briefly to
stop the player tearing, and the player's frame is hidden during rotation —
except in native fullscreen, where hiding it caused iOS to exit fullscreen.
Any new motion near the player must check `nativeFullscreen()` first.

## A control that draws itself

Every option in Theme carries a small diagram of the one thing it changes, built
from divs and the live tokens, so it re-colours with the theme and cannot drift
from what it claims. Layout draws the arrangement, edition draws where the
navigation bar sits and how much fits above it, look draws a square at that
corner radius, card size draws that many cards across, artwork draws flat versus
shaded. The colour controls are not spatial, so their headings carry a sample
instead: a button and a chip for accent, a panel for tint, two badges for status,
a washed rectangle for glow.

The rule: if the choice is spatial, draw the space; if it is a colour, show the
component that takes the colour. A label plus a separate preview panel is a
worse version of both — it makes you hold the name and the result in your head
at once, and the panel is one more thing on a screen that was already long.

Six named presets used to open this screen. They went, because picking between
"Ledger" and "Ember" is a harder question than picking a colour, and it stood in
front of everything else.

## What a first-timer needs before a control

Someone opened Theme for the first time and was lost. Not because any one
control was unclear — by then each of them drew its own change — but because the
screen answered no part of what you ask before touching an unfamiliar setting:

1. **What does this change?** One line, at the top, in plain words: it changes how
   the app looks, and your list and progress are untouched. The second half
   matters more than the first; the fear is never "will this be ugly".
2. **Can I get back?** One button that returns every setting to default. Nobody
   explores a screen they can't back out of, so without it the controls may as
   well not be there.
3. **What do I do first?** The first screen holds only the four things most
   people came for — a look, the preview, an accent, a picture to take colours
   from. Everything else is behind a door labelled with what's actually behind
   it, so passing it by is a decision rather than an oversight.

Cut in the same pass, for being one more thing to read: the named presets, saved
looks, and the per-section reset that the one global reset already covers.

## Checking it, three ways

`scripts/smoke.mjs` reads the source: does every inline `onclick` name a function
that exists, is every screen still wired up. It catches the class of bug where a
rename half-lands.

`scripts/stress.mjs` runs the app. It boots with a library designed to be wrong —
missing episode counts, negative progress, a title made of quote marks, RTL text,
500 rows, no rows — opens every screen, presses every visible control, cycles
every theme, layout, edition, density and artwork mode, and asserts invariants
after each: nothing rendered the literal "undefined", nothing pushed the page
sideways, no control is smaller than a thumb. Below 520px it runs inside an
iframe, because Chrome will not give a headless window less than 500px and every
narrow-layout check written before that was quietly measuring 500.

`scripts/contrast.mjs` measures. Every text node against its real painted
background — following gradients to their stops, since a gradient reports its
background colour as transparent — in all seven themes, on all ten screens,
against WCAG AA for the size and weight actually used.

Between them they have found: a bottom bar that pushed the page off a 320px
screen, a party code row that did the same, negative episode counts producing
negative progress bars and subtracting from lifetime totals, white text on a
yellow badge at 1.84:1, and a primary button whose label sat at 2.9:1 because the
gradient's light end was never the colour the foreground was chosen against.
