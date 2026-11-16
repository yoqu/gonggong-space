# Dark Graph — 暗底知识图谱

Deep-night gradient deck with drifting blurred orbs, an SVG force-directed graph on the cover, rainbow-shift gradient headlines, JetBrains Mono command glow and warm/blue/green glass cards — "AI-native, sci-fi, but warm".

`example.html` is a finished example of this template — study its structure, density and finish, do not copy its copy.

Visual system, layouts and the keyboard runtime come from the MIT-licensed [`lewislulu/html-ppt-skill`](https://github.com/lewislulu/html-ppt-skill); the licence ships at `../html-ppt/LICENSE` — keep it in place when redistributing.

## Start here

- Shared rules — self-contained `design/<slug>/` folder, which assets to copy, speaker notes, presenter mode, keyboard runtime: `../html-ppt/GUIDE.md`.
- Starting point: `../html-ppt/templates/full-decks/graphify-dark-graph/` — copy `index.html` + `style.css` into `design/<slug>/`, keep `<body class="tpl-graphify-dark-graph">`, copy `base.css`, `fonts.css`, `animations/animations.css`, `runtime.js` from `../html-ppt/assets/` into `design/<slug>/assets/` and rewrite the `../../../assets/...` links to `./assets/...`.
- `example.html` is the same template filled with a realistic brief, with all CSS inlined; it loads `../html-ppt/assets/runtime.js`. Use it as the density/finish reference; if you start from it instead, copy `runtime.js` into `design/<slug>/assets/` and point the script at `./assets/runtime.js`.
- Swap content, not classes — the scoped `.tpl-graphify-dark-graph` classes are the identity. Re-skin only through the variables at the top of `style.css`.

## Visual system

- Palette: `#06060c` → `#0e1020` gradient; text `#f0ece4` / `#b0a99e` / `#7a746c`; accents amber `#e8a87c`, mist-blue `#7eb8da`, mint `#7ed3a4`, rose `#d4a0b9`, lilac `#b8a4d6`, danger `#e07070`.
- Type: Inter 800 `.gd-h1`/`.gd-h2`; `.gd-rainbow` / `.gd-grad` gradient text for the title phrase; `.gd-eyebrow` wide-tracked uppercase; `.gd-cmd` / `.gd-mono` JetBrains Mono for commands.
- Atmosphere: `.gd-ambient` with `.gd-orb-1..3` (blur 110px, opacity .35, slow drift) on every slide; cover adds the SVG node-link graph (muted node colours, thin links).
- Cards: `.gd-glass` + `-warm/-blue/-green` variants, `.gd-tag`, `.gd-big` numbers, `.gd-snum` page counter top-right.
- Every font stack keeps a Chinese fallback — sans: `"PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif`; serif: `"Songti SC","Noto Serif SC",serif`. Google Fonts links may stay. Copy is Chinese with `<html lang="zh-CN">`.

## Slide vocabulary

1. Cover — node graph, eyebrow, two-line rainbow title, lede with an amber call-out sentence, mono owner line.
2. Section divider.
3. Content — `.gd-grid-3/4` glass cards.
4. Code / command — `.gd-codebox`.
5. Chart — comparison/race diagram.
6. Pipeline — stepped flow.
7. CTA.
8. Thanks.

## Fits

Dev-tool / CLI / knowledge-graph / data-viz launches, product business cases, live-demo decks with an AI-native mood.

## Checklist

- [ ] Orbs and graph stay low-contrast; text contrast ≥ 4.5:1 on the darkest region.
- [ ] Rainbow gradient only on the cover/section title; elsewhere one accent per card.
- [ ] Graph nodes/edges mean something (concepts and relations from the content) when possible.
- [ ] Speaker notes live in `.notes`; no presenter-only text on slides.
- [ ] All links resolve inside `design/<slug>/`; Chinese fallback in every font stack.
