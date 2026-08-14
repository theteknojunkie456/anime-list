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

**What went, and why.** Edition (`data-ed`) and Layout (`data-view`) were both
removed. Between them they offered twelve arrangements of the same list from one
set of markup, which was a satisfying thing to build and a third and fourth
heading on a screen the owner called too much four times running. Card size
covers the part of that choice anyone reached for: how many titles fit across.
The lesson is not that configurability is bad — it is that every axis is a
question the reader has to answer before they can use the thing, and a question
nobody asked is a cost with no matching benefit.

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
from what it claims. Look draws a square at that corner radius, card size draws that many cards across,
artwork draws flat versus shaded. The colour controls are not spatial, so their headings carry a sample
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
every theme, density, corner style and artwork mode, and asserts invariants
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

## Edit it where you can see it

Colour was chosen inside a sheet that covered the thing being coloured. That is
the whole reason four separate attempts at this screen kept reaching for a
preview: a fake card, a fake chip, a fake button, standing in for the real ones
four inches behind the sheet. Every one of those attempts was answering a
question the layout had created.

So the controls left the sheet. Press and hold the WatchList logo and a short
dock rises at the bottom; above it is your own library, at full size, in its own
scroll, changing as you touch a swatch. Nothing is a stand-in because nothing
needs to be, and the dock is deliberately short — every pixel it takes is a pixel
of the thing you came to look at.

Theme is back to what the button says: seven looks, one door through to colour,
one way back to default.

The gesture had to be taken from admin, which had been sitting on press-and-hold
of the logo — the most discoverable press in the app, doing nothing at all for
anybody except the one person with a token. Admin is a double tap on a device
that already holds the token; the five-tap unlock stays for a device that has
never been admin.

## Why it was slow

`scripts/perf.mjs` counts, against a 200-title library: how many nodes an
interaction replaces, how many elements carry per-frame effects, and what the
scroll path touches. Wall-clock is useless in a headless run — virtual time
advances in jumps, so `performance.now()` deltas come back 0ms or 1000ms with no
relation to real work — so it measures work, not time.

Three findings, all structural:

**395 elements with `backdrop-filter`.** Every status badge and every episode
chip blurred the artwork behind it. Each one is a compositing layer the phone
re-blurs every frame, and at 319 cards that is the whole scroll budget spent on
an effect nobody can see behind a 20px label. Now: two, both large deliberate
surfaces. The badges took a slightly more opaque background instead.

**Interactions went through a full rebuild.** Changing card size or accent
re-rendered every card to set one custom property, when the browser restyles
from a custom property for free. Selecting a title re-rendered the list to add a
class. Measured in nodes replaced: card size 22 → 0, select 22 → 2.

**The scroll handler forced layout and style on every frame.** It measured every
band with `getBoundingClientRect` and read `--a` back through `getComputedStyle`,
which makes the engine resolve style before it can answer. The bands are cached
until the page is rebuilt, the accent is remembered until a theme changes, and
the scan runs a few times a second rather than sixty — the colour crossfades over
a second regardless.

## Two parsers, one string

An error log said `SyntaxError: Unexpected identifier 's'` at `index.html:1`,
twice, with no stack. It was this, in the discover list:

    onclick="addPopular(1,'JoJo's Bizarre Adventure')"

A value going into a single-quoted argument inside an HTML attribute has to
survive the HTML parser reading the attribute and then the JS parser reading the
call. `escH` handles the first and deliberately leaves the apostrophe alone, so
the second one broke — on one of the most-added shows there is. Nothing caught
it because it only fires for a title that happens to contain an apostrophe, and
the placeholder data never had one.

`jsq()` escapes for both. The codebase had already fixed this by hand in four
places (`openExternal`, `playYouTube`, `renameOpen`) which is the tell that it
needed a helper rather than vigilance. `smoke.mjs` now reads the source and
fails on any interpolation into a single-quoted argument that does not go
through an escaper, with an explicit allowlist for values that cannot contain a
quote by construction — ids the app mints, friend codes, a hostname, hexes from
a hardcoded array.

## The ramp and the scale

Asked to make the whole UI cleaner without changing its look, the useful move was
to measure what was inconsistent rather than restyle what was ugly.
`scripts/audit-visual.mjs` renders the app and tallies every computed size,
weight, radius, border and shadow on screen, with the class that owns each.

The shapes were already disciplined — one border colour doing 49 of 60 borders,
four shadows, radii clustered on 14px. The type was not: **fifteen** distinct
sizes, fourteen of them between 8.5px and 15px. 11 / 11.5 / 12 / 12.5 cannot read
as four levels of hierarchy; they read as things that failed to line up. That is
what "eyesore" meant, and no amount of restyling individual components fixes it.

Six steps now — **10 · 12 · 13 · 15 · 17 · 21** — plus display sizes above. Every
value moved at most 1px, so nothing reflowed. Weights went 6 → 3 (600 · 700 ·
800; the wordmark keeps 400 because that contrast is the logo). Corners went to
**2 · 6 · 10 · 14 · 18 · 26 · 99**, snapping strays like 999px, 8px, 4px and a
22px that sat between 18 and 26 making three large radii read as one wrong one.

`smoke.mjs` fails on any size or radius off the scale, so this holds.

## Eyebrows

The uppercase tracked micro-label above a card or a section is currently the most
saturated generated-design tell there is — it shows up on most AI-made pages
regardless of what they are for. WatchList had fourteen classes of it.

The distinction that matters is not caps versus sentence case, it is **eyebrow
versus badge**. A badge sits ON content and names its state: a status tag on a
poster, an episode chip on a still. At 10px over artwork, capitals genuinely read
better, and there is one per object rather than one per section. Those stayed.

An eyebrow introduces the thing below it — CONTINUE WATCHING over a card, ACCENT
over a row of swatches. It is decoration wearing the costume of structure, and
having one above everything is grammar rather than voice. Those became ordinary
lines of text: sentence case, no tracking, one size up, in the muted ink. Zero
remain on the home screen; `audit-visual.mjs` counts them so that stays true.

For the record, a claim made and then withdrawn during this work: the app was
said to have "no typographic personality, one face doing every job". It does not
— Bricolage Grotesque carries display across 90 rules against Manrope for body,
which is a real contrast pairing. Measuring before asserting would have caught
that.

## Titles are the show's, not the app's

An earlier pass re-cased all-capital titles so a list would look tidier. That was
wrong: ONE PIECE is how Shueisha and Toei write it. Removed. What is fixed
instead is the user's own typing — type "one piece", match the real show, and the
app takes the show's capitalisation silently, because that is the same title
rather than a rename.

## How the copy gave it away

Asked what still made the app read as machine-made, the answer was not visual.
It was one sentence shape, used 65 times:

    Party created — share the code
    Couldn't reach AniList — will retry
    Link ready — send it to anyone

Statement, em dash, explanation. One string in seven. It is the most
recognisable machine-written construction in English right now, it appears
nowhere near that often in writing by people, and no amount of visual work
covers it. A person writing a toast writes *Party created. Share the code.*

All 65 are plain sentences now, and `smoke.mjs` fails on any em dash in a string
the user reads. Comments and commit messages are exempt, which is the honest
place for the habit to live.

The same instinct produced the second tell: **over-explanation**. Every control
carried a gloss — "Accent · buttons, bars, highlights" — written when this lived
in a sheet that covered the thing it changed. Over the live list, telling someone
the accent colours buttons while they watch it colour buttons is noise. The
glosses went; the labels are one word each.

## A wall, not a grid of frames

The audit said it plainly: **49 visible elements wearing the same 1px hairline**.
A poster, a warning row, a button and a section all carried the identical edge,
so nothing was more important than anything else and the screen read as a pile of
boxes. That sameness is what "looks kinda off" meant, and it is the one thing no
amount of colour or type work reaches.

The rule now: **a border means you can operate it.** Inputs, chips, segmented
controls, buttons — those have edges, because an edge says "this is a target".

Artwork is not operated, it is looked at. Posters, the billboard, the rails and
the resume card lost their outlines entirely and are lifted off the page by
shadow instead. A cover already has an edge: its own picture. Down from 49 to 6.

Two more, same instinct:

**Headings lead.** They were 17px with a hairline trailing off to the right, which
is the section divider every template ships — it says "this is a heading" a
second time in a weaker voice. 21px in the display face at tight tracking, no
rule, count set as a figure beside the name.

**The quick pick stopped advertising.** A question in body text next to a bordered
pill is the shape of a banner, and it sat between two sections of the user's own
list. One quiet line now, the action carried by the accent rather than a box.

Placeholders were changed with the things they stand in for — `.pcard-ph` still
had the frame after `.pcard-img` lost it, which is invisible in normal use and
obvious the moment artwork fails to load.

## Retro, and what a look has to do

Two attempts, and the first one was wrong in an instructive way.

**Squaring the corners is a signifier, not a design.** `border-radius: 0` says
"not rounded" and stops. The language this look actually borrows from is the game
HUD, and its move is the **notch**: a corner cut off at 45°, as if the panel were
milled rather than drawn. That is ownable in a way an absence never is.

**Neon needs darkness to be neon.** The first ground was a dusty violet
(`#150a24`) and everything on it read as washed. Near-black (`#05030b`) with two
neons arguing — magenta and cyan, sign and rain — is the whole effect. The greys
are pulled toward cyan so even the quiet text belongs to the same night.

**Restraint is the difference between a look and a costume.** The first pass gave
every cover a two-colour offset shadow and misregistered every heading. Both are
tricks, and applied everywhere a trick reads as a filter someone switched on. Now
one cyan hairline lights each cover, one magenta bloom sits under it, and the
chromatic aberration appears exactly once, on the wordmark.

The whole thing hangs off `[data-theme=retro]`, so it stays one look you turn on
rather than a new axis to choose along — the distinction that got layouts and
editions deleted.

## Three devices

Sync was last-writer-wins over the whole list: pull the cloud copy, and if it is
newer, `anime = migrate(arr)`. One device, that is correct and simple. A phone, a
tablet and a desktop all in use, it loses work every day — mark an episode on the
phone, mark a different one on the desktop, and whichever syncs second replaces
the other outright. Neither existing guard fires, because both lists are the same
length and neither is empty.

Every item already carried `upd`, a millisecond stamp written on every edit, so
the merge is per item: union by id, newest `upd` wins for anything present in
both. Nothing is discarded for arriving second.

**Deletion is the hard half.** A union resurrects whatever you removed the moment
another device syncs, so a delete has to leave something behind. `wl_tombs` maps
id → when, rides to the cloud inside the extras bundle (which already syncs
arbitrary keys), and merges by max rather than being overwritten — a device that
has deleted nothing must not erase what the others deleted. A tombstone beats any
edit older than itself and loses to any edit newer, which is what makes *delete
on the phone, re-add on the desktop* behave the way anyone would expect. Pruned
at 90 days.

Every removal path has to record one, or that removal comes back: manual delete,
the AI's remove command, and the adult-content purge.

`scripts/sync-merge-test.mjs` runs three simulated devices against the real
functions — concurrent edits, a delete, an add, a stale device syncing last, and
a re-add after a deletion — and asserts nothing is lost. This is the one part of
the app where being wrong costs somebody their list, so it is proved rather than
reasoned about.
