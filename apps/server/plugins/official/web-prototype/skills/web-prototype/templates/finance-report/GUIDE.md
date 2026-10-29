# Finance Report

Craft: read ../../craft/rtl-and-bidi.md before writing.

Produce a single-screen financial report in one self-contained HTML file.

`example.html` is a finished example of this template — study its structure and quality bar, do not copy its copy.

## Workflow

1. Read the design system's `DESIGN.md` and `tokens.css` (see SKILL.md Step 0). Tables, KPI cards, and chart strokes use
   palette tokens — never invent new ones.
2. **Classify** the period (monthly / quarterly / yearly) and entity
   (startup, division, project) from the brief. If unspecified, assume a
   quarterly SaaS report and pick believable numbers.
3. **Layout** the page in this order:
   - Masthead: company / period / "Confidential — Finance" badge.
   - Headline KPI strip (4 cards): Revenue, Net new MRR, Gross margin, Cash runway.
   - Revenue trend chart (inline SVG line + area).
   - Cost breakdown chart (inline SVG bar) with a 2–3 bullet caption.
   - P&L summary table (Revenue / Gross profit / Opex / Net) with current vs prior period.
   - Top accounts table with logo placeholders, plan, ARR, status badge.
   - Outlook paragraph + footer with author + signature line.
4. **Write** one self-contained HTML doc (CSS in one inline `<style>` block).
5. **Check**: every number ties to a labelled chart or table; deltas
   show direction and percentage; accent colour used at most twice. Then run
   `../../references/critique.md`.

## Output

Write the page to `design/<slug>/index.html` (assets next to it, relative paths), then follow SKILL.md: critique, publish.
