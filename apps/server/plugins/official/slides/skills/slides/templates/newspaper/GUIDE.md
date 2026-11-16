# Newspaper Front Page

A broadsheet on aged newsprint: black serif nameplate with issue/date/price bar, multi-column body, heavy and hairline rules, oversized headlines that typeset themselves letter by letter, halftone line drawings with captions, and sidebar briefs that expand on click. Each slide is a page — "第 X 版". For launch announcements, big-news style reports and year-in-review chronicles.

`example.html` is a finished example of this template (10 pages, a fictional tech special issue about a fictional warehouse-robot launch) — study its structure, density and finish, do not copy its copy.

## Start here

1. Copy `example.html` to `design/<slug>/index.html`.
2. Keep the whole "Stage kernel" CSS block, the kernel `<script>` at the bottom, the template script right above it (page numbers, headline typesetting, briefs) and the hidden `<svg><defs>` block before `.deck` (halftone and hatch patterns used by every illustration and chart). Keep the `<script src="…/deck-toolkit.js">` tag as the last element of `<head>`; SKILL.md Step 3 rewrites its path to `./assets/deck-toolkit.js`.
3. Replace content page by page. Rename the paper (`星港日报`), the special-issue stamp, the date and issue number everywhere they appear (see Linked edits).

## Visual system

**Tokens** (`:root`):

| Token | Value | Use |
| --- | --- | --- |
| `--paper` | `#EEE5CF` | newsprint background (plus a faint radial tint and 1px line grain in `.slide` background-image) |
| `--paper-2` | `#E3D7BA` | shaded boxes (`.box.shade`), highlighted chronicle cell |
| `--ink` | `#1D1A15` | all text, rules, illustrations, black kicker |
| `--ink-2` | `#4B443A` | subheads, captions, summaries |
| `--red` | `#9C2B1F` | the only colour: special-issue stamp, red kicker, "展开全文", one highlighted data point per chart |

**Type.** `--serif` (Iowan Old Style / Times for Latin, then `"Songti SC","Noto Serif SC",serif`) for everything editorial; weight 900 for nameplate, headlines and subheads. `--sans` only for newsroom chrome: kickers, captions, "（下转第 2 版）", table headers. Sizes: nameplate 128px with wide tracking; `.hl` 90px (front page, two lines), `.hl.s` 84px (inner pages, one line), `.hl.xs` 72px; `.deck-sub` 34px; body 28px / 1.62, justified, 2em first-line indent; captions 24px sans.

**Page grid.** `.paper` sits 40px/64px inside the slide and is a flex column. Front page: top line → `.mast` (ear · nameplate · ear) → `.datebar` (5px rule over, hairline under) → main column + 410px briefs sidebar. Inner pages: `.run` running header (paper name · date · 第 N 版 · section, with a double rule) → kicker → headline → a CSS grid of columns separated by `.vrule` hairlines. Multi-column copy uses `.cols2` / `.cols3` (CSS columns with a column rule). `.drop` gives the first paragraph a 3-line drop cap.

**Rules and ornaments.** 5px rule above sections, 1px hairlines between columns and items, double rule under the running header, boxed ads with solid / double / dashed / inverted borders. No rounded corners, no shadows, no gradients beyond the paper tint.

**Illustrations.** Inline SVG line drawings only, stroke `#1D1A15` 2–3px, shaded with the halftone patterns `url(#ht1)` (light), `url(#ht2)` (medium), `url(#ht3)` (dark); bar charts use `url(#hatch-l)` / `url(#hatch)` / solid ink to step from old to new, with one red value. Every figure gets a `.cap` caption (`<b>图</b>` + what/where + credit). Never use photos, emoji or remote images.

**Interactions.**
- *Headline typesetting* — the script splits every `.hl` into `.ch` spans (Latin/number runs stay one unit). On `slidechange` the active page gets `.typeset`, and each character fades in from a 14px blur with a 60ms stagger. Write headlines as plain text (`<br>` allowed); keep them ≤ 24 characters per line.
- *Briefs* — `<button class="brief">` with `.t` title, `.s` one-line summary, `.x > span > span` full text and an empty `.more` (CSS writes 展开全文 ▾ / 收起 ▴). Click toggles it open (accordion within its `.briefs` group); the script prevents focus on mousedown and blurs after click, so ← → keep paging.
- Under `prefers-reduced-motion: reduce` headlines appear at once and briefs open without animation.
- No `data-step` is used; → pages straight through.

## Slide vocabulary

| Page type | Structure | Use |
| --- | --- | --- |
| Front page (头版) | masthead + red kicker + 2-line `.hl` + `.deck-sub` + halftone figure + `.cols2.drop` lead ending "（下转第 2 版）" + briefs sidebar | The announcement |
| News / product (要闻) | `.run` + 3 short columns with `h4` subheads ("（上接第 1 版）") + `table.spec` + expandable "延伸阅读" | What changed |
| Data (数据) | big hatched bar chart (SVG) + caption + side column with line chart and a shaded key-number box | The numbers |
| On site (现场) | full-width perspective line drawing + caption + `.cols3` story | Scene / story |
| Interview (专访) | portrait drawing + Q&A column (`<b>问：</b>` / `<b>答：</b>`) + red-quote pull quote | Voice of the leader |
| Chronicle (大事记) | 4×2 grid of `.ev` cells (year · month · one line), last cell `.hi` | Timeline / year in review |
| Market (市场) | news items + `table.spec` + editor's note box + briefs | Reactions |
| Editorial (社论) | red kicker + `.cols2.drop` + "读者来信" boxes | The stance |
| Classifieds (分类广告) | `.ads` grid of `.ad` boxes (`.inv`, `.dbl`, `.dash`) | Jobs, notices, dates — a light breather |
| Back page (末版) | next-issue headline + `.leader` page index + colophon box with "本期完" | Close |

Typical 10-page order is the one above. A shorter deck keeps front page, one news page, one data page and the back page.

## Linked edits

- **Page numbers.** `.pg-n` (running header and front-page date bar) and `.pg-total` ("今日 10 版") are filled by the script — nothing to edit. But these are manual and must be updated when pages move: the jump lines "（下转第 2 版）" / "（上接第 1 版）", and the back-page index (`.leader` rows "第 N 版 · section · topic").
- **Section names** appear in the running header (`第 N 版 · 要闻`) and the back-page index — change both.
- **Paper identity** — name, special-issue stamp, issue number, date and weekday appear in the masthead, date bar, every `.run` header and the colophon; the weekday must match the date.
- **Facts repeated across pages** — e.g. delivery count (front page, brief, ads), the training programme (brief, interview, editorial, ads, back page), chart numbers (data page, chronicle). Change one, search for the rest.
- **Charts.** Bar height = value / axis max × plot height (example: 475 baseline, 95px per 20 units); move the value label with the bar. Line chart points are in the SVG `points` list.
- **Accent** lives in `--red` and in two inline SVG fills (`#9C2B1F` on the data page); the halftone patterns hard-code `#1D1A15` in the `<defs>` block.

## Print

支持：浏览器打印，每页一张 1920×1080. Headlines print fully set (the typesetting animation is disabled in print); briefs print in their current state — collapsed shows title + summary, so collapse them before printing unless you want one opened. Paper colour and halftones print exactly (`print-color-adjust: exact`); enable "Background graphics" if the browser asks.

## Speaker notes

Put 60–120 characters of notes in `<aside class="notes">…</aside>` as the last child of every page; the kernel hides them and the S presenter window shows them. Mention which brief to click and when.

## Checklist

- [ ] Every page fits 1920×1080 with every brief opened in turn (open each one and check the sidebar's last line stays above the bottom margin).
- [ ] Body text ≥ 28px serif, justified; headlines one line on inner pages, two on the front page.
- [ ] Only `--red` as colour, used ≤ 3 times per page; no rounded corners, shadows or photos.
- [ ] Every figure is inline SVG with a `.cap` caption; charts mark example data "（示例数据）" until real figures are supplied.
- [ ] Jump lines and the back-page index match the actual page order; weekday matches the date.
- [ ] Clicking a brief expands it and ← → still page afterwards; reduced motion shows headlines immediately.
- [ ] Every slide has a unique `data-section`, a `data-title` and `<aside class="notes">`.
