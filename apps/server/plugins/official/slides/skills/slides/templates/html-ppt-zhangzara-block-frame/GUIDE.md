# BlockFrame

Neobrutalist deck with pastel-neon color blocks and chunky black borders.

`example.html` is a finished example of this template — study its structure, density and finish, do not copy its copy.

A single self-contained HTML deck — typography, palette, decorative system and slide vocabulary are tuned together. Mixing layouts across templates breaks the system; stay inside this one.

## At a glance

- **Scheme:** light
- **Formality:** medium-low
- **Density:** high
- **Slides in example:** 10

**Best for:** Anything that should feel pop-graphic and design-led: indie SaaS launches, agency credentials, creative reviews, brand redesigns. Also a strong unexpected pick for tech, finance, or research when the speaker wants to land as confident and contemporary rather than buttoned-up.

**Avoid for:** Contexts that require quiet institutional restraint or traditional weight (regulated disclosures, formal legal briefs).

## Visual system

- **Palette** (`:root`): hot pink `--pink #FE90E8`, sky `--blue #C0F7FE`, lime `--green #99E885`, golden `--yellow #F7CB46`, cream `--cream #FFDC8B`, black `#000`, off-white `--offwhite #FFFDF5`. Every block gets `--border` (4px solid black) and a hard offset `--shadow` (8px 8px 0) — no blur, no gradients, square corners.
- **Type:** Space Grotesk for headings and labels (`nb-heading-xl/lg/md`, `nb-label` tags in each colour), Inter for body in heavy weights.
- **Signature:** an off-white `hero-frame` with `corner-bracket`s, tilted pink square, green circle, yellow bar and dot grids as stickers; coloured `nb-label` chips above every heading; black-bordered cards with offset shadows.
- **Slide vocabulary:** hero frame · two-column intro card + `stat-pill`s · three `feature-card`s · framed SVG line `chart-frame` + `data-box` column · `quote-frame` with stripes · `split-content` numbered list + `visual-box` · horizontal `timeline` of steps · four `stat-card`s · six `team-card`s (avatar initials) · closing `close-frame` with CTA button.

## Build

1. **Seed:** copy `./example.html` to `design/<slug>/index.html` (it links no local assets). This is the only starting point — never write the deck from scratch and never mix in another template's layouts, fonts or colours.
2. **Replace content slide by slide** in this template's own vocabulary: keep each slide's markup and classes, swap in the real headlines, body copy, numbers, names, dates and section labels. Match existing dimensions when swapping image placeholders.
3. **Preserve the design system.** Never substitute fonts, recolour the palette, restructure the layout grid, or strip decorative elements (rules, textures, shapes, illustrated SVGs) — they are the identity.
4. **Adjust length by duplicating layouts.** More content: duplicate the existing slide of the most appropriate layout. Less: drop slides. Update every page number, counter and label to the real count.
5. **Missing layout:** design it from this template's fonts, palette, decorative vocabulary, spacing rhythm and component grammar — never bail to a different template.
6. **Strip the example.** Remove its people, organisations, e-mail addresses, URLs, citations and project names; carry over no third-party marks or links (GitHub, Discord, X, tool credits, etc.).
7. **Chinese.** `<html lang="zh-CN">`, copy in the creation message's language. Every font stack (including the font variables in `:root`) ends with a Chinese fallback — sans: `"PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif`; serif: `"Songti SC","Noto Serif SC",serif` (use the serif fallback where the Latin face is a serif). Google Fonts `<link>`s may stay. Latin display faces have no CJK glyphs, so check the cover and section headlines with real Chinese text; drop wide letter-spacing and `text-transform: uppercase` tracking on labels that become Chinese (≤ 0.05em).
8. **Runtime.** Navigation is the inline script at the end of the file (←/→, Space, swipe, on-page arrow buttons). Keep it unmodified; the first slide carries `active`, the script moves it and fills the `01 / NN` counter from the slide count.
9. Add `data-section="<id>"` to every slide.
10. The attention chart is a hand-drawn inline SVG (`chart-svg`): edit its polyline points and axis labels to the real series rather than replacing it with a library chart.

## Speaker notes

This template has no notes runtime. When notes are requested, put them in `<aside class="notes" hidden>…</aside>` as the last child of each slide — never visible on stage.

## Linked edits

- Each layout's CSS is scoped by a positional class `slide-1` … `slide-10` (e.g. `.slide-7 .timeline-step`, `.slide-8 .stat-card`, `.slide-9 .team-avatar`); these name layouts, not page numbers — a duplicated slide keeps its source's `slide-N` class, and never renumber them after inserting slides or the styles land on the wrong pages.
- Only `.slide.active` is shown (`display: flex`); the first section keeps `active` in the markup, and `#slideCounter` (`01 / 10` in the markup) is rewritten from `slides.length`, so no total is hard-coded in the script.
- Keep the `window.deck = { slides: Array.from(slides), get index() { return currentSlide; }, go: … };` line when editing the script; deck-toolkit.js navigates through it, and the `.nav-btn` buttons call the global `prevSlide()` / `nextSlide()`.
- The `.slide-7` timeline colours its steps by position (`.timeline-step:nth-child(2..4)` → pink/green/yellow, the 4th drops its right margin); a 5th step gets no colour and a trailing gap unless you add matching rules.
- `.slide-8` stat cards tilt by `:nth-child(odd/even)` in a `repeat(4, 1fr)` grid and `.slide-9` team avatars are coloured by `.team-card:nth-child(2..6)` in a `repeat(3, 1fr)` grid — keep 4 stat cards and 6 team cards or extend those rules.
- The `.slide-4` chart SVG hard-codes the palette hex in its bars (`#FE90E8` = `--pink`, `#C0F7FE` = `--blue`, `#99E885` = `--green`); each bar's `y + height` must stay on the 280 baseline and the series spacing (144px per group) lines up with the `S1…S40` x-labels.

## Print

Supported. Browser print (Cmd/Ctrl+P → Save as PDF) gives one 1920×1080 page per slide; deck-toolkit.js lays the slides out for print, so keep it loaded. The counter and arrow buttons are hidden in print.

## Checklist

- [ ] Every slide is built from this template's vocabulary; no foreign layouts, fonts or colours.
- [ ] No example copy, names, contacts or links remain (search the file for the example's distinctive names).
- [ ] Every font stack has the Chinese fallback; Chinese headlines render well and nothing overflows the stage.
- [ ] Page numbers, counters, nav dots and any contents list match the real slides.
- [ ] Charts and diagrams carry real or clearly marked placeholder figures, in this palette.
- [ ] `../../craft/anti-ai-slop.md` and `../../craft/typography.md` pass.

## Source & license

Vendored from upstream MIT-licensed [`zarazhangrui/beautiful-html-templates`](https://github.com/zarazhangrui/beautiful-html-templates/tree/main/templates/block-frame).

The full upstream MIT license text — including the original copyright notice — ships in this template at [`LICENSE`](./LICENSE) and must be redistributed alongside any copy of `example.html` or any vendored `assets/` runtime.
