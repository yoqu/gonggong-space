# Living Model 活体模型

A clean light data-dashboard deck where every model slide is live: the presenter drags parameters on a left panel and the chart and headline numbers on the right recalculate on stage. Use it for business-model walk-throughs, unit economics, growth projections, budgets and technical trade-off talks.

`example.html` is a finished example (11 slides, a fictional coffee chain "野径咖啡" planning new-store expansion) — study its structure, model wiring and density, do not copy its copy or numbers.

## Start here

1. Copy `example.html` to `design/<slug>/index.html`.
2. Keep the whole "Stage kernel" CSS block and the kernel `<script>` byte-for-byte; keep the `<script src=".../deck-toolkit.js">` tag as the last element of `<head>` and rewrite its path to `./assets/deck-toolkit.js` (SKILL.md Step 3 copies the file).
3. Keep the second `<script>` (the "Living models" engine). You edit only its `MODELS` object and the constants above it (`OTHER`, `RAMP`, `RAMP_START`, `SCN`, `BASE`).
4. Replace slides one by one. Every model is one `[data-model="<key>"]` block whose key matches an entry in `MODELS`.

## Visual system

- **Colours** (all in `:root`): `--bg #f3f1eb` warm paper, `--card #fffdf8` panels, `--line #dcd7cb` hairlines, `--soft #e8e4d9` tracks, `--ink #15191d` text and primary marks, `--mute #62676c` secondary text and axes, `--acc #1d6a4e` (one accent: good outcome, revenue, the highlighted series) with tint `--acc-t`, `--neg #b3442a` (bad outcome: loss, below threshold, cash gap) with tint `--neg-t`. A brand colour replaces `--acc` only; keep `--neg` red-ish.
- **Type**: `--sans` (Helvetica Neue/Arial → PingFang SC …) for titles and labels, `--mono` (SF Mono/Menlo → PingFang SC …) with `tabular-nums` for every number, knob value, axis label and formula. Title `h2` 60px/700; KPI numbers 76px mono; knob labels 28px; body ≥ 28px; axis labels 22px.
- **Grid**: 1920×1080, padding 64px 96px. Header block 150px (mono kicker `.tag` + `h2` question). Model area 770px: 560px panel + 56px gap + 1112px view. View = 3-up KPI row → 1112×520 SVG chart → one-line formula `.fx`. Footer `.ft` (deck name · page number) pinned 30px from the bottom.
- **Decoration rules**: no gradients, no shadows, no icons. Hairline borders, 3px rule above each KPI (turns red when the KPI is bad), 6px radius at most. Charts are flat strokes and tints; the default-value tick on every slider track is the only "ornament". Titles are questions; KPIs are the answers.

## Slide vocabulary

| Kind | Class / marker | Use |
| --- | --- | --- |
| Cover | `.slide.s-cover` + `.try[data-model="cover"]` | Title left, a single live knob + big result right ("试一下：拖动…") |
| Agenda | `.grid6 > .cell` | Six model cards: number + question + baseline answer (`.d b`) |
| Model | `.model[data-model]` → `.panel` (knobs) + `.view` (`.kpis`, `svg.chart`, `p.fx`) | One model per slide |
| Takeaways | `.two` → `p.claim` + `ul.rows > li[data-step]` | One sentence decision + 3–5 thresholds revealed one by one |
| Formulas | `table.fx-table` | Appendix: model · formula · data source |
| End | `.s-end` | Q&A invitation |

Built-in models (keys in `MODELS`): `cover`, `funnel` (growth funnel, log-width bars), `ltv` (cumulative margin vs CAC line, payback dot), `breakeven` (revenue vs total cost lines, loss/profit wedges, forecast marker), `runway` (48-month cash simulation, red area below zero), `tornado` (one-at-a-time sensitivity, sorted bars), `scenario` (preset buttons 乐观/基准/悲观 that move the knobs, ghost lines + live line).

Typical 10–12 slide structure: cover → agenda → 4–6 model slides (funnel → unit economics → break-even → runway → sensitivity → scenarios) → takeaways → formula appendix → end.

### Knobs (sliders)

```html
<div class="knob" data-k="rent" data-min="3" data-max="12" data-inc="0.1" data-v="6.5" data-d="1" data-u=" 万">月租金</div>
```

`data-k` param name passed to `calc(p)`, `data-v` default, `data-inc` increment, `data-d` decimals shown, `data-u` unit suffix; text = label. **Never use `data-step` on a knob** — the kernel treats `[data-step]` as an in-slide reveal step. Knobs are pointer-driven divs (no `<input>`), so they never take keyboard focus and ← → keep paging. Double-click a knob resets it; the panel's 复位 button resets the model. Up to 5 knobs fit the panel (4 + a preset `.seg` on the scenario slide).

### Changing a formula or default

1. Edit the knob's `data-v` (default) and range in HTML.
2. Edit `MODELS.<key>.calc(p)`: it returns `o` (output key → display text for `[data-o="key"]`), optional `t` (key → `'pos'|'neg'` colours the KPI; `t.self` colours the whole block, used on the cover) plus any raw values `draw` needs.
3. Edit `MODELS.<key>.draw(r, p)`: returns SVG markup for the 1112×520 chart. Use `frame({x:[a,b], y:[c,d], xf, yf, xl, xt, l, r})` for axes and grid, `line(points, X, Y)` for paths.
4. Update the `.fx` formula line on the slide and the row in the formula appendix so the shown formula is what the code computes.
5. New model = new `MODELS` entry + a slide whose `[data-model]` matches. Keep formulas simple enough to read aloud.

## Linked edits

- **Shared constants**: `OTHER` (other fixed cost), `RAMP` / `RAMP_START` (new-store ramp), `BASE` (tornado/scenario baseline), `SCN` (scenario presets) feed several slides — change them and re-check the break-even, tornado, scenario slides, the agenda `.d b` numbers, the takeaway thresholds and the notes that quote them.
- **Baseline numbers are written as text in four places**: agenda cards, takeaways `.rows`, cover hint, speaker notes. After changing any default, reload, read the live KPIs and update those texts to match.
- **Formula text**: `.fx` line on each model slide ↔ `.fx-table` appendix row ↔ `calc()`.
- **Slide count**: footer page numbers (`.ft span:last-child`) and the agenda's model numbers (`01 增长漏斗`, kicker `模型 01 / …`).
- **Accent colour**: `--acc` / `--acc-t` in `:root` only; charts reference the variables.

## Print

支持：浏览器打印，每页一张 1920×1080。A `beforeprint` handler resets every model to its default parameters (scenario back to 基准), so printouts/PDFs always show the baseline state whatever was dragged on stage. Takeaway steps print fully revealed. Buttons print dimmed except the active scenario.

## Speaker notes

Each slide ends with `<aside class="notes">…</aside>` (60–120 Chinese characters), shown in the toolkit's presenter window (S). For model slides, script the live demo: which knob to drag, to what value, and what the audience should see change.

## Checklist

- [ ] Every model slide: title is a question, 3 KPIs answer it, one chart, one formula line that matches `calc()`.
- [ ] All defaults reproduce the numbers written in agenda, takeaways, cover and notes.
- [ ] No knob carries `data-step`; dragging a knob then pressing → still pages.
- [ ] Bad states turn red (`t: {key: 'neg'}`) and labels in the chart stay inside the 1112×520 box at both slider extremes.
- [ ] `--acc` is the only accent; `--neg` only for bad outcomes.
- [ ] Numbers are mono + tabular; body text ≥ 28px; nothing overflows 1920×1080.
- [ ] Data is labelled as example/source; no invented precision beyond the inputs.
