# Product Launch — dark hero, warm gradient

Keynote-style announcement deck: dark hero slides alternating with light content slides, a warm orange→peach gradient orb, feature cards, pricing tiers and a closing CTA.

`example.html` is a finished example of this template — study its structure, density and finish, do not copy its copy.

Visual system, layouts and the keyboard runtime come from the MIT-licensed [`lewislulu/html-ppt-skill`](https://github.com/lewislulu/html-ppt-skill); the licence ships at `../html-ppt/LICENSE` — keep it in place when redistributing.

## Start here

- Shared rules — self-contained `design/<slug>/` folder, which assets to copy, speaker notes, presenter mode, keyboard runtime: `../html-ppt/GUIDE.md`.
- Starting point: `../html-ppt/templates/full-decks/product-launch/` — copy `index.html` + `style.css` into `design/<slug>/`, keep `<body class="tpl-product-launch">`, copy `base.css`, `fonts.css`, `animations/animations.css`, `runtime.js` from `../html-ppt/assets/` into `design/<slug>/assets/` and rewrite the `../../../assets/...` links to `./assets/...`.
- `example.html` is the same template filled with a realistic brief, with all CSS inlined; it loads `../html-ppt/assets/runtime.js`. Use it as the density/finish reference; if you start from it instead, copy `runtime.js` into `design/<slug>/assets/` and point the script at `./assets/runtime.js`.
- Swap content, not classes — the scoped `.tpl-product-launch` classes are the identity. Re-skin only through the variables at the top of `style.css`.

## Visual system

- Palette: light slides `#ffffff` / `#f5f5f7`, ink `#0a0a12`; `.slide.dark` uses `#0a0a12` with translucent glass cards; accents `#ff5a36` → `#ff8c5a` → `#ffb36b` as `--grad`.
- Type: Inter 900 `.h1` 96px (tracking −.045em), `.h2` 64px; Playfair only for testimonial quotes.
- Signature: `.hero-shot` — a large blurred gradient circle bleeding off the right edge of the cover; 22–32px radii; generous shadows.
- Rhythm: dark cover → light feature slides → dark "how it works"/CTA. Never two dark slides that say the same thing.
- Every font stack keeps a Chinese fallback — sans: `"PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif`; serif: `"Songti SC","Noto Serif SC",serif`. Google Fonts links may stay. Copy is Chinese with `<html lang="zh-CN">`.

## Slide vocabulary

1. Cover / hero (`.dark`) — kicker, three-line `.h1` with gradient last word, lede, `.hero-shot`.
2. Introducing — product name + one-line promise.
3–5. Feature slides — one feature each, `.feature-card` with a concrete benefit and number.
6. How it works — `.step` sequence (3–4 steps).
7. Pricing — `.price-card` tiers, one highlighted.
8. Testimonial + CTA — `.testimonial` quote and `.cta-btn`.

## Fits

Product launches, feature reveals, rollout proposals, launch keynotes, internal "we are shipping X" announcements.

## Linked edits

- The cover's `<span class="slide-number" data-current="1" data-total="8">` is rewritten by `runtime.js` (only the first `.slide-number` is), so no hand edit when slides change; a `.slide-number` added elsewhere would stay frozen.
- The product name on the cover device is CSS, not markup: `.hero-shot::before{content:"OpenDesign"}` (the starter `style.css` says `"Halo v2"`) — change it with the cover headline and `.brand`.
- `--grad` repeats `--accent #ff5a36` / `--accent-2` / `--accent-3`, and the accent is restated as `rgba(255,90,54,…)` in the `.price-card.pro` and `.cta-btn` shadows — re-brand them together.
- The near-black `#0a0a12` is literal in `.slide.dark` and `.price-card.pro` (background and border), separate from `--ink` / `--text-1` — change all of them together.
- Dark/light rhythm: `.slide.dark` is on Cover, Fit and Ship; when adding slides keep dark ones apart, and any new component used on a dark slide needs its own `.slide.dark …` colour rule (only `.h1/.h2/h3/h4/.lede/.dim/.card/.kicker` are overridden).
- `.step .n` numbers (1, 2, 3) are hand-typed — renumber when steps change.
- If you copy and edit `runtime.js`, keep its `window.deck = { slides, get index(), go }` line — the toolkit drives the deck through it.

## Print

Supported. Browser print (Cmd/Ctrl+P → Save as PDF) gives one 1920×1080 page per slide; deck-toolkit.js lays the slides out for print, so keep it loaded. The cover's `.slide-number` shows whichever slide is current, so press Home before printing.

## Checklist

- [ ] Each feature slide sells one benefit with proof (number, quote, screenshot), not a feature list.
- [ ] Gradient orb only on the cover (and optionally the CTA).
- [ ] Pricing tiers are consistent (same units, same period); exactly one is highlighted.
- [ ] Speaker notes live in `.notes`; no presenter-only text on slides.
- [ ] All links resolve inside `design/<slug>/`; Chinese fallback in every font stack.
