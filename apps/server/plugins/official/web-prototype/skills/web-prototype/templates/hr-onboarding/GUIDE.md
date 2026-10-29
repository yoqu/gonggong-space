# HR Onboarding Plan

Craft: read ../../craft/accessibility-baseline.md before writing.

Produce a single-screen onboarding plan in HTML.

`example.html` is a finished example of this template — study its structure and quality bar, do not copy its copy.

## Workflow

1. Read the design system's `DESIGN.md` and `tokens.css` (see SKILL.md Step 0).
2. Identify the role + tenure expectations from the brief. Default to a
   30/60/90-day shape if unspecified.
3. Layout:
   - Cover banner: name placeholder, role, start date, manager + buddy.
   - "Day 1" panel with the literal schedule (kickoff time, lunch, 1:1 slot).
   - First-week timeline (Mon → Fri, two activities per day).
   - 30 / 60 / 90 day milestone cards with three concrete outcomes each.
   - Resource list: handbook, team chat channels, key dashboards, payroll setup.
   - "You're set when…" checklist — five outcomes with checkboxes.
4. Single inline `<style>`, semantic HTML.
5. Run `../../references/critique.md`.

## Output

Write the page to `design/<slug>/index.html` (assets next to it, relative paths), then follow SKILL.md: critique, publish.
