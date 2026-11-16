# Scatterbrain

Post-it inspired: pastel sticky notes, Caveat handwriting, Shrikhand and Zilla Slab type stack.

`example.html` is a finished example of this template — study its structure, density and finish, do not copy its copy.

A single self-contained HTML deck — typography, palette, decorative system and slide vocabulary are tuned together. Mixing layouts across templates breaks the system; stay inside this one.

## At a glance

- **Scheme:** light
- **Formality:** low
- **Density:** high
- **Slides in example:** 10

**Best for:** Anything that should feel like a designer's whiteboard: student and graduation projects, brainstorms, workshops, design-thinking sessions, ideation pitches, art-direction reviews.

**Avoid for:** Contexts that demand precision and institutional weight — the post-it sticky-note aesthetic intentionally reads as warm and unfinished.

## Visual system

- **Palette** (`:root` in `example.html`): cream `#faf8f3` / paper `#f7f5f0`, ink `#2d2a26` (light `#5c5750`), and sticky-note pastels with deep variants: yellow `#ffe066`, blue `#a5d8ff`, pink `#ffc9c9`, green `#b2f2bb`, orange `#ffcc80`, purple `#d0bfff`.
- **Type:** Shrikhand for display, Zilla Slab for headings and body, Caveat for handwritten notes.
- **Signature:** rotated post-it notes, tape and pins on cork / paper / warm backgrounds (`bg-cork`, `bg-paper`, `bg-warm`), scribbled arrows.
- **Slide vocabulary** (example order): title, big statement, two column, chart / data, three features, timeline, image + text, data diagram, comparison, closing (see the `SLIDE n:` comments; backgrounds rotate cork → paper → warm).
- Keep note rotations small and varied (as in the example); text inside notes must stay legible.

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

- Slides are `display: none` until `.slide.active`; exactly the first `<section class="slide">` keeps `active` in the markup (the script falls back to slide 0 otherwise), and the total is read from the DOM, so no count needs changing.
- Keep the `window.deck = { slides: slides, get index() { return current; }, go: function (n) { go(n); } };` line when editing the script; deck-toolkit.js navigates through it.
- Backgrounds are hand-assigned per slide in a `bg-cork` → `bg-paper` → `bg-warm` rotation; when inserting or removing slides, re-assign the `bg-*` classes so the rotation continues (cover and closing use `bg-cork slide-title`).
- The chart slide's SVG bars hard-code the palette hex (`#ffe066`, `#a5d8ff`, `#ffc9c9`, `#b2f2bb` = `--yellow`/`--blue`/`--pink`/`--green`) while the legend uses `var(--yellow)` etc. — change both together; each bar's `y + height` must stay on the 200 baseline and its value `<text>` sits 10px above the bar top at the bar's centre `x`.
- The data-diagram pie uses hand-computed arc paths (`A80 80`) with the same hex fills repeated in its SVG legend `<rect>`s — recompute the arc end points when the shares change and keep slice and legend fills identical.
- Post-it tilts are positional: `.feature-postit:nth-child(1..3)` set the rotations (a 4th note gets none) and `.timeline-row:nth-child(even)` flips direction, so adding items changes the zig-zag.

## Print

Supported. Browser print (Cmd/Ctrl+P → Save as PDF) gives one 1920×1080 page per slide; deck-toolkit.js lays the slides out for print, so keep it loaded. The `growBar` animation is zeroed for print, so bars print at full height.

## Checklist

- [ ] Every slide is built from this template's vocabulary; no foreign layouts, fonts or colours.
- [ ] No example copy, names, contacts or links remain (search the file for the example's distinctive names).
- [ ] Every font stack has the Chinese fallback; Chinese headlines render well and nothing overflows the 16:9 stage.
- [ ] Page numbers, counters and the table of contents match the real slides.
- [ ] Charts and diagrams are inline SVG / HTML in this palette, with real or clearly marked placeholder figures.
- [ ] `../../craft/anti-ai-slop.md` and `../../craft/typography.md` pass.

## Source & license

Vendored from upstream MIT-licensed [`zarazhangrui/beautiful-html-templates`](https://github.com/zarazhangrui/beautiful-html-templates/tree/main/templates/scatterbrain).

The full upstream MIT license text — including the original copyright notice — ships in this template at [`LICENSE`](./LICENSE) and must be redistributed alongside any copy of `example.html` or any vendored `assets/` runtime.
