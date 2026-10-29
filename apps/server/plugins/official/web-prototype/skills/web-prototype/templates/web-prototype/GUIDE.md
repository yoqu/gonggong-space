# Web Prototype (SaaS / event / brand / docs)

Craft: read ../../craft/anti-ai-slop.md, ../../craft/color.md, ../../craft/typography.md before writing.

Used by four templates: `saas`, `event`, `brand`, `docs`. Produce a single, self-contained desktop page using the seed and layout library in this folder — **not** by writing CSS from scratch. The seed already encodes good defaults (typography, spacing, accent budget). Your job is to compose it.

```
templates/web-prototype/
├── GUIDE.md          ← you're reading this
├── assets/template.html  ← seed: tokens + class system + chrome (READ FIRST)
├── layouts.md        ← 11 paste-ready section skeletons
└── checklist.md      ← P0/P1/P2 self-review
```

## Templates and their rhythm

Numbers refer to layouts in `layouts.md`. Drop a section rather than pad it.

| Template | Page | Rhythm | Pacing notes |
|---|---|---|---|
| `saas` | SaaS 落地页 | 1 hero-center → 3 features → 4 stats *or* 5 quote → 9 split detail → 8 comparison table (only with real pricing/plans) → 6 cta-strip | Product-led and dense in the middle. The hero states the change for the user; features name user value, not technology. |
| `event` | 活动报名页 | 2 hero-split (date and venue in the eyebrow) → 7 log list as the agenda (times in `.meta`) → 3 features as "who should come / what you leave with" → 5 quote (only a real past attendee) → 10 registration form | Time-boxed and practical. No CTA strip — the page ends on the form; the topnav CTA anchors to it. |
| `brand` | 品牌官网首页 | 2 hero-split (real brand imagery) → 5 pull quote as the brand statement → 9 split detail (story, `grid-2-1`) → 11 entry grid (product lines / offerings) → 7 log list (news) → 6 cta-strip | Editorial and slow: one breathing section between dense ones, at most one stat row, imagery over icons. |
| `docs` | 产品文档首页 | 1 hero-center with one search `.input` → 11 entry grid (3 or 6 destinations) → 9 split detail as quick start (steps, code in `<pre class="meta">`) → 7 log list (changelog) → 6 cta-strip (community / support) | Utilitarian and scannable. No stats, no testimonials, no marketing adjectives. |

## Workflow

1. **Read `assets/template.html` end-to-end** — at minimum through the `<style>` block. The class inventory at the top of `layouts.md` lists every class that must be defined there; if one is missing, add it to `<style>` rather than re-defining it inline on every section.
2. **Read `layouts.md`** so you know which section skeletons exist. Don't write a section type that isn't covered — pick the closest layout and adapt.
3. **Prepare `index.html` from the seed.** Copy `assets/template.html` to `design/<slug>/index.html`. In its `:root`, replace the six colour variables (`--bg`, `--surface`, `--fg`, `--muted`, `--border`, `--accent`) and the three font variables (`--font-display`, `--font-body`, `--font-mono`) with the values from the design system's `tokens.css`. Keep the seed's derived, scale and spacing tokens; don't introduce new colour tokens. Replace the page `<title>` and the topnav brand.
4. **Plan the section list** following the rhythm above. Adjust to the content you actually have — a missing input means a dropped section, not invented filler.
5. **Paste and fill.** For each chosen layout, copy the `<section>` block from `layouts.md` into `<main id="content">`. Replace placeholder strings with real, specific copy from the brief. If a slot is empty, the section is the wrong choice; pick a different layout. Treat every `.ph-img` block as layout scaffolding and replace it when the section requires imagery (see SKILL.md, real imagery).
6. **Self-check** with `checklist.md`, then `../../references/critique.md`.

## Template rules

- **Single accent, used at most twice per screen.** Eyebrow + primary CTA is the default budget.
- **Display font comes from the design system** (`--font-display`). Sans for body. Mono for numerics, captions, eyebrows.
- **Mobile reflow already works** via the seed's media query at 920px. Don't break it by adding fixed widths.
