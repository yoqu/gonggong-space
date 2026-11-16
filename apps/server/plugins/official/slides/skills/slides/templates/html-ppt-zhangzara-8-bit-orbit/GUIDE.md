# 8-Bit Orbit

Pixel-art neon arcade aesthetic on a deep navy void.

`example.html` is a finished example of this template — study its structure, density and finish, do not copy its copy.

A single self-contained HTML deck — typography, palette, decorative system and slide vocabulary are tuned together. Mixing layouts across templates breaks the system; stay inside this one.

## At a glance

- **Scheme:** dark
- **Formality:** low
- **Density:** medium
- **Slides in example:** 10

**Best for:** Anything that should feel like a CRT screen at 2am: cyberpunk, gaming, web3, indie dev tools, hackathon demos. Just as good for a tech talk that wants to lean into nostalgic-digital craft, a synthwave brand deck, or a creative review that wants to feel like a console.

**Avoid for:** Contexts where the dark neon palette would actively work against the message — quiet institutional finance disclosures, healthcare patient-facing materials, traditional luxury.

## Visual system

- **Palette** (`:root`): void `--dark-void #0A0E27`, deep navy `--deep-navy #0F1B3D`, neon pink `--neon-pink #F0A6CA`, neon cyan `--neon-cyan #5EDCF4`, neon yellow `--neon-yellow #F4D03F`, soft lavender `--soft-lavender #E2D5F2`. Each slide's grid tint (`bg-grid`, `bg-grid-pink`, `bg-grid-cyan`, `bg-grid-lavender`) rotates through the neons.
- **Type:** Tektur (`--font-display`, boxy display with stepped pixel shadow), Chakra Petch (`--font-body`), Space Mono (`--font-mono`) for labels, counters and buttons.
- **Signature:** `scanlines`, `grain`, `crt-glow` overlays, a `starfield` and `pixel-particles` on hero slides, pixel-corner brackets (`pixel-corners`), square pixel badges and `pixel-btn` buttons, a `pixel-label` kicker above every headline.
- **Slide vocabulary** (example order): hero with `pixel-hero-text` + `hero-badges` · `split-layout` with a pixel avatar · `feature-grid` of four `feature-card`s (circle/cross/cube/diamond icons) · vertical `pixel-bar-chart` · horizontal `pixel-hbar-chart` · `timeline-container` of steps · `stats-grid` count-up stats · `quote-container` · three-up `tier-grid` (one `featured`) · closing `cta-content` over a `pixel-landscape`.

## Build

1. **Seed:** copy `./example.html` to `design/<slug>/index.html` (it links no local assets). This is the only starting point — never write the deck from scratch and never mix in another template's layouts, fonts or colours.
2. **Replace content slide by slide** in this template's own vocabulary: keep each slide's markup and classes, swap in the real headlines, body copy, numbers, names, dates and section labels. Match existing dimensions when swapping image placeholders.
3. **Preserve the design system.** Never substitute fonts, recolour the palette, restructure the layout grid, or strip decorative elements (rules, textures, shapes, illustrated SVGs) — they are the identity.
4. **Adjust length by duplicating layouts.** More content: duplicate the existing slide of the most appropriate layout. Less: drop slides. Update every page number, counter and label to the real count.
5. **Missing layout:** design it from this template's fonts, palette, decorative vocabulary, spacing rhythm and component grammar — never bail to a different template.
6. **Strip the example.** Remove its people, organisations, e-mail addresses, URLs, citations and project names; carry over no third-party marks or links (GitHub, Discord, X, tool credits, etc.).
7. **Chinese.** `<html lang="zh-CN">`, copy in the creation message's language. Every font stack (including the font variables in `:root`) ends with a Chinese fallback — sans: `"PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif`; serif: `"Songti SC","Noto Serif SC",serif` (use the serif fallback where the Latin face is a serif). Google Fonts `<link>`s may stay. Latin display faces have no CJK glyphs, so check the cover and section headlines with real Chinese text; drop wide letter-spacing and `text-transform: uppercase` tracking on labels that become Chinese (≤ 0.05em).
8. **Runtime.** Navigation is the inline script at the end of the file (↑/↓, ←/→, Space, Home/End, swipe and wheel; slides stack vertically and the container moves by `translateY`). Keep it unmodified; but it hard-codes `const totalSlides = 10;` — set it to the real slide count, otherwise the counter and nav dots lie and the last slides are unreachable.
9. Add `data-section="<id>"` to every slide.
10. Charts and stats animate from data attributes: bars use `data-height` / `data-width` + `data-value`, stats count up from `data-target` (optional `data-suffix`). Change the attributes, not just the visible text (it starts at 0).
11. Keep the `data-slide` numbers on each `<section>` sequential.

## Speaker notes

This template has no notes runtime. When notes are requested, put them in `<aside class="notes" hidden>…</aside>` as the last child of each slide — never visible on stage.

## Linked edits

- `const totalSlides = 10;` at the top of the script drives the nav-dot loop, the `#slideCounter` text, the End key and the bounds check in `goToSlide`; set it to the real slide count (and the initial `01 / 10` in `#slideCounter`), otherwise slides past 10 are unreachable.
- Chart and stat animations are wired to slide positions in `triggerAnimations`: `slideIndex === 3` fills `#barChart`, `=== 4` fills `#hbarChart`, `=== 6` counts up `#statsGrid`; moving, inserting or removing slides before them means updating those indices, or the charts stay at 0.
- Those ids are unique, so only one `#barChart`, `#hbarChart` and `#statsGrid` can exist; values come from `data-height` + `data-value`, `data-width` and `data-target` (+ `data-suffix`), not from the visible text.
- Decoration is generated by id: `generateStars('starfield1'|'starfield4'|'starfield7'|'starfield10')`, `generateParticles('particles1'|'particles10')` and `generateLandscape()` on `#landscape10` — a duplicated hero slide needs a new id plus a matching call, or its starfield stays empty.
- Keep `data-slide` on each `<section>` sequential, and keep the `window.deck = { slides: …, get index() { return currentSlide; }, go: function (n) { goToSlide(n); } };` line when editing the script.
- Neon colours are `:root` variables reused by the JS particle call (`var(--neon-cyan)`, `var(--neon-pink)`, `var(--neon-yellow)`) and the `bg-grid*` tints; re-tint through `:root`, not per element.
- The timeline alternates sides by `.timeline-event:nth-child(odd/even)`, so inserting an event flips every event after it.

## Print

Supported. Browser print (Cmd/Ctrl+P → Save as PDF) gives one 1920×1080 page per slide; deck-toolkit.js lays the slides out for print, so keep it loaded. The bar chart, horizontal bar chart and stat counters are filled by JS only while their slide is current (other slides reset them to `0%` / `0`), so in the PDF only the slide that was current when printing shows its figures — the other chart slides print with empty bars and `0` stats.

## Checklist

- [ ] Every slide is built from this template's vocabulary; no foreign layouts, fonts or colours.
- [ ] No example copy, names, contacts or links remain (search the file for the example's distinctive names).
- [ ] Every font stack has the Chinese fallback; Chinese headlines render well and nothing overflows the stage.
- [ ] Page numbers, counters, nav dots and any contents list match the real slides.
- [ ] Charts and diagrams carry real or clearly marked placeholder figures, in this palette.
- [ ] `../../craft/anti-ai-slop.md` and `../../craft/typography.md` pass.

## Source & license

Vendored from upstream MIT-licensed [`zarazhangrui/beautiful-html-templates`](https://github.com/zarazhangrui/beautiful-html-templates/tree/main/templates/8-bit-orbit).

The full upstream MIT license text — including the original copyright notice — ships in this template at [`LICENSE`](./LICENSE) and must be redistributed alongside any copy of `example.html` or any vendored `assets/` runtime.
