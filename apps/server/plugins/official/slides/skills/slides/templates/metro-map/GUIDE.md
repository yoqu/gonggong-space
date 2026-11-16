# Metro Map

A deck drawn as a metro line: every content slide is a **station**, colour-coded lines mark phases, interchange stations mark hand-overs, and a live mini line map on top of every slide shows where the audience is. For roadmaps, milestone reviews, learning paths and training agendas.

`example.html` is a finished example of this template (10 slides: 蓝鲸物流 2026 数字化建设路线, 3 lines, 8 stations) — study its structure, density and finish, do not copy its copy.

## Start here

1. Copy `example.html` to `design/<slug>/index.html`.
2. Keep the whole "Stage kernel" CSS block and the kernel `<script>` byte-for-byte, and keep the metro `<script>` that follows the kernel script (it generates the line map, signs, legend and recap).
3. Keep `<script src="…/deck-toolkit.js"></script>` as the last element of `<head>`; SKILL.md Step 3 rewrites its path to `./assets/deck-toolkit.js` and copies the file.
4. Edit the `LINES` and `NETWORK` constants at the top of the metro script, then replace slides one by one.

## Visual system

| Token | Value | Use |
| --- | --- | --- |
| `--paper` | `#FBFAF6` | page background (light slides) |
| `--ink` | `#14202B` | text, station signs, interchange rings |
| `--muted` | `#5B6670` | secondary text, labels |
| `--rule` / `--pale` | `#DADDD8` / `#C9CED1` | hairlines, not-yet-reached stations |
| `--l1` `--l2` `--l3` | `#0B6FB8` blue · `#E2552D` vermilion · `#12936A` green | one colour per line; add `--l4` etc. for more lines |
| `--board` / `--board-ink` | `#121A22` / `#FFC63A` | departure-board panel only |
| `.slide.dark` | `#10171E` bg | the terminus slide (one dark slide per deck) |

- **Type:** one sans stack (`--sans`, bold 700–800 for display) ending in `"PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif`; `--mono` only for codes (`S01`, `W03`) and the departure board. Title 120px (cover), station name 64px, claim 56px, body ≥ 30px, labels 20–24px. Tabular numerals everywhere.
- **Grid:** 140px side margins. Station slides stack: mini map 0–150px → station sign 184–308px → claim at 342px → body from 450px to 1000px.
- **Decoration rules:** lines are thick (8px on the mini map, 18px on the cover), ends rounded, bends at 45°. Station = white dot with line-colour ring; interchange = double ring (ink outer ring); passed station = filled; current = big ring + halo. No gradients, no blobs, no emoji. Line colour is the only accent on a slide: use the current station's line class (`lc1`/`lc2`/`lc3` on `.body`) so numbers and markers follow it.

## Slide vocabulary

Station metadata lives on the `<section>`:

```html
<section class="slide" data-section="s3-data" data-title="数据中台"
         data-stop data-line="1" data-when="4 月" data-result="214 个指标统一为 1 套口径">
  <nav class="minimap"></nav>   <!-- filled by script -->
  <header class="sign"></header> <!-- filled by script -->
  <h2 class="claim">…claim-style headline…</h2>
  <div class="body lc1">…</div>
  <aside class="notes">…</aside>
</section>
```

| Slide / block | Use |
| --- | --- |
| `.cover` + `[data-legend]` + `svg[data-routemap]` | Full route map, generated from the stations; stations are clickable. No `data-stop`. |
| non-station slide with `nav.minimap` (e.g. 乘车须知) | Overview before departure; `ul.lstops[data-line-stops="1"]` lists that line's stations automatically. |
| `.split` → `ol.steps` + `.nums` | Findings list (use `data-step` per item) beside 2–3 big numbers. |
| `.board-wrap` → `.board` table + `.big` | Departure-board schedule (班次 / 时间 / 状态; `td.ok` done, `td.go` in progress) beside one before→after metric. |
| `svg.figure` | Inline SVG diagram or chart (flow into a hub, grouped bars). Text ≥ 24px in SVG units, colours from `var(--lN)`. |
| `.subline` → `.sub-st` ×3 + `.ribbon` | A three-step mini line (one `data-step` each) and one headline metric. |
| `.split` → `ol.steps` + `.mock` | Feature list beside an HTML mock card. |
| `.slide.dark` terminus + `[data-recap]` + `.next-trip` | Summary: one row per station built from `data-result`, plus the next trip. |

Typical 10-slide deck: cover (route map) → 乘车须知 → 7 stations across 2–3 lines → terminus (dark, recap). Keep 5–10 stations; above 10 the mini-map labels crowd.

## Interaction

- Mini map: passed stations filled, current highlighted, upcoming hollow; a train marker slides from the previous station to the current one on every `slidechange`. Click any station (mini map, cover map, 乘车须知 list) to jump — the script calls `window.deck.go(i)` and blurs focus so ← → keep working.
- In-slide reveals use `data-step` (kernel: → shows the next item before paging).
- `prefers-reduced-motion: reduce` removes the train and step transitions.

## Linked edits

The line map, station numbers (`S01`…), "下一站", interchange badges, "第 N 站 / 共 M 站", the cover map, legend, per-line station lists and the terminus recap are all **generated from the `[data-stop]` slides at load**. Adding, removing or reordering a station needs no hand edits there. What you must keep in sync by hand:

- Each station slide's `data-title` (station name, ≤ 6 Chinese characters), `data-line`, `data-when`, `data-result` (≤ 16 characters, shown on the terminus).
- A new line id needs an entry in `LINES` (script), a `--lN` colour in `:root`, and an `.lcN{--c:var(--lN)}` rule; set `lcN` on that station's `.body` for accent colour.
- Interchange stations are automatic (a station whose next station is on another line). Diagram/SVG colours that mention a line (`var(--l2)` etc.) and copy that says "换乘 · 调度线" must match the actual next line.
- Copy that states counts ("三条线，八个站", "一年八站") on the cover, 乘车须知 and terminus claim must match the station count.
- `NETWORK` (script) is the caption on every mini map.
- Exactly one terminus: the last `[data-stop]` slide, normally `.slide.dark`.

## Print

Supported: browser print, one 1920×1080 page per slide. Every station prints its own mini map in its static state (passed / current / upcoming) with the train parked on the current station; all `data-step` items print visible. Print after the page has loaded (the generated parts come from the script).

## Speaker notes

Put 60–120 characters of notes in `<aside class="notes">…</aside>` as the last child of each slide; the kernel hides them and the S presenter window shows them.

## Checklist

- [ ] Every station slide has `data-stop`, a unique `data-section`, short `data-title`, `data-line`, `data-when`, `data-result`, plus empty `nav.minimap` and `header.sign`.
- [ ] Station count 5–10; mini-map labels do not collide at 1280×720.
- [ ] Each slide uses only its own line colour as accent; no extra hues beyond `--l1…`.
- [ ] Count words in copy (lines, stations) match the generated map.
- [ ] Clicking a station jumps and ← → still work afterwards.
- [ ] Nothing overflows 1920×1080; body text ≥ 28px.
- [ ] Example numbers are labelled 示例 or come from the brief.
