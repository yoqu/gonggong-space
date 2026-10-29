# Dashboard

Craft: read ../../craft/state-coverage.md, ../../craft/accessibility-baseline.md, ../../craft/laws-of-ux.md before writing.

Produce a single-screen admin / analytics dashboard: fixed left sidebar, top bar with user/search, main grid of KPI cards and one or two charts.

`example.html` is a finished example of this template — study its structure and quality bar, do not copy its copy.

## Workflow

1. **Read the design system's `DESIGN.md` and `tokens.css`** (see SKILL.md Step 0). Colors, typography, spacing, component styling all come from it. Do not invent new tokens.
2. **Classify** what the dashboard monitors (sales, traffic, usage, incidents,
   ops, etc.) from the brief. Generate specific, plausible metric names and
   values — no "Metric A / Metric B" placeholders.
3. **Lay out** the required regions:
   - **Left sidebar** (220–260px): brand mark at top, 6–8 nav links with
     icons, active state uses the DS accent.
   - **Top bar**: page title on the left, search input + user avatar / status
     on the right.
   - **Main**:
     - Row 1: 3–4 KPI cards (label + big number + delta vs. prior period).
     - Row 2: one primary chart (full width or 2/3) — render as an inline SVG
       line / bar / area chart drawn from real-looking numbers.
     - Row 3: one secondary chart or table (recent events, top items, etc.).
4. **Write** one self-contained HTML document:
   - `<!doctype html>` through `</html>`, CSS in one inline `<style>` block.
   - CSS Grid for the overall layout; Flexbox inside cards.
   - Semantic HTML: `<aside>`, `<header>`, `<main>`, `<section>`.
   - Tag each logical region with `data-section="slug"`.
5. **Charts**: inline SVG only, no JS libraries. A line chart is ~10 lines of
   `<polyline>` with a subtle area fill. A bar chart is N `<rect>`s with
   DS-accent fill. Label axes lightly (muted text, smaller scale).
6. **Check**, then run `../../references/critique.md`:
   - Every color comes from the design system tokens.
   - Accent used at most twice (sidebar active + one chart highlight).
   - Sidebar + top bar are sticky; main scrolls independently.
   - Density matches the DS mood — airy DSes get more padding, dense DSes
     (trading, crypto) tighten rows.

## Output

Write the page to `design/<slug>/index.html` (assets next to it, relative paths), then follow SKILL.md: critique, publish.
