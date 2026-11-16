# Coral

Cream and coral on near-black, set in oversized Bebas Neue.

`example.html` is a finished example of this template — study its structure, density and finish, do not copy its copy.

A single self-contained HTML deck — typography, palette, decorative system and slide vocabulary are tuned together. Mixing layouts across templates breaks the system; stay inside this one.

## At a glance

- **Scheme:** mixed
- **Formality:** medium
- **Density:** medium
- **Slides in example:** 10

**Best for:** Anything that should feel warm-graphic and editorial: fashion, beauty, fitness, F&B, lifestyle brands, agency credentials. Just as strong for a creator portfolio, a manifesto, or a tech / research deck that wants warmth and a single bold accent instead of corporate cool.

**Avoid for:** Contexts that should feel quiet or institutional — the coral accent and oversized Bebas Neue commit hard to a confident magazine voice.

## Visual system

- **Palette** (`:root`): coral `--coral #E85D5D` (dark `#D44A4A`), cream `--cream #F5F0E8` (dark `#E8E0D4`), near-black `--black #1A1A1A`, greys `#6B6B6B` / `#B0B0B0`. Slides alternate cream, coral and black grounds.
- **Type:** Bebas Neue for all-caps condensed headlines and big numbers, Inter for body and small tracked labels.
- **Signature:** coral zigzag band on cover/closing, `NN / Section` labels, thin `accent-line` rules, a giant quote mark, pattern-overlay stat slide.
- **Slide vocabulary:** cover (zigzag + stacked title + meta row) · big statement · numbered two-column list · Chart.js funnel chart + stat sidebar · full-bleed single stat · three `column-card`s (letter icon + stat) · split quote · horizontal phase `timeline` · four `team-member` tiles (initials) · closing with contact block.

## Build

1. **Seed:** copy `./example.html` to `design/<slug>/index.html` (it links no local assets). This is the only starting point — never write the deck from scratch and never mix in another template's layouts, fonts or colours.
2. **Replace content slide by slide** in this template's own vocabulary: keep each slide's markup and classes, swap in the real headlines, body copy, numbers, names, dates and section labels. Match existing dimensions when swapping image placeholders.
3. **Preserve the design system.** Never substitute fonts, recolour the palette, restructure the layout grid, or strip decorative elements (rules, textures, shapes, illustrated SVGs) — they are the identity.
4. **Adjust length by duplicating layouts.** More content: duplicate the existing slide of the most appropriate layout. Less: drop slides. Update every page number, counter and label to the real count.
5. **Missing layout:** design it from this template's fonts, palette, decorative vocabulary, spacing rhythm and component grammar — never bail to a different template.
6. **Strip the example.** Remove its people, organisations, e-mail addresses, URLs, citations and project names; carry over no third-party marks or links (GitHub, Discord, X, tool credits, etc.).
7. **Chinese.** `<html lang="zh-CN">`, copy in the creation message's language. Every font stack (including the font variables in `:root`) ends with a Chinese fallback — sans: `"PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif`; serif: `"Songti SC","Noto Serif SC",serif` (use the serif fallback where the Latin face is a serif). Google Fonts `<link>`s may stay. Latin display faces have no CJK glyphs, so check the cover and section headlines with real Chinese text; drop wide letter-spacing and `text-transform: uppercase` tracking on labels that become Chinese (≤ 0.05em).
8. **Runtime.** Navigation is the inline script at the end of the file (←/→, Space, prev/next arrows). Keep it unmodified; the first slide carries `active`; dots and counter are built from the slide count.
9. Add `data-section="<id>"` to every slide.
10. The growth chart uses Chart.js from the jsDelivr CDN (`chart.js@4.4.7`), data in the script at the end (`growthChart`). Replace labels and values with real figures; keep coral/black styling.
11. Bebas Neue has no CJK glyphs: Chinese headlines fall back to the sans stack — set them bold and drop the wide letter-spacing.

## Speaker notes

This template has no notes runtime. When notes are requested, put them in `<aside class="notes" hidden>…</aside>` as the last child of each slide — never visible on stage.

## Linked edits

- Each layout is styled through its class `.slide-1` … `.slide-10` (ground colour, grid and all child rules): the number is a layout id, not a page number — a duplicated slide keeps its `slide-N` class, and reordering moves the class with the markup.
- `updateNav()` decides dark nav chrome from a hard-coded class list (`slide-2`, `slide-4`, `slide-6`, `slide-8` — the cream layouts); a new cream-ground layout class must be added there or the dots, counter and arrows stay pale on cream.
- `.section-label` numbering is hand-written (`01 / Market Moment`, `02 / Pipeline Math`, `03 / Launch Calendar`); renumber in order after adding, removing or reordering sections.
- The funnel slide's `initChart()` (`#growthChart`) holds the labels, both `datasets` and literal colours `#E85D5D` / `#1A1A1A` / `#6B6B6B` / `#B0B0B0`; the `.header-right .stat-number` and `.chart-sidebar .value` figures beside it must agree with that data.
- Palette literals outside `:root`: the cover `.zigzag-layer` SVG strokes `#1A1A1A`, the closing `.zigzag-deco` path `fill="black"`, and the chart colours above.
- When editing the script keep `updateNav()` (toggles `.slide.active`) and the line `window.deck = { slides: Array.from(slides), get index() { return currentSlide; }, go: function (n) { goToSlide(n); } };`; `#slideCounter` text and the dots are generated.

## Print

Supported. Browser print (Cmd/Ctrl+P → Save as PDF) gives one 1920×1080 page per slide; deck-toolkit.js lays the slides out for print, so keep it loaded. The Chart.js funnel is a canvas drawn at the on-screen size and 300 ms after load — print from a desktop-size window once it has rendered.

## Checklist

- [ ] Every slide is built from this template's vocabulary; no foreign layouts, fonts or colours.
- [ ] No example copy, names, contacts or links remain (search the file for the example's distinctive names).
- [ ] Every font stack has the Chinese fallback; Chinese headlines render well and nothing overflows the stage.
- [ ] Page numbers, counters, nav dots and any contents list match the real slides.
- [ ] Charts and diagrams carry real or clearly marked placeholder figures, in this palette.
- [ ] `../../craft/anti-ai-slop.md` and `../../craft/typography.md` pass.

## Source & license

Vendored from upstream MIT-licensed [`zarazhangrui/beautiful-html-templates`](https://github.com/zarazhangrui/beautiful-html-templates/tree/main/templates/coral).

The full upstream MIT license text — including the original copyright notice — ships in this template at [`LICENSE`](./LICENSE) and must be redistributed alongside any copy of `example.html` or any vendored `assets/` runtime.
