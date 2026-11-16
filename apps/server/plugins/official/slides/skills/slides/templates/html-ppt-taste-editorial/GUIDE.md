# Editorial Minimalism

A 16:9 deck for the briefs that hate neon: investor updates, design reviews, internal manifestos, lecture decks. Warm cream slides, serif display + grotesque body, hairline rules, monospace meta, generous macro-whitespace, one accent. Reads like a print supplement, not a SaaS landing.

`example.html` is a finished example of this template — study its structure, density and finish, do not copy its copy.

## Source

Distilled from [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) — `skills/minimalist-skill/SKILL.md`. Each `.slide` is a `100vw × 100vh` section, the active slide carries `.active` / `.is-active`, and `example.html` owns keyboard, wheel, touch, and dot navigation. No-script and print fallbacks keep every slide visible.

## Start here

- `example.html` is a self-contained 16:9 deck (inline CSS, Google Fonts link). Copy it to `design/<slug>/index.html` and replace content section by section; keep the class structure. No assets from `../html-ppt/` are required.
- Speaker-notes conventions and the self-contained-folder rule follow `../html-ppt/GUIDE.md`; if you add notes, put them in `<aside class="notes">` (hidden) — never as visible text.
- Fonts: Every font stack keeps a Chinese fallback — sans: `"PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif`; serif: `"Songti SC","Noto Serif SC",serif`. Google Fonts links may stay. Copy is Chinese with `<html lang="zh-CN">`.

## Hard rules

- **Substrate:** warm off-white `#FBFBFA` / `#F7F6F3`. Foreground off-black `#1A1A19`. Never pure white or pure black.
- **Type pairing:** display in **serif** (Instrument Serif / Newsreader / Lyon), body in **grotesque** (Inter Tight / Switzer), meta in **mono** (JetBrains Mono). Chinese: serif display falls back to `"Songti SC","Noto Serif SC"`, body to `"PingFang SC","Noto Sans SC"`.
- **Display scale per slide:** title `clamp(56px, 6.5vw, 96px)` italic-capable serif, line-height `1.05`, tracking `-0.025em` (use `0` tracking for Chinese lines).
- **Hairline only:** `1px solid #EAEAEA` — borders, dividers, table cells. No drop shadows.
- **One accent color** chosen from the muted-pastel pairs (e.g. sage `#346538` on `#EDF3EC`, or red `#9F2F2D` on `#FDEBEC`). Used sparingly — eyebrow dot, chart fill, call-out chip. Never as a slide background.
- **Slide padding:** generous (`72px 96px` minimum). Title at most 14ch wide.
- **Eyebrow:** every slide opens with a mono uppercase eyebrow `letter-spacing: 0.18em` and a section number `01 / 09`.
- **Page numbers:** mono, bottom-right corner.

## Banned

- Inter (use Inter *Tight* if you must, but prefer Switzer / SF Pro). No Roboto, Open Sans.
- Heavy drop shadows. Glow. Gradient text.
- 3-equal-card feature rows. Use uneven hairline-divided columns instead.
- Emojis in text or as bullet markers — use `—` or no marker.
- Full-bleed photography on every slide. Use one or two image slides; reserve them.
- AI-cliché copy ("Elevate", "Unleash", "Seamless", "Next-Gen"; in Chinese: 「赋能」「颠覆」「无缝」「新一代」).
- Slide transitions noisier than fade-in.

## Required slide archetypes (10–12 total recommended)

1. **Cover** — serif title, italic mid-sentence accent, mono meta footer.
2. **Eyebrow + thesis** — single sentence of body lede on the left; mono numbered TOC on the right.
3. **Numbered manifesto** — three or four hairline-separated theses.
4. **Bento data slide** — uneven 6-col grid with hairline gaps; one stat in serif, supporting in mono.
5. **Quote / pull-out** — single sentence at large serif, attribution mono, hairline above and below.
6. **Comparison** — two columns separated by a vertical hairline; "Doesn't / Does" or "Before / After".
7. **Table or index** — `display: grid; gap: 1px` on hairline color.
8. **Chart or breakdown** — flat horizontal bar chart with mono labels, accent fill only on the latest bar.
9. **Team / colophon** — mono key-value list, no avatars.
10. **Closing** — serif final line italic; CTA as ghost button; signature in mono.

## Motion

- Runtime navigation: keyboard, wheel / trackpad, touch swipe, and dot buttons must all update the same active slide state. Keep the fade at roughly `400ms cubic-bezier(0.16, 1, 0.3, 1)`.
- Static / print fallback: keep every slide visible when the runtime has not booted or the document is printed.
- No translate, no blur, no auto-advance.

## Linked edits

- `.pagenum` (`NN / 10`) on every slide is hand-written — renumber all of them, including the total, when slides change.
- The TOC on the thesis slide (`ul.toc li` with `.n`, `.t`, `.pg p. NN`) lists every slide; add, remove or reorder entries together with the slides.
- Each slide's `.meta-row .num` (`03 · manifest`) carries the section number — keep it equal to the slide's position.
- Counts in titles must match content: the manifesto `h2.title`, its `data-title` and the TOC entry name a number of theses that must equal the `.manifesto .item` count.
- Chart bars are inline `style="--w: NN%"` hand-scaled to the largest value; the latest bar alone gets `.bar.accent` — recompute widths and move `.accent` when data changes.
- `--ink` / `--paper` are repeated as `rgba(26,26,25,…)` / `rgba(251,251,250,…)` in `#deck-nav` and its `.dot`s, and `.ghost-cta.solid:hover` uses `#2A2A28` — update them with the variables.
- The nav script takes slides from the direct children of `.deck` with class `slide`, builds one `#deck-nav` dot per slide, toggles `.active` + `.is-active` (CSS shows `body.deck-nav-ready .slide.active`) and sets `window.deck = { slides, index, go }` — keep that line and keep slides un-nested.

## Print

Supported. Browser print (Cmd/Ctrl+P → Save as PDF) gives one 1920×1080 page per slide; deck-toolkit.js lays the slides out for print, so keep it loaded. The nav dots and progress bar are not printed.

## Pre-flight

- [ ] Substrate is warm off-white; foreground is off-black; never pure black/white
- [ ] Serif used on titles, grotesque on body, mono on meta — three families, three jobs
- [ ] One accent color, used at most three times in the whole deck
- [ ] Every slide has eyebrow + section number + page number
- [ ] At least one hairline-grid table or comparison module
- [ ] No drop shadows, no gradients, no emojis, no banned fonts
- [ ] Keyboard, wheel / trackpad, touch swipe, and dot navigation all move one slide and keep the active dot / active slide in sync
- [ ] Chinese fallback in every font stack; `<html lang="zh-CN">`.
