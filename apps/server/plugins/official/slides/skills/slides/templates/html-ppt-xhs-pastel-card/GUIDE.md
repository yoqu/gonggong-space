# Pastel Card — 柔和马卡龙

Soft, handmade magazine feel: cream background with three blurred pastel blobs, Playfair / Noto Serif SC display headlines with one italic rose word, full-colour 28px-rounded macaron cards, italic serif numerals and an SVG donut.

`example.html` is a finished example of this template — study its structure, density and finish, do not copy its copy.

Visual system, layouts and the keyboard runtime come from the MIT-licensed [`lewislulu/html-ppt-skill`](https://github.com/lewislulu/html-ppt-skill); the licence ships at `../html-ppt/LICENSE` — keep it in place when redistributing.

## Start here

- Shared rules — self-contained `design/<slug>/` folder, which assets to copy, speaker notes, presenter mode, keyboard runtime: `../html-ppt/GUIDE.md`.
- Starting point: `../html-ppt/templates/full-decks/xhs-pastel-card/` — copy `index.html` + `style.css` into `design/<slug>/`, keep `<body class="tpl-xhs-pastel-card">`, copy `base.css`, `fonts.css`, `animations/animations.css`, `runtime.js` from `../html-ppt/assets/` into `design/<slug>/assets/` and rewrite the `../../../assets/...` links to `./assets/...`.
- `example.html` is the same template filled with a realistic brief, with all CSS inlined; it loads `../html-ppt/assets/runtime.js`. Use it as the density/finish reference; if you start from it instead, copy `runtime.js` into `design/<slug>/assets/` and point the script at `./assets/runtime.js`.
- Swap content, not classes — the scoped `.tpl-xhs-pastel-card` classes are the identity. Re-skin only through the variables at the top of `style.css`.

## Visual system

- Palette: cream `#fef8f1`, ink `#2a2340` / `#5b5470`, muted `#9089a8`; macaron pairs (light / deep): peach `#ffd8c2`/`#f48b5c`, mint `#c8ecd8`/`#2e9d70`, sky `#c9dcfb`/`#4e7ed6`, lilac `#ddd0f5`/`#7b5dc4`, lemon `#fdf0b2`/`#c8910a`, rose `#fcd0dd`/`#c94673`.
- Type: display `'Playfair Display','Noto Serif SC'` (add `"Songti SC"` before `Noto Serif SC`), body Inter/Noto Sans SC, mono for code. Italic serif for numerals `01–04` and the one emphasised word.
- Shapes: `.xp-blob` b1–b3 soft radial blobs behind content (z-index 0), 28px rounded `.xp-card` filled with a macaron light colour, `.xp-chip` pill + `.xp-page` in the topbar, thin coloured `.xp-divider`.
- Every font stack keeps a Chinese fallback — sans: `"PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif`; serif: `"Songti SC","Noto Serif SC",serif`. Google Fonts links may stay. Copy is Chinese with `<html lang="zh-CN">`.

## Slide vocabulary

1. Cover — chip + page, kicker, 3–4 line serif headline with one italic rose word, divider, lede.
2. Section — italic numeral + title.
3. Content — `.xp-grid-2` of four macaron cards.
4. Quote — `.xp-quote` large serif.
5. Prompt / code — `.xp-codebox`.
6. Chart — SVG donut (e.g. time split).
7. CTA — gentle invitation.
8. Thanks.

## Fits

Lifestyle, personal growth, slow living, personal manifesto or story talks, community sharing — "magazine, handmade, not-so-techy".

## Checklist

- [ ] Blobs stay behind content and never reduce text contrast.
- [ ] Each card uses one macaron pair (light fill, deep accent text); no more than four colours per slide.
- [ ] Only one italic emphasised word per headline.
- [ ] Speaker notes live in `.notes`; no presenter-only text on slides.
- [ ] All links resolve inside `design/<slug>/`; Chinese fallback in every font stack.
