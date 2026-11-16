# Simple Deck

A clean single-file horizontal-swipe deck: light and dark surfaces alternating in rhythm, one accent, design-system tokens — a neutral base for operating reviews, product overviews and pitches.

`example.html` is a finished example of this template — study its structure, density and finish, do not copy its copy.

## Resource map

```
simple-deck/
├── GUIDE.md                  ← you're reading this
├── example.html              ← finished 6-slide example
├── assets/
│   └── template.html         ← seed: tokens + slide primitives + proven nav script (READ FIRST)
├── references/
│   ├── layouts.md            ← 8 paste-ready slide layouts + theme-rhythm rules
│   └── checklist.md          ← P0/P1/P2 self-review (rhythm spot-check at bottom)
└── design-system/
    ├── DESIGN.md             ← default design system (Neutral Modern)
    └── tokens.css            ← its exact values
```

## Design system

Use `./design-system/` (Neutral Modern: `#FAFAFA` canvas, `#111111` ink, cobalt `#2F6FEB` accent, Inter) unless the creation message gives brand colours, fonts or a logo — then keep the same token names and adapt the values to the brand (accent = the brand's primary, canvas/ink stay near-neutral with enough contrast; brand fonts replace `--font-display` / `--font-body`), and place a supplied logo in the cover and closing slides. `tokens.css` wins over prose in `DESIGN.md` for exact values.

## Workflow

### Step 0 — Pre-flight

1. **Read `assets/template.html`** end-to-end through the `<style>` block AND the `<script>` block. The script solves five iframe-specific bugs (real scroller detection, dual capture-phase listeners, auto-focus, no `scrollIntoView`, position persistence) — do not rewrite it.
2. **Read `references/layouts.md`** so you know the 8 layouts. Pay special attention to the "Theme rhythm" section — it's the rule that prevents the deck from feeling sleepy.
3. **Read `design-system/DESIGN.md` and `tokens.css`** — the seed's `:root` uses the same names (`--bg`, `--surface`, `--fg`, `--muted`, `--border`, `--accent`, `--font-display`, `--font-body`, `--font-mono`).

### Step 1 — Copy the seed

Copy `assets/template.html` to `design/<slug>/index.html`. Replace the `:root` values with the design system's tokens (or the brand-adapted ones). Replace the `[REPLACE]` page `<title>`. Set `<html lang="zh-CN">` for a Chinese deck and end every font stack with a Chinese fallback — sans: `"PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif`; serif: `"Songti SC","Noto Serif SC",serif`.

### Step 2 — Decide slide count + theme rhythm BEFORE writing any slide

Default: 6 slides unless the brief says otherwise.

| Audience / format | Slides |
|---|---|
| Product overview / lightning talk (5–10 min) | 6 |
| Pitch deck (15 min) | 8–10 |
| Investor update / longer talk (20–30 min) | 12–18 |

Plan the rhythm in your internal plan before any HTML — for example, 8 slides:

```
01  hero light center  Cover
02  light              Problem
03  hero dark center   Big stat
04  light              Three points
05  dark               Pipeline
06  hero light center  Quote
07  light              Before / after
08  hero dark center   Ask
```

A healthy sequence has:
- no 3+ same theme in a row;
- ≥ 1 `hero dark` AND ≥ 1 `hero light` (for 8+ slides);
- alternating breath every 3–4 slides.

### Step 3 — Paste and fill

For each planned slide, copy the matching `<section>` from `layouts.md` into the body. Replace bracketed text with real, specific copy. **No filler / no lorem.** If a slide feels empty, the layout is wrong — pick a different one.

Tag each slide with `data-screen-label="01 Cover"`, `"02 Problem"`, etc., in order (the seed's first slides already do this — extend the pattern), plus `data-section="<id>"`.

### Step 4 — Self-check

Run through `references/checklist.md`. The "Theme rhythm spot-check" at the end is non-negotiable:

```bash
grep 'class="slide' index.html
```

Read the class list. If you see `light × 4 in a row`, swap one to `dark`. If no `hero dark` exists in an 8+ slide deck, promote one big-stat or closing slide.

## Speaker notes

No notes runtime. When notes are requested, put them in `<aside class="notes" hidden>…</aside>` as the last child of each slide — never visible on stage.

## Linked edits

- Inserting, removing or reordering a slide means renumbering every `data-screen-label="NN Name"` and re-checking the theme-class sequence (`light` / `dark` / `hero light` / `hero dark`) against the rhythm rules.
- `.slide.dark` rules hard-code the light canvas as `rgba(250,250,247,…)` (`.muted`, `.border`, `.lead`, `.pt p`, `.ph-img`) — when `--bg` changes, update those RGB values too.
- `--accent-soft` is derived from `--accent`; `example.html` additionally hard-codes the accent in `style="color:#c96442;"` on the dark `.slide.title` eyebrows and a raw `#e6e4e0` border on `.counter` — keep them in sync with the tokens.
- The nav script scrolls to `index * window.innerWidth`, so every `section.slide` must be a direct child of `<body>` at exactly `flex: 0 0 100vw`, and the chrome (`#deck-progress`, `#deck-counter`, `.deck-hint`) must stay `position: fixed`; the class `slide` must not be used on anything but slides (the script queries `.slide`).
- The counter's initial text (`1 / 3` in the seed, `1 / 6` in `example.html`) is static HTML — the seed rewrites it on load, the example only after the first move, so update it with the slide count.
- Keep the `window.deck = { slides, get index(), go }` line in the nav script.

## Print

Supported. Browser print (Cmd/Ctrl+P → Save as PDF) gives one 1920×1080 page per slide; deck-toolkit.js lays the slides out for print, so keep it loaded.

## Hard rules

- **Theme class on every slide** (`light` | `dark` | `hero light` | `hero dark`). Bare `class="slide"` = regression.
- **No 3+ same theme in a row.**
- **Display type via `var(--font-display)`.** `.h-hero` / `.h-xl` / `.h-md` already enforce it — change the token, not the classes.
- **One accent per slide, used at most twice.**
- **Don't rewrite the nav script.** It's proven.
- **No `scrollIntoView()`.** Breaks iframe.
- **`data-screen-label` on every slide.**
