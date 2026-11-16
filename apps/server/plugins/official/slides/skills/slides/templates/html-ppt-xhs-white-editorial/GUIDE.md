# White Editorial — 白底杂志风

Pure-white magazine layout for dense Chinese content: a 10-colour rainbow top bar, 80–110px black display headlines with a purple→blue→green→orange→pink gradient phrase, black `.focus` pills on key words, macaron soft cards and a hero quote box.

`example.html` is a finished example of this template — study its structure, density and finish, do not copy its copy.

Visual system, layouts and the keyboard runtime come from the MIT-licensed [`lewislulu/html-ppt-skill`](https://github.com/lewislulu/html-ppt-skill); the licence ships at `../html-ppt/LICENSE` — keep it in place when redistributing.

## Start here

- Shared rules — self-contained `design/<slug>/` folder, which assets to copy, speaker notes, presenter mode, keyboard runtime: `../html-ppt/GUIDE.md`.
- Starting point: `../html-ppt/templates/full-decks/xhs-white-editorial/` — copy `index.html` + `style.css` into `design/<slug>/`, keep `<body class="tpl-xhs-white-editorial">`, copy `base.css`, `fonts.css`, `animations/animations.css`, `runtime.js` from `../html-ppt/assets/` into `design/<slug>/assets/` and rewrite the `../../../assets/...` links to `./assets/...`.
- `example.html` is the same template filled with a realistic brief, with all CSS inlined; it loads `../html-ppt/assets/runtime.js`. Use it as the density/finish reference; if you start from it instead, copy `runtime.js` into `design/<slug>/assets/` and point the script at `./assets/runtime.js`.
- Swap content, not classes — the scoped `.tpl-xhs-white-editorial` classes are the identity. Re-skin only through the variables at the top of `style.css`.

## Visual system

- Palette: white `#ffffff`, ink `#111318` / `#475467`, muted `#98a2b3`, line `#eaecf3`; accents purple `#7b61ff`, pink `#ff5fa2`, blue `#4e8cff`, green `#17b26a`, orange `#ff9d42`, each with a soft tint (`--xw-soft-*`) for cards.
- Type: Inter + Noto Sans SC at weight 800–900, `.xw-title` 84px (−2px tracking), `.xw-title-md` 60px; JetBrains Mono for code.
- Emphasis toolkit: `.xw-grad` gradient phrase, `.xw-focus` black pill (and `-blue/-green/-orange/-pink` tinted variants) for 2–4 key words per slide, `.xw-hero` quote card, `.xw-big-stat`.
- Chrome: `.xw-topbar` with `.xw-tag` (rainbow dot + topic) and `.xw-page` "01 / 08"; `.xw-footer` with style tags.
- Every font stack keeps a Chinese fallback — sans: `"PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif`; serif: `"Songti SC","Noto Serif SC",serif`. Google Fonts links may stay. Copy is Chinese with `<html lang="zh-CN">`.

## Slide vocabulary

1. Cover — tag + page, kicker question, two-line title with gradient phrase, lede with focus pills, `.xw-hero` thesis box.
2. Section divider — big number + title.
3. Content — `.xw-grid-2/3` of `.xw-card` in soft tints, each with `.xw-label`.
4. Steps — `.xw-steps` numbered flow.
5. Code / template — `.xw-codebox`.
6. Chart — SVG bar chart with one highlighted bar.
7. CTA — checklist / what to do next.
8. Thanks.

## Fits

Dual-purpose 小红书图文 + horizontal deck; dense text with strong emphasis; Chinese-first audiences — 晋升材料、方法论、干货分享.

## Checklist

- [ ] Max one gradient phrase and 2–4 focus pills per slide — emphasis must stay scarce.
- [ ] Soft-tint cards rotate colours meaningfully (one colour per category), not randomly.
- [ ] Headline lines break on meaning; no orphan single character lines.
- [ ] Speaker notes live in `.notes`; no presenter-only text on slides.
- [ ] All links resolve inside `design/<slug>/`; Chinese fallback in every font stack.
