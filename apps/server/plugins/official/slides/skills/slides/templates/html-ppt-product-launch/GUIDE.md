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

## Checklist

- [ ] Each feature slide sells one benefit with proof (number, quote, screenshot), not a feature list.
- [ ] Gradient orb only on the cover (and optionally the CTA).
- [ ] Pricing tiers are consistent (same units, same period); exactly one is highlighted.
- [ ] Speaker notes live in `.notes`; no presenter-only text on slides.
- [ ] All links resolve inside `design/<slug>/`; Chinese fallback in every font stack.
