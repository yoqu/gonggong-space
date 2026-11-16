# Violet Night Gradient — 暗紫渐变教程

Center-aligned developer-tutorial deck on code-host dark `#0d1117`: purple + blue radial ambient over a masked 60px grid, purple pill badges, a three-stop purple→blue→green gradient phrase, code panels and a purple left-border highlight block — changelog-blog feel.

`example.html` is a finished example of this template — study its structure, density and finish, do not copy its copy.

Visual system, layouts and the keyboard runtime come from the MIT-licensed [`lewislulu/html-ppt-skill`](https://github.com/lewislulu/html-ppt-skill); the licence ships at `../html-ppt/LICENSE` — keep it in place when redistributing.

## Start here

- Shared rules — self-contained `design/<slug>/` folder, which assets to copy, speaker notes, presenter mode, keyboard runtime: `../html-ppt/GUIDE.md`.
- Starting point: `../html-ppt/templates/full-decks/obsidian-claude-gradient/` — copy `index.html` + `style.css` into `design/<slug>/`, keep `<body class="tpl-obsidian-claude-gradient">`, copy `base.css`, `fonts.css`, `animations/animations.css`, `runtime.js` from `../html-ppt/assets/` into `design/<slug>/assets/` and rewrite the `../../../assets/...` links to `./assets/...`.
- `example.html` is the same template filled with a realistic brief, with all CSS inlined; it loads `../html-ppt/assets/runtime.js`. Use it as the density/finish reference; if you start from it instead, copy `runtime.js` into `design/<slug>/assets/` and point the script at `./assets/runtime.js`.
- Swap content, not classes — the scoped `.tpl-obsidian-claude-gradient` classes are the identity. Re-skin only through the variables at the top of `style.css`.

## Visual system

- Palette: bg `#0d1117`, surfaces `#161b22` / `#21262d`, border `#30363d`; text `#e6edf3` / `#8b949e` / `#484f58`; violet `#7c3aed` / `#a855f7` / `#c084fc`; supporting green `#3fb950`, blue `#58a6ff`, orange `#f97316`, yellow `#fbbf24`, red `#f87171`. Gradient phrase `#a855f7 → #60a5fa → #34d399`.
- Type: Inter + Noto Sans SC 800 headlines, centred; JetBrains Mono in code; Georgia (add `"Songti SC","Noto Serif SC"`) for `.oc-quote`.
- Layout: every slide flex-centred (`text-align:center`); `.oc-cbg` ambient + `.oc-cgrid` grid; `.oc-snum` page counter top-right; `.oc-badge`/`.oc-pill`/`.oc-tag` pills; `.oc-hl` purple left-border highlight; `.oc-code` panel with token colours.
- Every font stack keeps a Chinese fallback — sans: `"PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif`; serif: `"Songti SC","Noto Serif SC",serif`. Google Fonts links may stay. Copy is Chinese with `<html lang="zh-CN">`.

## Slide vocabulary

1. Cover — purple badge, 2–3 line centred title with gradient phrase, sub, 3 audience pills.
2. Section.
3. Content — compare cards (`.oc-grid-2`).
4. Steps — `.oc-steps` numbered setup.
5. Code — config/snippet in `.oc-code`.
6. Stats — `.oc-big` numbers.
7. Quote / CTA — `.oc-quote` + highlight.
8. Thanks.

## Fits

Developer workflow / agent / tooling tutorials, AI adoption briefs, setup guides heavy on config and steps.

## Checklist

- [ ] Centred layout kept; long paragraphs avoided (centred text > 2 lines becomes hard to read).
- [ ] Gradient on one phrase per slide; badges/pills ≤ 3 per slide.
- [ ] Emoji in pills only if the content truly needs them — prefer plain text.
- [ ] Speaker notes live in `.notes`; no presenter-only text on slides.
- [ ] All links resolve inside `design/<slug>/`; Chinese fallback in every font stack.
