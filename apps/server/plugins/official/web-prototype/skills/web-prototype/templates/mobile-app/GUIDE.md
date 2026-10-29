# Mobile App

Craft: read ../../craft/state-coverage.md, ../../craft/animation-discipline.md before writing.

Produce a single mobile-app screen mockup, framed inside a real-feeling iPhone 15 Pro device.

## Resource map

```
templates/mobile-app/
├── GUIDE.md                ← you're reading this
├── assets/
│   └── template.html       ← seed: device frame + screen primitives (READ FIRST)
├── references/
│   ├── layouts.md          ← 6 screen archetypes (Feed / Detail / Onboarding / Profile / Checkout / Focus)
│   └── checklist.md        ← P0/P1/P2 self-review (anti-fake-device)
└── example.html            ← a finished example of this template — study its structure and quality bar, do not copy its copy
```

## Workflow

### Step 0 — Pre-flight

1. **Read `assets/template.html`** end-to-end through the `<style>` block. The Dynamic Island, status bar SVG icons, home indicator, side rails, and tab bar are all already drawn in HTML/SVG — do not re-implement them inline on each screen.
2. **Read `references/layouts.md`** so you know which 6 archetypes exist.
3. **Read the design system's `DESIGN.md` and `tokens.css`** (see SKILL.md Step 0) — map its tokens to the six `:root` variables in the seed.

### Step 1 — Copy the seed

Copy `assets/template.html` to `design/<slug>/index.html`. Replace the six `:root` variables with the design system's tokens. Replace the page `<title>` and the caption above the device.

### Step 2 — Pick exactly one archetype

| Brief language | Use |
|---|---|
| feed, inbox, timeline, list, messages, notifications | A — Feed |
| article, post, item, recipe, song, product, song detail | B — Detail |
| sign-up, welcome, intro, walkthrough, tour | C — Onboarding |
| profile, account, user page, someone's bio | D — Profile |
| checkout, payment, order, form, settings step | E — Checkout |
| timer, map, dashboard widget, single big number | F — Focus / hero card |

A mobile screen does **one job**. If the brief seems to combine two, ship one screen and offer the other as a follow-up.

### Step 3 — Paste and fill

Copy the archetype block from `references/layouts.md` into `<main class="content">`, replacing the placeholder card. Fill bracketed text with real, specific copy from the brief. **Drop the `<nav class="tabbar">` block entirely** for archetypes that don't show one (B, C, E).

### Step 4 — Self-check

Run through `references/checklist.md`, then `../../references/critique.md`. Pay extra attention to:
- Frame still has the Dynamic Island, status bar SVGs, and home indicator
- Tap targets ≥ 44px
- One accent, used ≤ 2× on the screen
- Display headings still use `var(--font-display)` (serif)

### Step 5 — Output

Write the page to `design/<slug>/index.html` (assets next to it, relative paths), then follow SKILL.md: critique, publish.

## Hard rules

- **The phone is real.** Dynamic Island gap, SVG status icons, home indicator. The seed protects all three — don't rewrite the frame.
- **Single screen, single job.** No multi-tab tours, no spliced flows.
- **Accent budget = 2.** One active tab + one primary action is the default.
- **Numerics in mono** via `.num` class.
- **Display in serif** via `var(--font-display)`.
- **No external images** — use `.ph-img` placeholders.
