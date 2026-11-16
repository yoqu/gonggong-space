# HTML PPT Studio (html-ppt)

A token-based static HTML deck system: one theme file = one look, one layout file = one page type, one animation class = one entry effect. 36 themes, 31 single-page layouts, 15 full-deck starters, 27 CSS + 20 canvas FX animations, and a keyboard runtime with a presenter window.

Adapted from the MIT-licensed [`lewislulu/html-ppt-skill`](https://github.com/lewislulu/html-ppt-skill) — MIT. Copyright (c) 2026 lewis &lt;sudolewis@gmail.com&gt;. `./LICENSE` must stay next to these files.

There is no single `example.html` here: the finished examples are the full decks under `./templates/full-decks/<name>/index.html` — study their structure, density and finish, do not copy their copy.

## What lives here

```
html-ppt/
├── LICENSE
├── references/            catalogs, load when needed
│   ├── themes.md          36 themes + when to use each
│   ├── layouts.md         31 single-page layouts
│   ├── animations.md      27 CSS + 20 canvas FX animations
│   ├── full-decks.md      15 full-deck starters (visual traits, when to use)
│   ├── presenter-mode.md  presenter mode + 逐字稿 writing rules
│   └── authoring-guide.md outline → deck walkthrough
├── assets/
│   ├── base.css           tokens + primitives (never edit per deck)
│   ├── fonts.css          webfont imports (Inter, Noto Sans/Serif SC, JetBrains Mono, Playfair …)
│   ├── runtime.js         keyboard nav, overview, theme cycle, presenter window
│   ├── themes/*.css       36 token overrides
│   └── animations/        animations.css, fx-runtime.js, fx/*.js
└── templates/
    ├── deck.html              minimal 6-slide starter
    ├── full-decks-index.html  gallery of the full decks (iframes)
    ├── full-decks/<name>/     index.html + scoped style.css (.tpl-<name>)
    └── single-page/*.html     31 layouts with demo data
```

## Decide first (infer, do not wait)

Resolve these from the brief and plan internally; ask only if a missing answer would change the deck materially (the shared SKILL.md question round covers this).

1. **Content & audience** — topic, slide count, who watches (engineers / execs / 小红书读者 / 学生 / investors).
2. **Theme** — pick from `./references/themes.md`. Shortlist by tone:
   - Business / investor → `pitch-deck-vc`, `corporate-clean`, `swiss-grid`
   - Tech sharing → `tokyo-night`, `dracula`, `catppuccin-mocha`, `terminal-green`, `blueprint`
   - 小红书图文 → `xiaohongshu-white`, `soft-pastel`, `rainbow-gradient`, `magazine-bold`
   - Academic / report → `academic-paper`, `editorial-serif`, `minimal-white`
   - Edgy / launch → `cyberpunk-neon`, `vaporwave`, `y2k-chrome`, `neo-brutalism`
3. **Starting point** — the closest `./templates/full-decks/<name>/` (see `./references/full-decks.md`), or `./templates/deck.html` + single-page layouts. Pick confidently when the brief makes it obvious (产品发布会 → `product-launch`, 周报 → `weekly-report`, 技术分享 → `tech-sharing`, 演讲/逐字稿 → `presenter-mode-reveal`).

## Building a deck in the workspace

The published folder must be self-contained — nothing may point back into the plugin.

1. Copy the starter `index.html` (and its `style.css` for full decks) into `design/<slug>/`.
2. Copy the assets it needs into `design/<slug>/assets/`, keeping the sub-paths:
   - always: `base.css`, `fonts.css`, `runtime.js`
   - the chosen theme(s): `themes/<name>.css` — every theme listed in `data-themes` if you keep T-cycling
   - if used: `animations/animations.css`; for canvas FX also `animations/fx-runtime.js` and `animations/fx/` (copy `_util.js` plus the effects you use)
3. Rewrite every `../assets/...` / `../../../assets/...` link to `./assets/...` (including `<link id="theme-link" href="./assets/themes/<name>.css">`; T-cycling derives the theme folder from it). If the starter sets `data-theme-base`, change it to `./assets/themes/` as well.
4. `<html lang="zh-CN">`. Keep `<script src="./assets/runtime.js"></script>` at the end of `<body>`.

## Authoring rules

- **Always start from a template.** Copy the closest `<section class="slide">…</section>` out of `./templates/single-page/` or a full deck, then replace content. Don't invent new layout types when composing existing ones works. Don't repeat the same layout twice in a row.
- **Tokens, not literal colors.** Colors, radii, shadows come from CSS variables in `base.css` overridden by the theme (`color: var(--text-1)`, not `#111`). Full decks carry their palette as scoped variables in `style.css` — re-skin by editing those variables.
- **Keep structural classes.** `.tpl-<name>` on `<body>` and the template's classes are what give it its identity; swap content, not classes.
- **Chrome slots** — `.deck-header`, `.deck-footer`, `.slide-number`, the progress bar — come from `base.css` + `runtime.js`.
- **One `.slide` per logical page.** `runtime.js` shows `.slide.is-active` and hides the rest. Set `data-title="…"` on each slide (used by the overview grid).
- **Speaker notes** go in `<div class="notes">…</div>` or `<aside class="notes">…</aside>` inside each slide. They are `display:none` and appear only in the presenter window.
- **Never put presenter-only text on the slide.** "这一页展示了……", "Speaker: 这里可以补充……", grey captions explaining the slide's purpose → `.notes`. Slides carry only audience-facing content.
- **Animations sparingly** — `data-anim="fade-up"` (or `class="anim-fade-up"`); `anim-stagger-list` on grids/lists; one accent animation per slide. Cover: `rise-in`/`blur-in`; stats: `counter-up`; dividers: `perspective-zoom`. Canvas FX via `<div data-fx="knowledge-graph">` plus `fx-runtime.js`. Catalog: `./references/animations.md`. Also follow `../../craft/animation-discipline.md`.
- **Charts** are hand-rolled SVG/CSS; no chart CDN unless the data truly needs interaction.
- **Chinese typography** — every font stack keeps a Chinese fallback: sans `…,"PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif`; serif `…,"Songti SC","Noto Serif SC",serif`. Google Fonts links may stay (they degrade gracefully). For bilingual titles stack lines: `主标题<br><span class="dim">English subtitle</span>`, English lighter and dimmer.

## Presenter mode (演讲者模式 + 逐字稿)

If the brief mentions 演讲 / 分享 / 讲稿 / 逐字稿 / speaker notes / presenter view / 提词器, or "我要去给团队讲…", start from `./templates/full-decks/presenter-mode-reveal/` and write 150–300 字 of 逐字稿 in every slide's `.notes`. Full guide: `./references/presenter-mode.md`. The three rules:

1. **不是讲稿，是提示信号** — bold the key words; transition sentences get their own paragraph.
2. **每页 150–300 字** — about 2–3 minutes per slide.
3. **用口语，不用书面语** — "因此"→"所以", "该方案"→"这个方案".

Every deck gets the shared presenting toolkit (`../../toolkit/deck-toolkit.js`, see SKILL.md Step 3): **S** opens the presenter window with the current and next slide, the notes and a timer. `runtime.js` exposes `window.deck` for it; its own S and O keys are taken over by the toolkit.

## Keyboard

```
← → Space PgUp PgDn Home End   navigate (runtime.js)
F   fullscreen          N   notes drawer
T   cycle themes (data-themes on <body>)
A   replay demo animation on current slide
toolkit: ? help · O overview · S presenter · L laser · D pen · B/W black/white · digits+Enter jump
#/N deep-link to slide N · Esc close overlays
```

## Review before publishing

- O overview: nothing clips, no slide is empty or overfull.
- T: if `data-themes` is kept, every listed theme file exists under `./assets/themes/` and nothing breaks in any of them.
- S: every slide has notes when the deck is meant to be spoken.
- All links resolve inside `design/<slug>/`; no `../` paths remain.
- Then run the shared five-dimension critique and `../../craft/anti-ai-slop.md`.
