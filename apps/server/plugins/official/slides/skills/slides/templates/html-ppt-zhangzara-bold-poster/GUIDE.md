# Bold Poster

Editorial poster aesthetic with massive Shrikhand display and a single fire-engine red accent.

`example.html` is a finished example of this template — study its structure, density and finish, do not copy its copy.

A single self-contained HTML deck — typography, palette, decorative system and slide vocabulary are tuned together. Mixing layouts across templates breaks the system; stay inside this one.

## At a glance

- **Scheme:** light
- **Formality:** medium
- **Density:** low
- **Slides in example:** 10

**Best for:** Anything that should land like a magazine cover: brand manifestos, founder vision decks, editorial / cultural pitches, creative reviews. Excellent any time you want a few words to feel like a poster — including unexpected fits like a tech keynote or a finance manifesto that wants to be quotable.

**Avoid for:** Decks that need to communicate dense information per slide — the layout is built around a few large statements, not paragraphs of detail.

## Visual system

- **Palette** (`:root`): white `--bg #FFFFFF`, warm light `--light #F5F2EF`, near-black `--dark #1C1410`, fire-engine red `--red #D8000F`. Red is the only colour: one word of the cover, the full-bleed `slide-red`, small labels.
- **Type:** Shrikhand for the giant stacked display words, Libre Baskerville (italic) for taglines and pull quotes, Space Grotesk for labels, numbers and body.
- **Signature:** three-line stacked hero title (dark / red / dark), italic serif meta lines, tiny tracked red tag labels, huge numerals in stat slides, a thin red progress bar.
- **Slide vocabulary:** `slide-hero` · `slide-red` (full-bleed red quote) · `slide-summary` (columns + numbered highlights) · `slide-financial` (2×2 `fin-grid` of big numbers) · `slide-stat` (one giant stat + supporting row) · `slide-services` (three `svc-card`s with bullets) · `slide-roadmap` (phase label + title + bullets) · `slide-pillars` (numbered pillars) · `slide-global` (TAM card + `gc-stats`) · `slide-close` (the ask + links).

## Build

1. **Seed:** copy `./example.html` to `design/<slug>/index.html` (it links no local assets). This is the only starting point — never write the deck from scratch and never mix in another template's layouts, fonts or colours.
2. **Replace content slide by slide** in this template's own vocabulary: keep each slide's markup and classes, swap in the real headlines, body copy, numbers, names, dates and section labels. Match existing dimensions when swapping image placeholders.
3. **Preserve the design system.** Never substitute fonts, recolour the palette, restructure the layout grid, or strip decorative elements (rules, textures, shapes, illustrated SVGs) — they are the identity.
4. **Adjust length by duplicating layouts.** More content: duplicate the existing slide of the most appropriate layout. Less: drop slides. Update every page number, counter and label to the real count.
5. **Missing layout:** design it from this template's fonts, palette, decorative vocabulary, spacing rhythm and component grammar — never bail to a different template.
6. **Strip the example.** Remove its people, organisations, e-mail addresses, URLs, citations and project names; carry over no third-party marks or links (GitHub, Discord, X, tool credits, etc.).
7. **Chinese.** `<html lang="zh-CN">`, copy in the creation message's language. Every font stack (including the font variables in `:root`) ends with a Chinese fallback — sans: `"PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif`; serif: `"Songti SC","Noto Serif SC",serif` (use the serif fallback where the Latin face is a serif). Google Fonts `<link>`s may stay. Latin display faces have no CJK glyphs, so check the cover and section headlines with real Chinese text; drop wide letter-spacing and `text-transform: uppercase` tracking on labels that become Chinese (≤ 0.05em).
8. **Runtime.** Navigation is the inline script at the end of the file (←/→, ↑/↓, Space, PgUp/PgDn, swipe). Keep it unmodified; the first slide carries `active`; keep `data-index` sequential from 0.
9. Add `data-section="<id>"` to every slide.
10. Shrikhand has no CJK glyphs: Chinese hero words fall back to the sans stack, so keep hero lines to 2–4 characters each and check the stacked lockup still reads as a poster.

## Speaker notes

This template has no notes runtime. When notes are requested, put them in `<aside class="notes" hidden>…</aside>` as the last child of each slide — never visible on stage.

## Linked edits

- Only `.slide.active` is visible (the rest sit at `opacity: 0`), so the first `.slide` inside `#slides` must keep `active` in the markup and every added slide must be a `.slide` child of `#slides`.
- The inline script's `window.deck = { slides: Array.from(slides), get index() …, go: … }` line is how deck-toolkit.js drives overview, presenter window and jump-to-slide — keep it whenever you edit the script.
- `#counter` and the `#progress` width are recomputed from `slides.length`, so adding or removing slides needs no total change in the script; `data-index` is not read by it but keep it sequential from 0.
- Card counts are tied to fixed grids: `.summary-highlights` and `.fin-grid` are `repeat(3, 1fr)` (3 `summary-hl`, 6 `fin-cell`), `.svc-grid` and `.rm-inner` are `1fr 1fr` (4 `svc-card`, 4 `rm-phase`) — change the column count together with the number of items.
- `.slide-pillars` is a flex row of 3 `.pillar`s: `.pillar:nth-child(odd)` paints the `--light` stripes and `.pillar:last-child` drops the right rule, and the `p-num` numerals (`01`–`03`) are typed by hand — renumber them when adding or removing a pillar.
- Colour lives only in `:root` (`--red`, `--dark`, `--light`, `--bg`); no hex is repeated elsewhere, so re-tint through the variables only.

## Print

Supported. Browser print (Cmd/Ctrl+P → Save as PDF) gives one 1920×1080 page per slide; deck-toolkit.js lays the slides out for print, so keep it loaded. The `active` class is copied to every slide while printing, so all slides print fully visible; the "Click or Swipe" `.hint` and the counter are hidden.

## Checklist

- [ ] Every slide is built from this template's vocabulary; no foreign layouts, fonts or colours.
- [ ] No example copy, names, contacts or links remain (search the file for the example's distinctive names).
- [ ] Every font stack has the Chinese fallback; Chinese headlines render well and nothing overflows the stage.
- [ ] Page numbers, counters, nav dots and any contents list match the real slides.
- [ ] Charts and diagrams carry real or clearly marked placeholder figures, in this palette.
- [ ] `../../craft/anti-ai-slop.md` and `../../craft/typography.md` pass.

## Source & license

Vendored from upstream MIT-licensed [`zarazhangrui/beautiful-html-templates`](https://github.com/zarazhangrui/beautiful-html-templates/tree/main/templates/bold-poster).

The full upstream MIT license text — including the original copyright notice — ships in this template at [`LICENSE`](./LICENSE) and must be redistributed alongside any copy of `example.html` or any vendored `assets/` runtime.
