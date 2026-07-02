# Neumeric — Design System

A fluid combination of two references, on Neumeric's own brand:
- **Drive Capital / Summer Drive** — warm cream canvas, single accent, hairline-flat surfaces,
  60px outlined pill buttons, monumental editorial serif + low-weight grotesk, huge spacing,
  metadata "label over value" captions, retro-poster film grain.
- **General Intelligence Company** — full-bleed atmospheric moment behind large serif type,
  editorial reading rhythm, inline-accent word inside a headline.
- **Accent = Neumeric forest green** (matches the `</Neumeric>` logo), not the references' blue.

## Colors
- Cream `#fff8f1` — page canvas.
- Paper `#fffdfa` — inset cards.
- Ink `#14120e` — primary text · Ink-soft `#575049` — secondary.
- Ash `#e8e0d3` — warm hairline (dividers, borders, rules).
- Forest `#1a7a37` — the accent (matches logo) · deep `#0f5a28` · ink `#0c4a22` · tint `rgba(26,122,55,.07)`.
- Grain: fixed SVG fractal-noise overlay, `mix-blend: multiply`, opacity 0.24 → warm paper tooth.

## Type
- **Display serif — Playfair Display** (500, +italic). Substitute for Editorial New. Monumental
  headlines 48–120px, line-height ~1.0, tracking -0.02em. The italic is used for the inline
  green `.accent` word inside a headline (e.g. *you*, *verify*, *pays*).
- **Body — Inter** (300/400/500/600). Substitute for Founders Grotesk. Body 18px/1.5, leads 300.
- **Labels — IBM Plex Mono** (400/500). Eyebrows, nav links, meta keys, tags — uppercase,
  letter-spaced. Ties to the code-bracket logo. Also renders the `</Neumeric>` wordmark.
- All type tracked at -0.02em.

## Scale (clamped, responsive)
display 48–120 · h1 40–77 · h2 32–62 · h3 24–38 · lead 19–24/300 · body 18 · label/mono 11–13.

## Shape & layout
- Buttons/pills: 60px radius. `.pill--out` (1.5px forest outline, fill on hover) is the default;
  `.pill--solid` (forest fill, cream text) for primary CTAs.
- Cards/sections: flat, 4px radius max, separated by 1px Ash hairlines — no drop shadows.
- Page max 1200px · reading column (`.measure`) 620px · section padding clamp(72–150px).
- Nav: full-width sticky rule bar, cream + subtle blur, hairline bottom border; collapses to a
  burger ≤860px.

## Brand assets (`assets/brand/`)
- `mark.svg` — forest phyllotaxis dot-mark, transparent (generated; used in nav, favicon, motifs).
- `mark-cream.svg` — faint tone-on-tone version for large background motifs.
- `lockup|wordmark|mark -warm|-white .png` — original supplied logo files (solid backgrounds).
- Wordmark in-page is set as live text `</Neumeric>` in IBM Plex Mono, forest green.

## Signature moves
- Monumental serif headline with ONE green italic word mid-sentence.
- Metadata row under the hero: mono uppercase key over a Playfair value.
- One full-bleed forest-green band (radial gradient + faint rotating dot-mark) per key page.
- Film grain across the whole site for the warm printed-poster feel.
- Pinned scrollytelling on Home: capture → verify → outcome, flat green line-art.

## Pages
`index.html` (Home) · `product.html` (the three pillars, deep) · `manifesto.html` (full-bleed
forest creed) · `contact.html` (early-access form + building-in-public).
