# New Chinese（新中式）

Quiet ink-and-paper deck for cultural brands, tea / incense / travel, intangible heritage and 国风 product launches: rice-paper ground with CSS noise and fibre, ink-black Kai/Song type, one cinnabar seal accent, vertical titles, SVG ink mountains, cloud scrolls and lattice windows, and an ink-bloom fade on every slide change.

`example.html` is a finished 10-slide example (fictional tea brand 栖山茶事, 2026 春茶新品发布) — study its structure, density and finish, do not copy its copy, product names, prices or venues.

## Start here

1. Copy `example.html` to `design/<slug>/index.html`.
2. Keep the whole "Stage kernel" CSS block and kernel `<script>` byte-for-byte; keep the hidden `<svg>` defs at the top of `<body>` (gradients, `#rough` filter, `#lattice` pattern, `#cloud` and `#ranges` symbols) and the template `<script>` (folio, craft tabs, flavor radar).
3. Keep `<script src="…/deck-toolkit.js">` as the last element of `<head>`; SKILL.md Step 3 rewrites it to `./assets/deck-toolkit.js` and copies the file.
4. Set `.deck[data-brand]` (folio text), then replace slides one by one.

## Visual system

| Token | Value | Use |
| --- | --- | --- |
| `--paper` / `--paper-2` | `#F2ECDF` / `#E8DFCC` | slide ground (with `--noise` + `--fiber` data-URI SVG textures and two soft radial washes) |
| `--ink` | `#1E1C19` | titles, body, line art, ink mountains (via `#mist` gradient) |
| `--ink-2` / `--ink-3` | `#47423A` / `#8C8476` | secondary text, captions, sub-titles |
| `--hair` | `#CFC5B2` | hairlines, radar grid, column rules |
| `--cinnabar` | `#AE3A2A` | seals, one highlighted word or node per slide, active tab/step. Keep to ≤ 2 spots per slide. |

- **Fonts:** `--kai` `"Kaiti SC","STKaiti","KaiTi","Songti SC","Noto Serif SC",serif` for titles, names, verse; `--song` `"Songti SC","STSong","Noto Serif SC",serif` for body. No calligraphy fonts, no web fonts.
- **Grid:** vertical title `.vt` at right 170px (100px Kai, `writing-mode: vertical-rl`, small `<small>` sub-column), a hairline `.vrule` at right 360px, content `.body` at left 160 / right 420 / top 150 / bottom 140. Folio bottom-left. Leave at least a third of every slide empty.
- **Type scale:** cover title 176px; verse 60–120px; product names 64–72px; body 28–30px (never below 28px); captions 24–26px.
- **Seal:** `.seal` + size `.s-lg` (132px, 4 chars) / `.s-md` (96px, 2 chars) / `.s-sm`; white-on-cinnabar 白文 by default, `.zhu` for red-outline 朱文. Write ordinary characters only (brand name, 春, 山…), never imitate a real artist's seal.
- **Decoration:** ink mountains `<svg class="deco mtn"><use href="#ranges"/></svg>` (cover/end only), cloud `<use href="#cloud">` (≤ 1 per slide), lattice `fill="url(#lattice)"` for window frames and card heads, moon circle. No gradients other than the mist and paper washes, no drop shadows, no photos unless the client supplies them.
- **Motion:** add `class="ink"` (+ `style="--d:.3s"` delay) to anything that should bloom in from blur when its slide activates; `data-step` for click-by-click reveal. Both degrade under `prefers-reduced-motion`.

## Slide vocabulary

| Class / element | Use |
| --- | --- |
| `.slide.plain.cover` | Brand top-left, moon circle, vertical `<h1>` title, vertical sub-title, large seal, ink ranges. |
| `.verse` + `.gate` | 序: 3–4 vertical verse lines (≤ 11 chars each, one cinnabar character `.r`), round lattice window framing a mountain view. |
| `.terr` (`svg` + `.facts`) | 山场: contour line drawing with cinnabar garden dots and leader-line labels + 3 big facts. |
| `.seasons` (`.term`, `.term.key`) | 时令: tapered ink stroke with 4 节气 nodes (`data-step`); position via `left:%`. |
| `.teas` (`.tea`) | Product cards: lattice head, Kai name with small prefix, cinnabar type line, description, spec `<dl>`, size + price footer. 3 cards. |
| `.steps` + `.panel` | 工艺 (interactive): 5 brush-ring buttons; click shows that step's details. Data in `CRAFT` in the template script. |
| `.flav` (`#radarGrid`, `#radarPoly`, `.tabs`) | 风味 (interactive): 5-axis radar + tasting notes; tabs switch product. Data in `FLAVOR`/`AX`. |
| `.gift` (`svg` + `.sku`) | 器与礼: line-drawn caddy and box + 3 SKU rows. |
| `.meets` (`.meet > .col`) | 茶会/活动: vertical columns, read right→left in date order (`row-reverse`), `data-step`. ≤ 4. |
| `.slide.plain.end` | Two vertical lines of closing verse, seal, colophon, ink ranges. |

Typical 10 slides: cover → 序 → 山场/产地 → 时令/时间线 → 新品 → 工艺 → 风味 → 器与礼 → 活动 → 结束. For non-tea topics keep the rhythm (one breathing verse slide after the cover, one interactive slide in the middle) and rename sections (e.g. 香事: 原料 / 合香 / 香韵).

## Linked edits

- **Slide count:** folio "叁 / 拾" uses Chinese numerals computed by script up to 二十 — nothing to edit. Vertical titles are hand-written per slide.
- **Product names** appear in: products cards, 时令 `.what b`, 风味 tabs + `FLAVOR` order, 器与礼 SKU text and the caddy label in the gift SVG, speaker notes. Rename everywhere.
- **Craft steps:** button characters/labels and the `CRAFT` array must stay in the same order; the panel's initial HTML must equal `CRAFT[0]`.
- **Radar:** `AX` labels and each `FLAVOR[i][0]` array must have the same length (0–10 scale); tabs' `data-t` index `FLAVOR`.
- **Seasons:** `.term` `left:%` values must be spread evenly (example 11 / 37 / 63 / 88%); `.key` marks the flagship product's node only.
- **Brand:** `.deck[data-brand]`, cover `.brand`, seals' text, end `.colo`, `<title>`.
- **Colours:** `:root` variables; inline SVG repeats `#1E1C19`, `#AE3A2A`, `#8C8476`, `#F2ECDF` (labels, gift drawing, defs) — search-replace together.

## Print

支持：浏览器打印，每页一张 1920×1080. `.ink` elements and `data-step` items print fully visible (no bloom). The craft slide prints the currently selected step (first step by default), the flavor slide prints the currently selected tea — reset both to the first item before printing a handout. The paper texture prints only with "background graphics" enabled.

## Speaker notes

`<aside class="notes">…</aside>` as the last child of each slide (60–120 字，像主理人在讲故事：一个具体细节 + 一个数字). Hidden on stage; S opens the presenter window.

## Checklist

- [ ] Every content slide has a vertical `.vt` title at the right and leaves ≥ 1/3 blank; cover and end are `.plain`.
- [ ] Cinnabar appears in ≤ 2 spots per slide; seals contain plain characters only.
- [ ] Vertical lines ≤ 11 characters so they fit between 150px and 940px.
- [ ] Body text ≥ 28px in the Song stack; titles in the Kai stack; no web fonts.
- [ ] Prices, altitudes, quantities come from the brief or are marked 示例 / `【待补：…】`.
- [ ] Clicking a craft step or flavor tab, then pressing →, still pages.
- [ ] Ink bloom plays on entry and is disabled with reduced motion; print shows everything.
