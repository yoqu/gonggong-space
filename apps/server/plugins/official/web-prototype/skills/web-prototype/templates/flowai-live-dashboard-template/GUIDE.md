# Team Management Dashboard

Craft: read ../../craft/state-coverage.md, ../../craft/accessibility-baseline.md before writing.

Produce a single-screen, multi-tab team / workspace admin dashboard in a soft workspace aesthetic — three tabs (Team Members, Team Details, Activity Log), KPI stat row, member table, role distribution bar chart, online presence and activity sparklines, and a top-contributors panel. It is a static page with built-in interactions: tab switching, an animated bar chart, hover tooltips on charts, click-to-zoom panels, dark mode toggle, and CSV export of the visible team table. All data is mock data inlined in the page.

## Resource map

```
templates/flowai-live-dashboard-template/
├── GUIDE.md
├── assets/
│   └── template.html          # seed used as the starting structure
├── references/
│   └── checklist.md           # P0/P1/P2 quality gates
└── example.html               # iframe wrapper that renders assets/template.html as the finished sample
```

`example.html` (i.e. the filled `assets/template.html`) is a finished example of this template — study its structure and quality bar, do not copy its copy.

## Workflow

1. **Read the design system's `DESIGN.md` and `tokens.css`** (see SKILL.md Step 0). Map color, typography,
   spacing, and component styling tokens to the CSS variables used by
   `assets/template.html`. Do not invent new tokens.
2. Start from `assets/template.html` (copy it to `design/<slug>/index.html`); never generate the shell from blank.
3. Keep three tabs: `Team Members`, `Team Details`, `Activity Log`. Tabs must
   actually switch and only one view is visible at a time.
4. Generate plausible, specific sample data (real-looking names, IDs, roles,
   departments, dates, percentages). No `Member A / Metric B` placeholders.
   Replace the seed's product name with the one from the brief.
5. Required interactions:
   - tab switching with hash sync (`#members | #details | #activity`)
   - role bar chart animates with easing on first reveal of the details tab
   - chart hover tooltips with precise label + value
   - click any panel/card to zoom; click again or press Esc to restore
   - dark mode toggle that re-derives chart colors from CSS variables
   - "Export CSV" button that exports every row currently in the team table,
     including the `Workflow` column
6. Run through `references/checklist.md`, then `../../references/critique.md`.

## Output

Write the page to `design/<slug>/index.html` (assets next to it, relative paths), then follow SKILL.md: critique, publish.

The page must render correctly when opened directly from disk with no
build step and no network access.
