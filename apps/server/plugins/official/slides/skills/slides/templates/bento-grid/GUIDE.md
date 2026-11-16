# Bento Grid

Every slide is one irregular grid of rounded cards — big numbers, mini charts, monoline icons, short lines and one warm gradient block — that float in one after another. For product feature tours, annual reviews and personal or team report cards.

`example.html` is a finished example of this template (10 slides, a fictional note app's 2026 review) — study its structure, density and finish, do not copy its copy.

## Start here

1. Copy `example.html` to `design/<slug>/index.html`.
2. Keep the whole "Stage kernel" CSS block, the kernel `<script>` at the bottom and the small template script right above it (it numbers the cards, fills the page counter and replays the entrance). Keep the `<script src="…/deck-toolkit.js">` tag as the last element of `<head>`; SKILL.md Step 3 rewrites its path to `./assets/deck-toolkit.js`.
3. Replace the content slide by slide. Duplicate the slide whose layout is closest, then move cards by editing their `--c` / `--r` only.

## Visual system

**Tokens** (all in `:root`):

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#ECEAE4` | warm light-grey stage |
| `--card` | `#FFFFFF` | default card |
| `--ink` | `#17171A` | text, dark cards (`.card.ink`), bars |
| `--muted` | `#6B6963` | eyebrows, secondary text |
| `--night` / `--night-card` | `#111113` / `#1E1E22` | dark slides (`.slide.dark`) — cover and end only |
| `--orange` | `#FF6A2B` | the one accent: highlighted bar, ring value, icon on dark |
| `--grad` | orange → amber `#FF6A2B → #FF923A → #FFC65A` | the gradient card, at most 1–3 per slide |
| `--butter` `--sage` `--sky` | `#F4DC6A` `#CFE2C3` `#CADCEE` | soft tint cards, at most one of each per slide |

To re-brand, change `--orange` and `--grad` together (keep the gradient within one hue family — never purple→blue or blue→cyan) and leave the neutrals alone.

**Type.** One sans stack (`--sans`, system SF/Helvetica → PingFang SC), one mono (`--mono`) for eyebrows, month numbers and the footer. Scale: `h1` 150px (cover/end), `h2` 64px (title card), `h3` 36–56px (card heading), `.num` 112px (`.num.l` 168px, `.num.m` 84px, unit in `<small>` at 0.4em), body `.txt` / `.lab` 28px. Numbers use `tabular-nums`. Never go below 28px for readable copy; 22–24px is reserved for chrome (eyebrows, chart axis labels, footer).

**Grid.** `.grid` is 12 columns × 6 rows with a 24px gap inside a 72px side / 56px top / 96px bottom margin. Each card places itself with inline custom properties: `style="--c:5/9;--r:1/4"` (grid-column / grid-row). Rules:

- Tile the whole 12×6 area — no holes. Write the layout as a sketch first and check each row is covered once.
- 6–10 cards per slide. One hero card (≥ 4 cols × 3 rows) per slide carries the main point; the rest are 2–4 cols × 2 rows.
- A 2-column card is ~276px wide: only one `.num.m` (≤ 4 characters) or two short lines fit.
- Card anatomy: top = eyebrow or icon; bottom (`.push`) = number or heading + one line of `.txt`. Leave the middle empty — the air is the style.

**Decoration rules.** Cards: 30px radius, a soft two-layer shadow, no borders, never a coloured left border. Icons: inline 24×24 monoline SVG (`.ico`, 1.8 stroke, `currentColor`), never emoji. Charts are HTML/CSS or inline SVG only: `.bars` (vertical columns, `--k` per bar for the cascade, `.b.hi` for the orange bar), `.hbar` (horizontal share bars), `.ring` (SVG ring with `pathLength="100"` and `style="stroke-dasharray:<pct> 100"`), `.meter` (progress), `.dots` (headcount), `.stars`, `.av` (initial avatars). Highlight at most two data points in orange per chart.

**Motion — driven by `slidechange` (not `data-step`).** The template script listens to `slidechange`; when the active slide changes it moves the class `is-in` to it, and CSS plays `rise` on every card with `animation-delay: --i × 75ms` (`--i` is the card's DOM order, set by the script — so write cards in the order they should appear). Bars, share bars, meters and rings start growing ~380ms after their card. Hover lifts a card 6px. Under `prefers-reduced-motion: reduce` all entrances and the hover lift are off. Do not add `data-step` to cards; → pages straight through this template.

## Slide vocabulary

| Slide type | Classes / pattern | Use |
| --- | --- | --- |
| Cover | `.slide.dark`, hero card with `h1`, a `.grad` year card, 3–4 small facts (date, presenter, a count) | Title |
| Overview grid | `.ink` title card + 8–9 single-metric cards, one `.grad` hero | The whole story in one screen; each card previews a later slide |
| Metrics grid | title card, one wide `.bars` chart card (8 cols × 4 rows), a `.ring` card, 2–3 number cards | Growth / KPI |
| Feature grid | title card + 5–7 feature cards: `.ico` + `h3` + one `.txt` line; the most-used feature gets the `.grad` hero | Product capabilities |
| Usage / mix grid | `.hbar` share chart card + fun-fact cards | What people do with it |
| Timeline grid | full-width `.ink` title strip (row 1), 12 `.mo` month cards (2×2 each, rows 2–5), full-width summary strip (row 6) | Month-by-month or quarter-by-quarter |
| Quote grid | one big `.ink` card with `.quote` + `.who`, 2 small quote cards, 2–3 rating cards | Voice of customer |
| Team grid | title card, one card per group (number + `.av` initials), totals strip | Team / org |
| Plan grid | title card + three numbered cards (`.big-n` 01/02/03) + a "won't do" strip | Next year / roadmap |
| End | `.slide.dark`, hero `h1` thank-you, Q&A, follow-ups | Close |

Typical 10-slide order: cover → overview → metrics → features → usage → timeline → quotes → team → plan → end. Use a dark slide only for cover and end.

## Linked edits

- **Page counter** (`.foot .pg`, "03 / 10") is filled by the script from the slide count — nothing to edit, but every slide needs the `.foot` element.
- **Section numbers** in title-card eyebrows (`01 · 全格总览` …) — renumber all of them when you add, remove or reorder slides.
- **Overview slide ↔ detail slides.** Every number on the overview must match the slide that expands it (e.g. 月活 286 万, 留存 62%, 付费转化 8.4% appear on overview and metrics). Change both. The overview title states the card count ("九个格子") — keep it equal to the number of metric cards.
- **Chart data.** Bar heights are percentages of the maximum: `height = value / max × 100%`; share bars `width = share / largest share × 100%`; rings `stroke-dasharray:<percent> 100`. Change the label next to them too.
- **Timeline** month count, the "大版本" highlight cards (`.grad`) and the summary strip text ("全年 12 次大版本") must agree with the feature slide.
- **Team** group sizes must add up to the headcount on the overview and the team title.
- **Brand colour** lives in `--orange` and `--grad` only (plus `.dots i.o`, `.b.hi` which read `--orange`).

## Print

支持：浏览器打印，每页一张 1920×1080. Cards print in their final state (entrance animations are skipped; only the active slide ever carries `is-in`), shadows are dropped, background colours print exactly (`print-color-adjust: exact`). Turn on "Background graphics" if the browser asks.

## Speaker notes

Put 60–120 characters of notes in `<aside class="notes">…</aside>` as the last child of every slide; the kernel hides them and the S presenter window shows them. Point out which card to look at first — the audience reads bento slides in any order.

## Checklist

- [ ] Every slide's grid is fully tiled (12×6, no holes, no overlaps) and nothing is clipped inside a card at 1920×1080 and 1280×720.
- [ ] One hero card per slide; ≤ 3 gradient cards; orange used for ≤ 2 highlights per chart.
- [ ] Readable copy ≥ 28px; numbers use `.num` sizes that fit the card width.
- [ ] Icons are inline monoline SVG; no emoji, no remote images or fonts.
- [ ] Overview numbers match the detail slides; section numbers run in order.
- [ ] Cards appear one by one on entering a slide; with reduced motion they appear at once.
- [ ] Every slide has a unique `data-section`, a `data-title` and `<aside class="notes">`.
