# Mobile Onboarding

Craft: read ../../craft/state-coverage.md, ../../craft/animation-discipline.md, ../../craft/accessibility-baseline.md, ../../craft/form-validation.md, ../../craft/laws-of-ux.md before writing.

Produce a three-screen mobile onboarding flow on a single HTML page — three phone frames side by side: splash, value-prop, sign-in.

`example.html` is a finished example of this template — study its structure and quality bar, do not copy its copy.

## Workflow

1. Read the design system's `DESIGN.md` and `tokens.css` (see SKILL.md Step 0).
2. Identify the app + audience.
3. Layout: three phone frames side by side. Each phone:
   - Status bar (time, battery, signal).
   - Hero artwork or icon.
   - Headline + supporting paragraph.
   - 3-dot pagination.
   - Primary CTA (full-width pill button).
   - "Skip" or alt action top-right.
4. Last phone is the sign-in / continue-with options screen.
5. Strong typography, gentle gradients, accessible contrast. `data-section` on each phone.
6. Run `../../references/critique.md`.

## Output

Write the page to `design/<slug>/index.html` (assets next to it, relative paths), then follow SKILL.md: critique, publish.
