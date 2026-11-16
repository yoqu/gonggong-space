# Signal

Deep navy canvas with bone paper and a single muted-gold accent; institutional with quiet weight.

`example.html` is a finished example of this template — study its structure, density and finish, do not copy its copy.

A single self-contained HTML deck — typography, palette, decorative system and slide vocabulary are tuned together. Mixing layouts across templates breaks the system; stay inside this one.

## At a glance

- **Scheme:** mixed
- **Formality:** high
- **Density:** high
- **Slides in example:** 18

**Best for:** Anything that should feel weighty, considered, and credibly institutional: strategy memos, board presentations, investor decks, consulting deliverables, legal and policy briefs, advisory pitches.

**Avoid for:** Contexts that should feel hot, fast, or intentionally playful — the navy + gold restraint commits to a sober voice.

## Visual system

- **Palette** (`:root` in `example.html`): deep navy `--c-bg #1c2644` (alt `#232f55`), bone paper `--c-bg-light #f0ece3` for `light` slides, bone text `#e2dcd0` with slate greys, one muted-gold accent `--c-accent #c8a870`.
- **Type:** Source Serif 4 for headlines, DM Sans for body, IBM Plex Mono for labels and figures. Sizes are vw tokens (`--sz-*`).
- **Signature:** institutional restraint: hairline rules, gold used for one rule, number or label per slide, generous margins, sidebar chrome.
- **Slide vocabulary** (example order): `slide--cover`, `slide--chapter`, `slide--statement`, `slide--split`, `slide--stats`, `slide--quote`, `slide--list`, `slide--compare`, `slide--editorial`, `slide--dense`, `slide--chart`, `slide--diagram`, `slide--pie`, `slide--pyramid`, `slide--vtimeline`, `slide--cycle`, `slide--end` — each with `dark` (navy) or `light` (bone).
- Mostly navy; use bone `light` slides as deliberate breathers for dense reading.
- The example cover carries an `[Author Name] · [email] · [website]` placeholder line — fill it with the real presenter or remove it.

## Build

1. **Seed:** copy `./example.html` to `design/<slug>/index.html` (it is fully self-contained). This is the only starting point — never write the deck from scratch and never mix in another template's layouts, fonts or colours.
2. **Replace content slide by slide** in this template's own vocabulary: keep each slide's markup and classes, swap in the real headlines, body copy, numbers, names, dates and section labels. Match existing dimensions when swapping image placeholders.
3. **Preserve the design system.** Never substitute fonts, recolour the palette, restructure the layout grid, or strip decorative elements (rules, textures, shapes, illustrated SVGs) — they are the identity.
4. **Adjust length by duplicating layouts.** More content: duplicate the existing slide of the most appropriate layout. Less: drop slides. Update every page number, counter and label to the real count.
5. **Missing layout:** design it from this template's fonts, palette, decorative vocabulary, spacing rhythm and component grammar — never bail to a different template.
6. **Strip the example.** Remove its people, organisations, e-mail addresses, URLs, citations and project names; carry over no third-party marks or links.
7. **Chinese.** `<html lang="zh-CN">`, copy in the creation message's language. Every font stack (including the `--f-*` / font variables in `:root`) ends with a Chinese fallback — sans: `"PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif`; serif: `"Songti SC","Noto Serif SC",serif` (use the serif fallback where the Latin face is a serif). Latin display faces have no CJK glyphs, so check the cover and section headlines with real Chinese text; drop wide letter-spacing and `text-transform: uppercase` tracking on labels that become Chinese (≤ 0.05em).
8. **Runtime.** Navigation is the inline script at the end of the file (←/→, Space and the other keys it already handles). Keep it unmodified; the first slide carries `active`, the script moves it.
9. Add `data-section="<id>"` to every slide.

## Speaker notes

This template has no notes runtime. When notes are requested, put them in `<aside class="notes" hidden>…</aside>` as the last child of each slide — never visible on stage.

## Linked edits

- Slide numbers are hand-written twice per slide — the right-hand `.label` in `.slide-chrome` (`03`) and the right-hand `.label` in `.slide-foot` (`03 / 18`): adding, removing or reordering a slide means rewriting both on every slide; `#slide-counter`, `#nav-dots` and the `#deck` width are built by the script from the `.slide` count.
- Pie slide: the `.pie-donut` inline `conic-gradient` stops, the `.pie-swatch` inline backgrounds (`var(--c-accent)`, `#3d5475`, `#526880`, `#2d3f55`) and the `.pie-item-val` percentages describe the same data — change them together.
- Pyramid slide: `.pyr-level:nth-child(1…5)` sets each level's width and accent tint by position; exactly five levels are styled, a sixth needs its own `nth-child` rule.
- Cycle slide: `.cycle-grid` is a 3×3 grid whose DOM order is spatial (step 01, →, step 02, ↓, empty, ↓, step 04, ←, step 03) — keep all nine children and the clockwise numbering when editing steps.
- Elements with `data-anim` stay at `opacity: 0` until the script puts `.is-active` on their slide, and only `data-delay="0"`–`"6"` are defined.
- When editing the engine script keep `goTo()` (toggles `.is-active`) and the line `window.deck = { slides: slides, get index() { return current; }, go: function (n) { animating = false; goTo(n); } };`.

## Print

Supported. Browser print (Cmd/Ctrl+P → Save as PDF) gives one 1920×1080 page per slide; deck-toolkit.js lays the slides out for print, so keep it loaded. `data-anim` elements print in their final, visible state.

## Checklist

- [ ] Every slide is built from this template's vocabulary; no foreign layouts, fonts or colours.
- [ ] No example copy, names, contacts or links remain (search the file for the example's distinctive names).
- [ ] Every font stack has the Chinese fallback; Chinese headlines render well and nothing overflows the 16:9 stage.
- [ ] Page numbers, counters and the table of contents match the real slides.
- [ ] Charts and diagrams are inline SVG / HTML in this palette, with real or clearly marked placeholder figures.
- [ ] `../../craft/anti-ai-slop.md` and `../../craft/typography.md` pass.

## Source & license

Vendored from upstream MIT-licensed [`zarazhangrui/beautiful-html-templates`](https://github.com/zarazhangrui/beautiful-html-templates/tree/main/templates/signal).

The full upstream MIT license text — including the original copyright notice — ships in this template at [`LICENSE`](./LICENSE) and must be redistributed alongside any copy of `example.html` or any vendored `assets/` runtime.
