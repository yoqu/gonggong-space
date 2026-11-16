# Weekly Report — corporate clarity

Calm business-review deck: off-white canvas, one cobalt accent, a dense 8-cell KPI grid, shipped list, 8-week bar chart and a next-week owner table — the headline states the conclusion.

`example.html` is a finished example of this template — study its structure, density and finish, do not copy its copy.

Visual system, layouts and the keyboard runtime come from the MIT-licensed [`lewislulu/html-ppt-skill`](https://github.com/lewislulu/html-ppt-skill); the licence ships at `../html-ppt/LICENSE` — keep it in place when redistributing.

## Start here

- Shared rules — self-contained `design/<slug>/` folder, which assets to copy, speaker notes, presenter mode, keyboard runtime: `../html-ppt/GUIDE.md`.
- Starting point: `../html-ppt/templates/full-decks/weekly-report/` — copy `index.html` + `style.css` into `design/<slug>/`, keep `<body class="tpl-weekly-report">`, copy `base.css`, `fonts.css`, `animations/animations.css`, `runtime.js` from `../html-ppt/assets/` into `design/<slug>/assets/` and rewrite the `../../../assets/...` links to `./assets/...`.
- `example.html` is the same template filled with a realistic brief, with all CSS inlined; it loads `../html-ppt/assets/runtime.js`. Use it as the density/finish reference; if you start from it instead, copy `runtime.js` into `design/<slug>/assets/` and point the script at `./assets/runtime.js`.
- Swap content, not classes — the scoped `.tpl-weekly-report` classes are the identity. Re-skin only through the variables at the top of `style.css`.

## Visual system

- Palette: `--bg #fafbfc`, surfaces white, ink `#161e37` / `#50586b` / `#8b92a5`; accent `#2e63eb`, secondary teal `#0ea5b5`; status `--good #10b981`, `--warn #f59e0b`, `--bad #ef4444` used only for status.
- Type: Inter 800 `.h1` 64px, `.h2` 42px; JetBrains Mono for `.week-chip`, dates and figures.
- Shapes: 14–18px radii, hairline borders, very light shadows. `.logo` with a ■ accent square; `.week-chip` with the date range top-right.
- Density is the point: tables and KPI cells, small type allowed (≥ 13px), no decoration.
- Every font stack keeps a Chinese fallback — sans: `"PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif`; serif: `"Songti SC","Noto Serif SC",serif`. Google Fonts links may stay. Copy is Chinese with `<html lang="zh-CN">`.

## Slide vocabulary

1. Cover — `.cover-head` (logo + week chip), kicker, conclusion-as-headline (e.g. 「Star 涨了 18%，安装量却持平。」), lede with the recommendation.
2. KPIs — `.kpi` grid (8 cells): value, delta vs last week coloured by status.
3. Shipped — `.ship-item` list with owner + `.tag`.
4. Metrics — `.chart-bars` 8-week trend, latest bar highlighted.
5. Blockers — `.blocker` rows with severity + ask.
6. Next week — `.next-row` table: item · owner · date.
7. Thanks / decision needed.

## Fits

周报、月报、业务复盘、团队状态更新、增长/运营数据汇报.

## Checklist

- [ ] Cover headline is the finding, not "第 24 周周报".
- [ ] Every KPI has a week-over-week delta and unit; status colours match direction.
- [ ] Every blocker and next-week item has an owner and a date.
- [ ] Speaker notes live in `.notes`; no presenter-only text on slides.
- [ ] All links resolve inside `design/<slug>/`; Chinese fallback in every font stack.
