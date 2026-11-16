# Daisy Days

Cheerful pastel deck with hand-drawn daisies, stars, and rainbows. Friendly, soft, and warm.

`example.html` is a finished example of this template — study its structure, density and finish, do not copy its copy.

A single self-contained HTML deck — typography, palette, decorative system and slide vocabulary are tuned together. Mixing layouts across templates breaks the system; stay inside this one.

## At a glance

- **Scheme:** light
- **Formality:** low
- **Density:** medium
- **Slides in example:** 10

**Best for:** Anything that should feel friendly, soft, and joyful: educational content, kids and family, wellness programs, community workshops, creator portfolios for craft / illustration. Also lovely for an unexpected playful internal kickoff, a wedding planning deck, or any moment where warmth is the message — including across tech or business contexts.

**Avoid for:** Contexts where the audience explicitly expects authority and precision — the hand-drawn pastel SVG decorations are the opposite of buttoned-up.

## Visual system

- **Palette** (`:root`): cream `--cream #F5F0E6`, turquoise `#7ECDC0`, soft pink `#F7C8D4`, butter `#FDE68A`, mint `#A8E6CF`, lavender `#D4A5E8`, peach `#FFCBA4`, sky `#A8D8F0`, coral `#F8635F`, text `#2D2D2D`. Ink-black 3px borders (`--border-width`), 20/28px radii, chunky 6px offset shadow (`--shadow`).
- **Type:** Fredoka One for rounded display headings, Quicksand for body.
- **Signature:** inline SVG daisies, stars, clouds, sun and rainbow (`deco deco-*`) tucked in corners; rounded outlined cards with offset shadows; pill counter at the bottom.
- **Slide vocabulary:** `slide-title` · `slide-welcome` (framed list + rainbow) · `slide-weekly` (three day cards with coloured headers) · `slide-timeline` (numbered demo steps) · `slide-chart-bar` (inline SVG bar chart + legend) · `slide-cards` (four lettered info cards) · `slide-quote` · `slide-team` (four role avatars) · `slide-process` (numbered loop with arrows) · `slide-donut` (SVG donut + key figures).

## Build

1. **Seed:** copy `./example.html` to `design/<slug>/index.html` (it links no local assets). This is the only starting point — never write the deck from scratch and never mix in another template's layouts, fonts or colours.
2. **Replace content slide by slide** in this template's own vocabulary: keep each slide's markup and classes, swap in the real headlines, body copy, numbers, names, dates and section labels. Match existing dimensions when swapping image placeholders.
3. **Preserve the design system.** Never substitute fonts, recolour the palette, restructure the layout grid, or strip decorative elements (rules, textures, shapes, illustrated SVGs) — they are the identity.
4. **Adjust length by duplicating layouts.** More content: duplicate the existing slide of the most appropriate layout. Less: drop slides. Update every page number, counter and label to the real count.
5. **Missing layout:** design it from this template's fonts, palette, decorative vocabulary, spacing rhythm and component grammar — never bail to a different template.
6. **Strip the example.** Remove its people, organisations, e-mail addresses, URLs, citations and project names; carry over no third-party marks or links (GitHub, Discord, X, tool credits, etc.).
7. **Chinese.** `<html lang="zh-CN">`, copy in the creation message's language. Every font stack (including the font variables in `:root`) ends with a Chinese fallback — sans: `"PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif`; serif: `"Songti SC","Noto Serif SC",serif` (use the serif fallback where the Latin face is a serif). Google Fonts `<link>`s may stay. Latin display faces have no CJK glyphs, so check the cover and section headlines with real Chinese text; drop wide letter-spacing and `text-transform: uppercase` tracking on labels that become Chinese (≤ 0.05em).
8. **Runtime.** Navigation is the inline script at the end of the file (←/→, ↑/↓, Space, PgUp/PgDn, Home/End). Keep it unmodified; slides are a vertical scroll-snap column navigated by `scrollIntoView` on `id="slide-N"`, with hard-coded nav dots: when adding or removing slides keep the `slide-N` ids sequential, keep one `.nav-dot[data-slide=N]` per slide, and change the hard-coded `' / 10'` in the script and the initial counter text to the real total.
9. Add `data-section="<id>"` to every slide.
10. The decorative SVGs are reusable as is (copy an existing `deco` element to place another). They carry an upstream tool-credit comment; leave or drop it, but do not add third-party logos or links.
11. Bar and donut charts are hand-written inline SVG — edit bar heights, labels and arc lengths to the real numbers.

## Speaker notes

This template has no notes runtime. When notes are requested, put them in `<aside class="notes" hidden>…</aside>` as the last child of each slide — never visible on stage.

## Linked edits

- The script hard-codes the total three times — `if(current<10)` in the next-slide branch, `goToSlide(10)` on End, and `counter.textContent=id+' / 10'` in the IntersectionObserver — plus the initial `1 / 10` in `#slideCounter`; change all four to the real slide count or slides past 10 cannot be reached by keyboard.
- Each `<section class="slide">` needs `id="slide-N"` numbered 1…N in order: `goToSlide(n)` scrolls to `#slide-n` and the observer derives the page number from the id.
- `#navDots` holds one hand-written `.nav-dot data-slide="N"` per slide (the first carries `active`); add or remove a dot with every slide, because both the keyboard's "current slide" and `window.deck.index` are read from the active dot.
- Keep the `window.deck={slides:…,get index(){…},go:n=>goToSlide(n+1)}` line when editing the script; deck-toolkit.js navigates through it.
- `.slide-chart-bar` is inline SVG: each `<rect>` `fill` must match the `.legend-swatch` inline `background` of its legend row, its `y + height` must stay on the 250 baseline, and the value `<text>` sits 8px above the bar top.
- `.slide-donut` arcs are `<circle>`s with `stroke-dasharray="<len> 377"` and a cumulative negative `stroke-dashoffset` (the sum of previous lengths); every arc `stroke` must match its `.d-legend-swatch` background.
- Chart and decoration colours are hex literals inside the SVGs (e.g. `#F8635F`, `#8DE3B7`, `#85C5FE`, `#FDE366`, `#D4A5E8`), not `:root` variables, so changing `--coral` and friends does not re-tint them.

## Print

Supported. Browser print (Cmd/Ctrl+P → Save as PDF) gives one 1920×1080 page per slide; deck-toolkit.js lays the slides out for print, so keep it loaded. The scroll-snap container is flattened for print and the nav dots and counter are hidden.

## Checklist

- [ ] Every slide is built from this template's vocabulary; no foreign layouts, fonts or colours.
- [ ] No example copy, names, contacts or links remain (search the file for the example's distinctive names).
- [ ] Every font stack has the Chinese fallback; Chinese headlines render well and nothing overflows the stage.
- [ ] Page numbers, counters, nav dots and any contents list match the real slides.
- [ ] Charts and diagrams carry real or clearly marked placeholder figures, in this palette.
- [ ] `../../craft/anti-ai-slop.md` and `../../craft/typography.md` pass.

## Source & license

Vendored from upstream MIT-licensed [`zarazhangrui/beautiful-html-templates`](https://github.com/zarazhangrui/beautiful-html-templates/tree/main/templates/daisy-days).

The full upstream MIT license text — including the original copyright notice — ships in this template at [`LICENSE`](./LICENSE) and must be redistributed alongside any copy of `example.html` or any vendored `assets/` runtime.
