# SaaS Landing

Craft: read ../../craft/typography.md, ../../craft/color.md, ../../craft/anti-ai-slop.md, ../../craft/laws-of-ux.md before writing.

Produce a single-page SaaS landing. Follow this workflow exactly.

`example.html` is a finished example of this template — study its structure and quality bar, do not copy its copy.

## Inputs

- Product name and tagline (required — ask if the brief has neither).
- Pricing section: on by default.
- Social-proof count: default 3 (0–6).
- Hero vertical padding ("hero density"): default 96px (range 48–200px).
- Accent strength: default 1.0 opacity (range 0.5–1.0).

## 1. Read context

Before writing anything:
- Read the design system's `DESIGN.md` and `tokens.css` (see SKILL.md Step 0).
- Identify the color palette, typography tokens, and layout principles.
- Note the "Agent Prompt Guide" section — it overrides any instruction here if they conflict.

## 2. Plan sections

Required sections, in order:
1. **Hero** — logo-or-wordmark, headline (tagline input), subhead (1–2 sentences), primary CTA, secondary CTA. Use the hero density as vertical padding in px.
2. **Features** — 3–6 feature tiles. Each: icon, short title, 1–2 sentence body.
3. **Social proof** — proof-count logos or testimonials. If 0, skip this section.
4. **Pricing** — 2–3 tiers. Include only if pricing is on.
5. **Footer CTA** — large accent-colored band with one-button call to action.
6. **Footer** — minimal: links + copyright.

## 3. Apply design system

- All colors must come from the design system tokens. Do not invent hex values.
- Typography: use the declared display font for headlines, body font for everything else.
- Layout: respect the grid, max-width, and section spacing rules.
- Components: use declared button/card/input patterns. Do not add shadows if DESIGN.md's Depth & Elevation says minimal.
- Accent: use the accent color only once in the hero, once in the footer CTA, and for all links. Do not flood the page.

## 4. Write the file

Write the page to `design/<slug>/index.html` (assets next to it, relative paths), then follow SKILL.md: critique, publish. The file is a single self-contained `index.html` with:
- All CSS inlined in a `<style>` block in `<head>`.
- System font fallbacks if the design system fonts aren't loadable from Google Fonts etc.
- No external JS.
- Semantic HTML (`<header>`, `<main>`, `<section>`, `<footer>`).
- Each major section tagged with `data-section="<unique-slug>"`.

Do not generate a separate CSS file, JS file, or README.

## 5. Self-check

Run this list, then `../../references/critique.md`:
- [ ] All text is content-meaningful, not lorem ipsum (use the product name and tagline; generate plausible specific copy for the rest).
- [ ] No broken color references (every CSS color value is in the design system palette or a valid alpha/fallback variant).
- [ ] Responsive breakpoints match DESIGN.md's Responsive Behavior section.
- [ ] The page looks good at 1440w, 768w, and 375w (mentally simulate).
- [ ] Accent used no more than twice total.
