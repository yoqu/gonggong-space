# Team OKRs

Produce a single-screen OKR tracker — quarter banner, three objectives with their key results as progress bars, owner avatars, status pills, and a "this quarter at a glance" sidebar.

`example.html` is a finished example of this template — study its structure and quality bar, do not copy its copy.

## Workflow

1. Read the design system's `DESIGN.md` and `tokens.css` (see SKILL.md Step 0).
2. Layout:
   - Quarter banner: Q4 FY25, dates, overall progress chip.
   - Three objective cards. Each has:
     - Objective title + owner avatar + status pill (On track / At risk / Off track)
     - 3 key results, each a row with metric / current → target / progress bar
   - Right sidebar: at-a-glance KPIs, top movers, blockers callout.
3. Clear progress visualisation, calm palette, one accent. `data-section` on each region.
4. Run `../../references/critique.md`.

## Output

Write the page to `design/<slug>/index.html` (assets next to it, relative paths), then follow SKILL.md: critique, publish.
