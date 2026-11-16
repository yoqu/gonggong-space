# Gov Report（政企汇报）

Formal work-report deck for state-owned enterprises, government agencies and large corporations — annual reviews, project approval briefings, 请示 to a board. Restrained: warm off-white paper, one red (`#C8102E`), near-black type, a thin gold rule; a fixed letterhead (unit name over a thick red line) and a page footer on every content slide.

`example.html` is a finished 10-slide example (fictional 华川能源集团 2026 数字化转型工作汇报) — study its structure, density and finish, do not copy its copy, numbers or unit names.

## Start here

1. Copy `example.html` to `design/<slug>/index.html`.
2. Keep the whole "Stage kernel" CSS block and the kernel `<script>` byte-for-byte; keep the template `<script>` after it (letterhead/footer injection, task filter, count-up).
3. Keep `<script src="…/deck-toolkit.js">` as the last element of `<head>`; SKILL.md Step 3 rewrites it to `./assets/deck-toolkit.js` and copies the file.
4. Set `data-org` (unit name, shown red in the letterhead) and `data-doc` (report title + classification) on `.deck`, then replace slides one by one.

## Visual system

| Token | Value | Use |
| --- | --- | --- |
| `--red` | `#C8102E` | letterhead rule, section numerals 一、二、, table header, key numbers in text, "滞后" status |
| `--ink` | `#1C1C1C` | titles, body, big numbers |
| `--gray` / `--mute` | `#4F4A44` / `#7A736A` | secondary text, captions, footer |
| `--gold` | `#B08D57` | 2px rule under the red letterhead line and cover bars only |
| `--paper` | `#FBF8F2` | every slide background (tables sit on white) |
| `--ok` / `--doing` | `#2E6B47` / `#9A6A0E` | status pills 已完成 / 推进中, "good" YoY arrows |

- **Fonts:** `--sans` (Helvetica Neue/Arial → `"PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif`) for everything; titles weight 900. `--doc` (FangSong → `"Songti SC","Noto Serif SC",serif`) only for 公文-style paragraphs: the overview paragraph and the 请示事项 page.
- **Grid:** 140px side margins; letterhead at top 52px, content starts at 184px, footer at bottom 44px. Never place content above 184px or below 956px on chrome slides.
- **Type scale:** slide title 56px/900 preceded by red Chinese numeral `一、`; body 28–34px; big numbers 112px; table 28px; footer/letterhead 22–32px.
- **Decoration:** only straight rules — red 8px + gold 2px double line, 1px hairlines between rows. No gradients, no shadows, no rounded corners, no icons beyond the YoY arrow. **No emblems, flags, party/state symbols, real agency names.** Red covers less than ~10% of any content slide.
- **YoY arrows:** green = favourable direction, red = unfavourable (e.g. cost up), regardless of up/down.

## Slide vocabulary

| Class / element | Use |
| --- | --- |
| `.slide.plain.cover` | Cover: red top band, unit name in red, two-line title, red+gold bar, 汇报单位 / 汇报时间 `<dl>`, "内部资料" stamp, faint line art bottom-right. |
| `.ttl` + `.toc` | 汇报提纲: two-column list with red numerals, dotted leaders and page numbers. |
| `.ttl` + `.two` (`.para`, `.prog`, `.pts`) | 工作概述: 公文 paragraph + completion bar on the left, numbered key points (`data-step`) on the right. |
| `.filter` + `table.tb.tasks` | 重点任务完成表: rows carry `data-s="ok|doing|late"`, status pill `.st.ok/.doing/.late`; filter buttons dim non-matching rows. ≤ 6 rows. |
| `.stats` + `.chartrow` | 数据成效: 4 stat cells (`.v > span[data-to][data-dec]` counts up on entry, `.yoy.good/.bad`) + inline SVG grouped bars. |
| `.case` (`.blk`, `.fig`) | 典型案例: 背景 / 做法 / 成效 blocks (`data-step`) + an SVG chart in a white figure frame. |
| `ol.iss` | 问题与不足: 3 boxed numerals, issue title, evidence with bold figures. |
| `.line` + `table.tb.plan` | 下一步计划: timeline (`.node`, `.node.key` filled) that draws on entry + 时间节点 table. |
| `.req` | 请示事项: (一)(二)(三) items, "妥否，请审示。" and signature block. |
| `.slide.plain.end` | 结束页: 汇报完毕 + 恳请各位领导批评指正. |

Typical 10 slides: cover → 提纲 → 概述 → 任务表 → 数据成效 → 典型案例 → 问题与不足 → 计划 → 请示事项 → 结束. Cut 典型案例 or 请示事项 for shorter decks; add a second 案例 or 数据 slide for longer ones.

## Linked edits

- **Slide count / order:** footer "第 NN 页 / 共 NN 页" is computed by the script — nothing to edit; but the 提纲 page numbers (`.toc .p`) and section numerals (`一、` … `七、`) are hand-written: renumber both when adding, removing or reordering sections.
- **Unit name:** `.deck[data-org]` (letterhead), cover `.org`, end page `.org`, signature in `.req .sign` — change all four.
- **Report title / classification:** `.deck[data-doc]`, cover `<h1>`, `<title>`.
- **Task table:** each row's `data-s` must match its pill class; update the "节选 6 / 18 项" subtitle, the overview totals (18 / 15 / 2 / 1) and the `.prog` flex values together.
- **Stats:** the visible number and `data-to` must be equal (the count-up ends on `data-to`); `data-dec` = decimals.
- **Charts:** bar heights in SVG are hand-computed from the axis (example: y = 250 − (v − 50) × 4); change labels and heights together.
- **Plan:** timeline `.node` labels and the table's 时间节点 column must match; `.key` marks the same rows mentioned in notes.
- **Theme colour:** only `:root` variables; inline SVG fills repeat `#C8102E`, `#DCD4C6`, `#BDB4A6` — search-replace them if the red changes.

## Print

支持：浏览器打印，每页一张 1920×1080. All `data-step` items print visible, the filter's dimmed rows print at full opacity, the plan timeline prints fully drawn, and stat numbers print their final values (the markup already holds them). Letterhead and footer are injected by script, so print from a browser, not from a no-JS renderer.

## Speaker notes

`<aside class="notes">…</aside>` as the last child of each slide (60–120 字，口语化，讲清楚这一页要领导记住什么). The kernel hides them; S opens the presenter window that shows them.

## Checklist

- [ ] Every content slide has the injected letterhead and footer; only cover/end carry `.plain`.
- [ ] Section numerals, 提纲 entries and page numbers agree after any reordering.
- [ ] No political emblems, flags or real agency names; unit names are the client's or clearly fictional.
- [ ] Every figure comes from the brief or is a marked placeholder `【待补：…】`; table totals match the overview.
- [ ] Status pills and YoY arrow colours mean the right thing (cost up = red).
- [ ] Body text ≥ 28px; nothing crosses 184px–956px vertical band or the 140px side margins.
- [ ] Clicking a filter button then pressing → still pages (buttons blur themselves).
- [ ] 请示事项 lists concrete decisions (amount, body, date), ends with 妥否，请审示。
