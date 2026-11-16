# Grove

Forest-green canvas with cream type, classical Playfair serifs, and a single rust accent.

`example.html` is a finished example of this template — study its structure, density and finish, do not copy its copy.

A single self-contained HTML deck — typography, palette, decorative system and slide vocabulary are tuned together. Mixing layouts across templates breaks the system; stay inside this one.

## At a glance

- **Scheme:** mixed
- **Formality:** medium-high
- **Density:** medium
- **Slides in example:** 12

**Best for:** Anything that should feel organic, considered, and grown-up: sustainability and wellness brands, outdoor / nature products, wineries and restaurants, literary or arts decks, advisory deliverables, bilingual EN/CN reports. Also a calm, distinctive choice for tech, research, or business decks that want patience over urgency.

**Avoid for:** Decks that need neon energy or rapid-fire pop — the forest-green canvas and Playfair serif commit to a slow, classical voice.

## Visual system

- **Palette** (`:root`): forest `--c-bg #192b1b` (alt `#1e3221`), bone type `--c-fg #d4cfbf` with alpha greys, cream paper `--c-bg-light #e8e4d6` for `light` slides, rust accent `--c-accent #c8524a` (one italic word, small kickers, the lit bar).
- **Type:** Playfair Display for headlines (italic rust emphasis), Jost light for body, JetBrains Mono for chrome and labels; Noto Serif SC / Noto Sans SC are already loaded for Chinese.
- **Signature:** left `grove-sidebar` with the slide's section name, mono `slide-chrome` header and `NN / NN` `slide-foot`, short rust rules, faint giant `grove-num` numerals, staggered `data-anim` entrances; slides alternate `dark` and `light`.
- **Slide vocabulary** (`slide--*`): `cover` · `chapter` (big numeral + headline) · `statement` · `split` (text + image placeholder) · `stats` (three `grove-stat`s) · `list` · `quote` · `compare` (status quo vs proposal) · `chart` (CSS bar columns with source) · `end`.

## Build

1. **Seed:** copy `./example.html` to `design/<slug>/index.html` (it links no local assets). This is the only starting point — never write the deck from scratch and never mix in another template's layouts, fonts or colours.
2. **Replace content slide by slide** in this template's own vocabulary: keep each slide's markup and classes, swap in the real headlines, body copy, numbers, names, dates and section labels. Match existing dimensions when swapping image placeholders.
3. **Preserve the design system.** Never substitute fonts, recolour the palette, restructure the layout grid, or strip decorative elements (rules, textures, shapes, illustrated SVGs) — they are the identity.
4. **Adjust length by duplicating layouts.** More content: duplicate the existing slide of the most appropriate layout. Less: drop slides. Update every page number, counter and label to the real count.
5. **Missing layout:** design it from this template's fonts, palette, decorative vocabulary, spacing rhythm and component grammar — never bail to a different template.
6. **Strip the example.** Remove its people, organisations, e-mail addresses, URLs, citations and project names; carry over no third-party marks or links (GitHub, Discord, X, tool credits, etc.).
7. **Chinese.** `<html lang="zh-CN">`, copy in the creation message's language. Every font stack (including the font variables in `:root`) ends with a Chinese fallback — sans: `"PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif`; serif: `"Songti SC","Noto Serif SC",serif` (use the serif fallback where the Latin face is a serif). Google Fonts `<link>`s may stay. Latin display faces have no CJK glyphs, so check the cover and section headlines with real Chinese text; drop wide letter-spacing and `text-transform: uppercase` tracking on labels that become Chinese (≤ 0.05em).
8. **Runtime.** Navigation is the inline script at the end of the file (←/→, ↑/↓, swipe). Keep it unmodified; slides sit side by side and the track moves by `translateX`; dots and counter come from the slide count. Footer `NN / NN` labels are static — renumber them by hand.
9. Add `data-section="<id>"` to every slide.
10. The `img-placeholder` stands in for a photo or map: keep it as a labelled placeholder or use an image the user supplied.

## Speaker notes

This template has no notes runtime. When notes are requested, put them in `<aside class="notes" hidden>…</aside>` as the last child of each slide — never visible on stage.

## Linked edits

- Page numbers are typed by hand in two places per slide: the right-hand label in `.slide-chrome` (`03`) and the `.slide-foot` label (`03 / 12`); after adding, removing or reordering slides renumber both on every slide and change the `/ 12` total.
- Chapter slides (`slide--chapter`) carry their number twice — the watermark `.grove-num` (`01`) and the `.chapter-num` kicker (`01 / Context`) — and chapter numbers must run in order across the deck.
- From slide 3 on, slides alternate `dark` and `light` (cover, chapters and end are always `dark`); when inserting a slide pick the class that keeps the alternation, and on `light` slides the foot label uses `style="color: var(--c-fg-light-2)"` instead of the `muted` class used on `dark` slides.
- Content is hidden (`[data-anim] { opacity: 0 }`) until `.slide.is-active` plays it, so every animated element needs a `data-anim` of `fade-up`, `fade-in`, `reveal-right`, `reveal-left` or `scale-in` and a `data-delay` of 0–6 — any other value stays invisible.
- The `.slide--chart` bars are CSS: each `.bar-fill` has a hand-set `style="height: …vh"` that must be rescaled together with its `.bar-val` text so bar heights stay proportional.
- `#nav-dots`, `#slide-counter` and the track width (`total + "00vw"`) are built from the slide count, so the script needs no total change; keep its `window.deck = { slides: slides, get index() { return current; }, go: … };` line when editing it.

## Print

Supported. Browser print (Cmd/Ctrl+P → Save as PDF) gives one 1920×1080 page per slide; deck-toolkit.js lays the slides out for print, so keep it loaded. `is-active` is copied to every slide and entrance animations are zeroed, so each `data-anim` element prints in its final, visible state.

## Checklist

- [ ] Every slide is built from this template's vocabulary; no foreign layouts, fonts or colours.
- [ ] No example copy, names, contacts or links remain (search the file for the example's distinctive names).
- [ ] Every font stack has the Chinese fallback; Chinese headlines render well and nothing overflows the stage.
- [ ] Page numbers, counters, nav dots and any contents list match the real slides.
- [ ] Charts and diagrams carry real or clearly marked placeholder figures, in this palette.
- [ ] `../../craft/anti-ai-slop.md` and `../../craft/typography.md` pass.

## Source & license

Vendored from upstream MIT-licensed [`zarazhangrui/beautiful-html-templates`](https://github.com/zarazhangrui/beautiful-html-templates/tree/main/templates/grove).

The full upstream MIT license text — including the original copyright notice — ships in this template at [`LICENSE`](./LICENSE) and must be redistributed alongside any copy of `example.html` or any vendored `assets/` runtime.
