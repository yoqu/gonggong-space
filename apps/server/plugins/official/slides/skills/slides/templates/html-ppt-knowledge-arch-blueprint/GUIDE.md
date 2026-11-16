# Blueprint — 奶油蓝图架构

Serious, printable architecture deck: cream paper `#F0EAE0`, a single rust accent `#B5392A`, a masked 48px blueprint grid, hard 2px black-border cards, a pipeline with one raised hero step, a rust insight callout and Playfair big numbers. Zero gradients, zero soft glow.

`example.html` is a finished example of this template — study its structure, density and finish, do not copy its copy.

Visual system, layouts and the keyboard runtime come from the MIT-licensed [`lewislulu/html-ppt-skill`](https://github.com/lewislulu/html-ppt-skill); the licence ships at `../html-ppt/LICENSE` — keep it in place when redistributing.

## Start here

- Shared rules — self-contained `design/<slug>/` folder, which assets to copy, speaker notes, presenter mode, keyboard runtime: `../html-ppt/GUIDE.md`.
- Starting point: `../html-ppt/templates/full-decks/knowledge-arch-blueprint/` — copy `index.html` + `style.css` into `design/<slug>/`, keep `<body class="tpl-knowledge-arch-blueprint">`, copy `base.css`, `fonts.css`, `animations/animations.css`, `runtime.js` from `../html-ppt/assets/` into `design/<slug>/assets/` and rewrite the `../../../assets/...` links to `./assets/...`.
- `example.html` is the same template filled with a realistic brief, with all CSS inlined; it loads `../html-ppt/assets/runtime.js`. Use it as the density/finish reference; if you start from it instead, copy `runtime.js` into `design/<slug>/assets/` and point the script at `./assets/runtime.js`.
- Swap content, not classes — the scoped `.tpl-knowledge-arch-blueprint` classes are the identity. Re-skin only through the variables at the top of `style.css`.

## Visual system

- Palette: paper `#F0EAE0`, ink `#1a1a1a` / `#555` / `#aaa`, line `#cec8be`, rust `#B5392A` (+ `rgba(181,57,42,.08)` tint). Nothing else.
- Type: Inter 900 `.kb-h1` 66px with one `.rust` phrase; `.kb-kicker` 13px 800 rust, letter-spacing 4px uppercase; Playfair Display for `.kb-big-num`; JetBrains Mono for `.kb-mono`/code.
- Structure: `.kb-grid-bg` masked grid on every slide; `.kb-card` with 2px black border; `.kb-pipeline` of `.kb-step` boxes where exactly one hero step is filled rust and raised; `.kb-insight` rust callout top-right; `.kb-section-label` with a rule; SVG dashed feedback-loop arrows.
- Every font stack keeps a Chinese fallback — sans: `"PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif`; serif: `"Songti SC","Noto Serif SC",serif`. Google Fonts links may stay. Copy is Chinese with `<html lang="zh-CN">`.

## Slide vocabulary

1. Cover — kicker, title with rust phrase, sub, `.kb-insight` decision box, 4-step pipeline with the core step raised.
2. Section divider.
3. Content — `.kb-grid-2` cards.
4. Code / config — `.kb-codebox`.
5. Diagram — SVG system/feedback-loop with dashed arrows and `.kb-legend`.
6. Stats — `.kb-big-num` figures.
7. CTA — decision + owner.
8. Thanks.

## Fits

System architecture, data-flow maps, incident retros, engineering white-papers, decision memos for engineering + leadership.

## Checklist

- [ ] Rust is the only colour; used for one phrase, the hero step and the insight box per slide.
- [ ] Exactly one raised step per pipeline.
- [ ] Diagrams are SVG with real component names and labelled arrows.
- [ ] Speaker notes live in `.notes`; no presenter-only text on slides.
- [ ] All links resolve inside `design/<slug>/`; Chinese fallback in every font stack.
