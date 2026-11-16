# Blueprint 蓝图工程

An engineering-drawing deck: deep Prussian-blue sheet with a fine + coarse grid, a drawing frame with zone marks, a title block on every slide, dimension lines, section hatching and numbered balloons; line work draws itself in when a slide opens and architecture parts highlight on hover. Use it for system architecture, engineering plans, hardware/building schemes and technical design reviews.

`example.html` is a finished example (10 slides, a fictional data-centre expansion "穹顶城市数据中心二期") — study its structure, drawing vocabulary and density, do not copy its copy or numbers.

## Start here

1. Copy `example.html` to `design/<slug>/index.html`.
2. Keep the whole "Stage kernel" CSS block and the kernel `<script>` byte-for-byte; keep the `<script src=".../deck-toolkit.js">` tag as the last element of `<head>` and rewrite its path to `./assets/deck-toolkit.js` (SKILL.md Step 3 copies the file).
3. Keep the hidden `<svg>` defs right after `<body>` (arrow markers `#ar` / `#da`, hatch patterns `#hatch` / `#cross` / `#soil`) and the second `<script>` ("Blueprint sheet"). Edit its three constants: `PROJECT`, `DATE`, `SIGN`.
4. Replace slides one by one. Each slide needs `data-section`, `data-title` (also printed as 图名 in the title block), `data-dwg` (图号, e.g. `DC2-A-01`) and `data-scale` (`1:200`, `示意`, or `—` for tables).

## Visual system

- **Colours** (`:root`): `--bg #0c2d52` Prussian blue, `--ink #eef6ff` line work and text, `--cy #8fd6ff` light cyan for dimensions, values and accents, `--dim #a9c6e2` secondary lines and labels, `--faint` hairline rules, `--g1`/`--g2` 24px fine grid and 120px coarse grid, `--hi #ffc65c` amber — only for high-risk markers, never decoration.
- **Type**: `--sans` (DIN Alternate / Bahnschrift → PingFang SC …) for titles and labels, `--mono` (SF Mono / Menlo → PingFang SC …) for codes, numbers, dimensions and kickers. `h2` 58px; body ≥ 28px; diagram labels 26px (`.t`), 22–24px for secondary SVG annotations (`.ts`, `.tm`, `.dt`); title-block text is chrome (13/19px).
- **Sheet**: the script adds to every slide a double frame (outer inset 24px, inner 48px), zone marks 1–8 / A–D, and a 640×150 title block at the bottom-right (工程名称 · 图号 · 图名 · 比例 · 设计/审核 · 日期 · 张次). Content area is x 104–1816, y ≈ 230–1030, **except the title-block rectangle x ≥ 1232, y ≥ 882 — keep everything out of it.**
- **Header**: `.hd` = `.no` (`图 01` / `表 01` / `END`) + `h2` sentence that states the conclusion.
- **Decoration rules**: lines only — no gradients, shadows or rounded cards. Fills are hatch patterns or ≤ 6% cyan tints. Dimension text sits above (or beside) its dimension line, units in mm, elevations in m.

### SVG drawing vocabulary

| Class | Meaning |
| --- | --- |
| `.ln` (`.th` thin, `.bold`) | Object lines — animated draw-on |
| `.dim` + `marker-start/end="url(#da)"` | Dimension line — animated; pair with `.ext` extension lines and a `.dt` value |
| `.cl` | Centre line / boundary (dash-dot) |
| `.hid` | Hidden / reserved line (dashed) |
| `.bl` (`<g class="bl"><circle/><text/></g>`) | Numbered balloon; leader is a `.ln.th` line |
| `url(#hatch)` / `url(#cross)` / `url(#soil)` | Masonry / concrete / soil section fills |
| `.fi` | Element that fades in after the lines (labels, balloons, legends) |
| `marker-end="url(#ar)"` | Flow arrow |

Draw-on: the script sets `pathLength="1"` on every `.ln`/`.dim` and staggers `--d` by document order, so put background structure first and labels last. Animation replays whenever the slide becomes active and is disabled under `prefers-reduced-motion` and in print.

Hover: wrap a part as `<g class="part" data-name="…" data-note="…"><rect class="ln bx" …/><text …/></g>`. On a slide with a `.spec` panel, hovering a part dims the others and shows its name and note (`<em>` in the note renders cyan mono). Parts without `data-note` are just styled boxes.

## Slide vocabulary

| Page type | Structure | Example section |
| --- | --- | --- |
| 封面图框 | left title + `.specs` key figures; right elevation SVG with dimensions and balloons; `.org` credit | `cover` |
| 总体架构图 | 1200×640 SVG of `.part` boxes and arrows + `.spec` hover panel | `architecture` |
| 模块分解 | exploded oblique layers, balloons 1–n + `table.pt` parts list | `module` |
| 数据流 | horizontal flow SVG + `.flowsteps` with `data-step` | `dataflow` |
| 部署拓扑 / 总平面 | site plan with red-line boundary (`.cl`), hatched existing buildings, overall dimensions, north arrow + `.spec` | `site-plan` |
| 剖面 | section with slab/wall hatching, elevation markers, dimension chain, legend | `section` |
| 关键参数表 | `table.pt` (编号 / 参数 / 设计值 `.v` / 对照 `.m` / 说明) | `parameters` |
| 风险与对策 | `.risks > .risk[data-step]` (ID · 风险 · 等级 `.lv`/`.lv.h` · 对策) | `risks` |
| 里程碑 | time axis drawn as a dimension line, balloons `M1…` alternating above/below, phase bars | `milestones` |
| 结束 | decisions `.asks` + auto 图纸目录 `.dir` + 会签栏 `table.sign` | `end` |

Typical 10-slide order: cover → architecture → module → data flow → site plan → section → parameters → risks → milestones → end. Drop the section or site plan for pure software systems; add a second architecture slide for a subsystem rather than shrinking text.

## Linked edits

- **Slide count**: title-block 张次 and the end slide's 图纸目录 are generated from the slide list — nothing to edit by hand, but every slide needs `data-dwg` and `data-title`. The cover notes and any "共 N 张" wording in notes are manual.
- **Drawing numbers**: `.no` label on each header (`图 03`, `表 01`) is manual; keep it consistent with `data-dwg` and with cross references in text (e.g. "剖切位置见图 04").
- **Key figures repeat**: cover `.specs`, architecture notes, parameter table and the decisions on the end slide quote the same numbers (24 MW, PUE, cabinet count, dates) — change all together. Milestone dates appear in the SVG labels and in the risk countermeasures/notes.
- **Milestone axis**: x = 60 + month × (1600 / total months). Changing the span means moving ticks, balloons, leader lines and phase bars.
- **Dimensions**: if a drawn object moves, move its `.ext` lines, `.dim` line and `.dt` value together.
- **Theme**: colours live only in `:root`, except the hard-coded stroke colours inside the `<defs>` markers/patterns (`#eef6ff`, `#8fd6ff`, `#a9c6e2`) — update those when retheming.

## Print

支持：浏览器打印，每页一张 1920×1080。Draw-on animations are switched off in print so every line is complete; all `data-step` items print revealed; hover panels print their default text ("悬停任一部件"). The slide sets `print-color-adjust: exact`, so the blue sheet and grid print without enabling "背景图形".

## Speaker notes

Each slide ends with `<aside class="notes">…</aside>` (60–120 Chinese characters), shown in the toolkit's presenter window (S). For drawings, tell the presenter what to point at (which balloon, which dimension) and what to hover.

## Checklist

- [ ] Every slide has `data-section`, `data-title`, `data-dwg`, `data-scale`; title block reads correctly.
- [ ] Nothing enters the title-block rectangle (x ≥ 1232, y ≥ 882) or crosses the inner frame.
- [ ] Every dimension has extension lines, arrow markers and a value above/beside the line; units stated on the cover.
- [ ] Amber `--hi` appears only on high-risk markers; no gradients or rounded cards.
- [ ] Hover parts on architecture / site plan all have `data-name` + `data-note`; the panel resets on mouse-out.
- [ ] Draw-on replays on slide entry, is off with reduced motion, and print shows complete line work.
- [ ] Body text ≥ 28px; SVG labels ≥ 22px; nothing overflows 1920×1080.
