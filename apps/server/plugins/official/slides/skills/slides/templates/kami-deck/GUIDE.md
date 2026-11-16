# Kami Deck

Paper-first horizontal swipe deck in the **kami (紙 / 纸)** system — warm parchment, a single ink-blue accent, serif at one weight, no italic, no cool greys.

`example.html` is a finished example of this template (9 slides) — study its structure, density and finish, do not copy its copy.

## Design system

The source of truth is [`./design-system/DESIGN.md`](./design-system/DESIGN.md) with exact values in [`./design-system/tokens.css`](./design-system/tokens.css). Read it before building: tokens, type rules and forbidden colours live there. Slide-specific scale ratios (macro × 1.6, letter-spacing × 0.6 vs. print) are in §3 "Hierarchy" and §5 "Layout Principles" (the "Slides (1920×1080)" part). If the creation message supplies a brand colour or logo, the brand colour replaces ink-blue as the *single* accent (same ≤ 5% coverage rule, pre-blended solid tag tints) and the logo goes in the chrome strip; everything else stays kami.

## What you get

- N viewport-sized slides (6–15 is the sweet spot) laid out horizontally on one transformed flex track.
- **Cover, chapter and end slides** flip to ink-blue (`#1B365D`) with ivory text — the only place the dark theme is used.
- **Content / stats / quote / CTA slides** stay on parchment (`#f5f4ed`) with serif at weight 500.
- **Per-slide chrome strip**: brand mark · deck title · live slide counter (`01 / 09`).
- **Tabular numerals** on every counter, metric and page number.
- Ink-blue progress bar and dot nav.
- **Keyboard / wheel / touch nav**, ESC overview grid, dot indicator (same model as `guizang-ppt`).

## Slide types

| Kind (`data-slide-kind`, class) | Background | Use it for |
| :---------- | :--------- | :-------------------------------------------------------- |
| `cover` (`s-cover dark`) | ink-blue | Title plate. Centered serif title + tagline. |
| `chapter` (`s-chapter dark`) | ink-blue | Numeral chapter divider. |
| `content` (`s-content`) | parchment | Section number + title + body + optional bullets. |
| `stats` (`s-stats`) | parchment | 3–4 metric cells (value · label · sub). |
| `quote` (`s-quote`) | parchment | Pull quote with ink-blue left rule + author signature. |
| `cta` (`s-cta`) | parchment | Closing pitch + 1–2 buttons. |
| `end` (`s-end dark`) | ink-blue | Mega serif kicker word + colophon footer. |

A typical 11-slide deck:

```
1. cover     — ink-blue title plate
2. chapter   — "01 / 为什么是现在"
3. content   — thesis
4. content   — method + bullets
5. stats     — 4 numbers
6. chapter   — "02 / ..."
7. content   — results
8. content   — caveats / next step
9. quote     — a real, attributed quote (from the sources only)
10. cta      — the ask
11. end      — ink-blue kicker
```

## Workflow

1. **Plan** the identity (name, mark, tagline, date/edition) and the typed slide list from the message and attachments; fill gaps with sensible defaults rather than extra questions.
2. **Language stack.** For Chinese decks set `<html lang="zh-CN">` and switch `--serif` to the Chinese stack from `DESIGN.md` §3 (TsangerJinKai02 / Source Han Serif SC / Noto Serif CJK SC / Songti SC), making sure it ends with `"Songti SC","Noto Serif SC",serif`; apply the CN letter-spacing note there. `--sans` equals `--serif`; `--mono` keeps its CJK fallback. The example's Google Fonts link (Source Serif 4 etc.) may stay for Latin text.
3. **Build:** copy `example.html` to `design/<slug>/index.html` and replace content slide by slide, keeping its CSS and runtime script (keyboard / wheel / touch nav, dot indicator, progress bar, ESC overview). Duplicate an existing slide of the right kind for more slides; update the counter total. Use only tokens from `./design-system/`. Add `data-section="<id>"` to every slide.

## Speaker notes

No notes runtime. When notes are requested, put them in `<aside class="notes" hidden>…</aside>` as the last child of each slide — never visible on stage or in the overview.

## Linked edits

- Every slide's `.slide-foot .counter` is hand-written (`03 / 09`): adding, removing or reordering a slide means rewriting the number and the total on every slide (the dots, progress bar and `#deck` width are built by the script from the `.slide` count — don't add them by hand).
- Chapter numbering is hand-written too: `.s-chapter .num` (`01`, `02`) and the content/stats `.head .num` (`01.1`, `01.2`, `01.3`) must be renumbered when you insert or move a chapter.
- The ink-blue ground comes from the `dark` class plus the kind class (`s-cover dark`, `s-chapter dark`, `s-end dark`): when you change a slide's kind, change both classes and its `data-slide-kind` together.
- The `.slide-chrome` strip (brand mark, deck title, section name) is repeated verbatim on every slide — a title change has to be made in all of them.
- A brand accent replaces `--brand` / `--brand-light` and also the raw `rgba(27, 54, 93, …)` fills (progress track, dots), the `#B5C8DC` highlight in `.s-cover h1 .hl` / `.s-end .word .hl`, and the pre-blended `--tag-08/14/22` tints.
- When editing the runtime script keep `applySlide()` (it toggles `.slide.active`, read by the host bridge) and the line `window.deck = { slides: slides, get index() { return idx; }, go: function (n) { applySlide(n); } };`.

## Print

Supported. Browser print (Cmd/Ctrl+P → Save as PDF) gives one 1920×1080 page per slide; deck-toolkit.js lays the slides out for print, so keep it loaded.

## Self-check

- [ ] All cover / chapter / end slides use ink-blue background (`#1B365D`) with ivory text. All other slides are on parchment.
- [ ] Ink-blue covers ≤ 5% of any parchment slide's surface.
- [ ] Slide titles use serif weight 500 only. No italic.
- [ ] All numeric stacks (counter, metrics, page numbers) carry `font-variant-numeric: tabular-nums`.
- [ ] `→` / `Space` / scroll advances one viewport; dot nav and progress bar follow.
- [ ] `Esc` opens the overview grid with scaled thumbnails.
- [ ] At 1080px and 640px wide, cover / content collapse to a single column; dot nav still works.
- [ ] Contrast AA; Chinese text renders in the serif stack, nothing overflows at 16:9.

## Boundaries

- **Do not** introduce a second accent colour. One accent or nothing.
- **Do not** use italic anywhere — emphasis swaps to the accent colour.
- **Do not** use `rgba()` for tag fills; pre-blend over parchment and use the solid hex from `./design-system/DESIGN.md` §2.
- **Do not** add a router. This is a single-file artifact.
- Kami is gradient-free and image-light; hierarchy is carried by type.

## Source

Upstream aesthetic: [`tw93/kami`](https://github.com/tw93/kami) (MIT, © Tw93 and contributors) — kami's slides template documents the macro × 1.6 / micro × 0.6 ratios this template applies. The attribution note at the end of `./design-system/DESIGN.md` must stay with the design system.
