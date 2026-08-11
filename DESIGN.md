# WatchList — design system

Everything below is committed and in use in `index.html`. Read this before
proposing a palette, a type pair or a component pattern: the system exists, and
identity preservation wins over any generic default.

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
