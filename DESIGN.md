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
- **Player** — full-screen overlay, sandboxed cross-origin iframe. Its chrome is
  the only place a countdown chip or overlay sits on artwork.
- **Sheets** — bottom sheets for everything modal. No nested cards.
- **Bottom nav** — a floating pill, inset 14px, its own border and shadow, blur
  behind. Not a bar welded to the edge: the list scrolls *under* it. The active
  item is a filled pill inside it, because at 9px colour alone can't carry
  "where you are". Centered and capped at ~450px on desktop.
- **Scroll edge** — chrome sits above the scroller rather than over it, so the
  cue that there's content above is a hairline under `.ctrl-row`, faded in only
  once `pageEl` has actually moved (`:root.pg-scrolled`).

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
