# Magazine Web PPT (guizang-ppt)

Electronic magazine × e-ink: serif headlines over a WebGL fluid background, horizontal swipe paging — like *Monocle* with code stitched onto it.

`assets/example-slides.html` is a finished example of this template (9 slides) — study its structure, density and finish, do not copy its copy. It holds only the `<section>` slides: to view it rendered, paste it into a copy of `assets/template.html` at the `<!-- SLIDES_HERE -->` marker. The seed you build from is `assets/template.html`.

## What this template is

A **single-file HTML** horizontal-swipe deck with:

- an **electronic magazine + electronic ink** hybrid style;
- a **WebGL fluid / contour / dispersion background** (visible on hero pages);
- **serif headlines (Noto Serif SC + Playfair Display) + sans body (Noto Sans SC + Inter) + mono metadata (IBM Plex Mono)**;
- **Lucide line icons** (no emoji);
- **horizontal paging** (← →, wheel, touch swipe, bottom dots, ESC index);
- **smooth theme interpolation**: flipping to a hero page softly transitions colours and shader.

The aesthetic is neither "corporate PPT" nor "consumer-internet UI".

**Suits:** offline talks, industry sharing sessions, private salons, AI product launches / demo days, talks with a strong personal style, marketing and brand-plan storytelling.
**Does not suit:** long tabular data or stacked charts, training courseware (density too low), multi-person editing.

## Resource map

```
guizang-ppt/
├── GUIDE.md                  ← you are reading this
├── LICENSE                   ← MIT, op7418 (歸藏) — keep it
├── assets/
│   ├── template.html         ← complete runnable seed (CSS, WebGL shader, paging JS, font/icon CDNs)
│   └── example-slides.html   ← 9-slide finished example (slides fragment for the seed's SLIDES_HERE marker)
└── references/
    ├── styles.md             ← the 5 magazine directions (Monocle / WIRED / Kinfolk / Domus / Lab)
    ├── themes.md             ← the 5 theme colour presets (pick only, no customisation)
    ├── layouts.md            ← 10 paste-ready slide skeletons + pre-flight class list + theme rhythm
    ├── components.md         ← component handbook (type, colour, grid, icons, callout, stat, pipeline…)
    └── checklist.md          ← quality checklist (P0/P1/P2/P3)
```

Loading order: this file → `references/styles.md` (pick direction) → `references/themes.md` → the `<style>` block of `assets/template.html` → `references/layouts.md` → `references/components.md` while tuning → `references/checklist.md` after building.

## Workflow

### Step 0 · Infer a direction

Infer one of the 5 magazine directions in `references/styles.md` from the brief, audience and content. Each direction packages its theme colour, recommended layouts, chrome style and slide count. Use the closest fit and continue without asking.

No direction cue → **Monocle Editorial** (lowest failure rate). "AI / benchmark / technical launch" → WIRED; "reading / private / social circle" → Kinfolk; "design / architecture / portfolio" → Domus; "research / academic / methodology" → Lab. When the creation message asks for visual directions, sketch 2–3 of these five as the candidates.

Record direction + theme + audience + duration at the top of your internal plan. **Never change direction midway.**

### Step 1 · Plan the outline

If the brief has no outline, build one on the narrative arc, then fill in content:

```
Hook       → 1 page    : a contrast / question / hard number that makes people stop
Context    → 1-2 pages : background / who you are / why this topic
Core       → 3-5 pages : the core content, interleaving layouts 4/5/6/9/10
Shift      → 1 page    : break the expectation / propose a new view
Takeaway   → 1-2 pages : a punchline / an open question / a call to action
```

Slide count by duration: 15 min ≈ 10 pages, 30 min ≈ 20, 45 min ≈ 25–30 (see each direction's range in `styles.md`). Align narrative arc, page plan and theme rhythm (`layouts.md`) before writing HTML.

**Images:** put them in `design/<slug>/images/`, named `{page}-{semantic}.{ext}` (e.g. `01-cover.jpg`, `05-dashboard.png`, page number zero-padded, short English semantic), ≥ 1600px wide, JPG for photos / screenshots, PNG for transparent UI or charts, total under 10 MB. Reference them relatively as `images/xxx.png`. Without images, use intentional placeholder blocks — layouts 4/5/10 cannot be judged visually until real images land, say so in the reply.

### Step 2 · Copy the seed

Copy `assets/template.html` to `design/<slug>/index.html` and create `design/<slug>/images/`. The seed is complete and runnable (CSS, WebGL backgrounds, paging JS, font and icon CDNs); paste your `<section class="slide …">` pages at the `<!-- SLIDES_HERE -->` marker inside `<div id="deck">`.

- Replace the `<title>` placeholder `[required] Replace with your deck title · Deck Title` with the real deck title; afterwards grep for `[required]` until nothing remains.
- Set `<html lang="zh-CN">` for a Chinese deck. The seed already loads Noto Serif SC / Noto Sans SC; keep a Chinese fallback at the end of every font stack — sans: `"PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif`; serif: `"Songti SC","Noto Serif SC",serif`.

**Theme colour — 5 presets only, no custom hex:**

| # | Theme | Best for |
|---|------|------|
| 1 | Ink Classic | general / commercial launch / default |
| 2 | Indigo Porcelain | tech / research / data / technical keynotes |
| 3 | Forest Ink | nature / sustainability / culture / non-fiction |
| 4 | Kraft Paper | nostalgic / humanist / literary / indie magazines |
| 5 | Dune | art / design / creative / gallery |

Open `references/themes.md`, find the chosen theme's `:root` block and **replace as a whole** the lines marked with the theme-colour comment in the seed's opening `:root{`: `--ink` / `--ink-rgb` / `--paper` / `--paper-rgb` / `--paper-tint` / `--ink-tint`. Everything else flows through `var(--…)`. One theme per deck; never mix ink from one preset with paper from another; decline arbitrary hex values (brand colours go into imagery and copy, not the theme).

### Step 3 · Fill in content

**3.0 · Class pre-check (most important).** The `layouts.md` skeletons use many classes (`h-hero` / `h-xl` / `stat-card` / `pipeline` / `grid-2-7-5` …). If a class is not defined in the seed's `<style>`, the browser falls back to defaults: titles turn sans, stat cards collapse, pipelines mush into one line, images pile at the bottom. Before writing any slide: read the seed's `<style>`, check every class you plan to use against the pre-flight list in `layouts.md`, and add any missing class to the `<style>` once (not inline per slide). The seed is the single source of class names — don't invent new ones; one-off tweaks go in `style="…"`.

Commonly missed classes: `h-hero` / `h-xl` / `h-sub` / `h-md` / `lead` / `kicker` / `meta-row` / `stat-card` / `stat-label` / `stat-nb` / `stat-unit` / `stat-note` / `pipeline-section` / `pipeline-label` / `pipeline` / `step` / `step-nb` / `step-title` / `step-desc` / `grid-2-7-5` / `grid-2-6-6` / `grid-2-8-4` / `grid-3-3` / `grid-6` / `grid-3` / `grid-4` / `frame` / `frame-img` / `img-cap` / `callout` / `callout-src` / `chrome` / `foot`.

**3.0.5 · Theme rhythm.** Before picking layouts, list the theme class of every page (`hero dark` / `hero light` / `light` / `dark`) in your plan (rules at the top of `layouts.md`):

- every section carries one of `light` / `dark` / `hero light` / `hero dark` — never bare `hero`;
- no 3+ consecutive pages on the same theme;
- 8+ pages need ≥ 1 `hero dark` and ≥ 1 `hero light`;
- body pages cannot all be `light`; include at least one `dark` body page;
- one hero page (cover / divider / question / big quote) every 3–4 pages.

After building, `grep 'class="slide' index.html` and confirm the rhythm.

**3.1 · Pick a layout — never write slides from scratch.** `layouts.md` has 10 paste-ready `<section>` skeletons:

| Layout | Use |
|---|---|
| 1. Cover | page 1 |
| 2. Act divider | each act's opening |
| 3. Big numbers | hard data |
| 4. Quote + image | identity contrast / story |
| 5. Image grid | multi-image comparison / screenshot evidence |
| 6. Pipeline (two-column) | workflow / process |
| 7. Suspense close / question | act close / wrap-up |
| 8. Big quote | serif punchline / takeaway |
| 9. Before / after | old model vs new model |
| 10. Lead image + side text | information-dense image-text pages |

Paste, then change copy and image paths. `assets/example-slides.html` shows these in a finished deck. Component details (type, colour, grids, icons, callout, stat-card) are in `components.md`.

**3.2 · Image ratios.** Always a standard ratio, never the source's odd one:

| Scenario | Ratio |
|---|---|
| Quote + image, main image | 16:10 or 4:3 + `max-height:56vh` |
| Image grid | **fixed `height:26vh`**, not aspect-ratio |
| Small image left + text right | 1:1 or 3:2 |
| Full-screen hero visual | 16:9 + `max-height:64vh` |
| Image-text mix, small inset | 3:2 or 3:4 |

Never `align-self:end` on an image (it sinks to the bottom and hides behind the browser toolbar); use the preset grid + `align-items:start`, or flex column + `justify-content:space-between` to pin to the bottom.

Keep the seed's paging script, WebGL shader and the Lucide `<script>` plus its `lucide.createIcons()` call at the end of the file. Add `data-section="<id>"` to every slide.

### Step 4 · Self-check

Go through `references/checklist.md` item by item — every P0 must pass. Watch especially:

1. big titles render serif (if sans, the `h-hero` class is missing — redo 3.0);
2. image grids use `height:Nvh`, not `aspect-ratio`;
3. no images piled at the page bottom;
4. images only in standard ratios (16:10 / 4:3 / 3:2 / 1:1 / 16:9);
5. Chinese big titles ≤ 5 characters and `nowrap` (no one-character-per-line);
6. Lucide icons, never emoji;
7. serif for titles, sans for body, mono for metadata.

90% of later adjustments are inline values: `font-size:Xvw`, `height:Yvh`, `gap:Zvh`.

## Speaker notes

No notes runtime. When notes are requested, put them in `<aside class="notes" hidden>…</aside>` as the last child of each slide — never visible on stage.

## Core design principles

1. **Restraint over flash**: the WebGL background only shows through on hero pages, barely visible elsewhere.
2. **Structure over decoration**: no shadows, no floating cards, no padding boxes; information relies on **large type + typeface contrast + grid whitespace**.
3. **Hierarchy = size × typeface**: largest serif = main title, medium serif = subtitle, large sans = lead, small sans = body, mono = metadata.
4. **Images are first-class**: cropped only at the bottom, top and sides intact; grids use fixed `height:Nvh`.
5. **Rhythm relies on hero pages**: hero and non-hero alternate.
6. **Consistent terminology**: one term per concept, no mixed translations.

Style anchors: Guizang's talk "One-Person Company: Organizations Folded by AI" (2026-04-22), the layout of *Monocle* magazine.

## Linked edits

- Theme swap is one block: `--ink`, `--ink-rgb`, `--paper`, `--paper-rgb`, `--paper-tint`, `--ink-tint` in the seed's `:root` change together, and each `-rgb` triplet must equal its hex — every overlay, nav dot and the ESC index use `rgba(var(--ink-rgb|--paper-rgb), …)`.
- A slide's `light` / `dark` class (or `data-theme`) is read by `go()` to toggle `body.light-bg`, which swaps `canvas#bg-light` / `canvas#bg-dark` and the `#nav` dot colours; a slide with neither class is treated as dark, so changing a slide's theme is a class change, nothing else.
- `.chrome` page numbers are hand-written (`03 / 09`, `Act II · 04 / 09`): adding, removing or reordering slides means rewriting the number and total on every slide.
- Act labels repeat across the act divider `.kicker` (`Act II`) and the `.chrome` / `.foot` of that act's pages; renaming or inserting an act updates all of them.
- `#deck` width (`total*100vw`) and the `#nav` dots are generated from the `.slide` count — don't hard-code either.
- When editing the paging script keep `slides.forEach(…toggle('active'…))` (read by the host bridge) and the line `window.deck={slides:slides,get index(){return idx},go:function(n){lock=false;go(n)}};`; keep `lucide.createIcons()` after the Lucide `<script>` or `<i data-lucide>` icons stay blank.

## Print

Supported. Browser print (Cmd/Ctrl+P → Save as PDF) gives one 1920×1080 page per slide; deck-toolkit.js lays the slides out for print, so keep it loaded. The WebGL backgrounds (`canvas#bg-dark` / `canvas#bg-light`) sit outside `#deck` and are hidden in print; the seed's `@media print` rule gives `.slide` a paper fill and `.slide.dark` an ink fill instead — keep it.

## Source & license

Adapted from [`op7418/guizang-ppt-skill`](https://github.com/op7418/guizang-ppt-skill) — MIT, Copyright (c) 2026 op7418 (歸藏). The full license ships at [`LICENSE`](./LICENSE); keep it with any copy of the seed, example or references.
