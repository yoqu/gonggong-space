# Repository Analytics Dashboard

Create a single-screen analytics dashboard for one code repository — stars, forks, contributors, issues, pull requests, recent activity, and top contributors — in the Soft Paper Workspace visual style: warm off-white canvas, white rounded panels, a fixed left sidebar, compact KPI cards, pastel pills, dense tables, and low-contrast hairlines.

## Resource map

```
templates/github-dashboard/
├── GUIDE.md
├── example.html                         ← rendered reference dashboard
└── references/
    ├── template.html                    ← structural template; `{{data.*}}` slots map to example-data.json
    └── example-data.json                ← normalized repository dashboard data shape
```

`example.html` is a finished example of this template — study its structure and quality bar, do not copy its copy. `references/template.html` uses `{{data.path}}` placeholders; in your output, write literal values — never leave `{{ }}` in the page.

## When to use this template

Use this when the user asks for a dashboard or report about a single repository, for example:

- repository growth dashboard
- open-source project health report
- stars / forks / contributors analytics
- issue and pull-request activity page
- maintainer / contributor dashboard

## Workflow

1. **Resolve repository scope**
   - Parse `owner/repo` (or the project name) from the brief.
   - This template is scoped to one repository. If multiple repositories are requested, build the dashboard for the primary one and offer the others as follow-ups.

2. **Data: inline mock data**
   - Use numbers from the brief or attachments when given. Otherwise write realistic, internally consistent mock data inline in the page — do not fetch live data.
   - Shape the data like `references/example-data.json`:
     - `repository`: `name`, `fullName`, `url`, `description`, `language`, `license`, `created`, `lastUpdated`.
     - `metrics`: stars, forks, contributors, issues, pull requests — display-ready totals plus small deltas or growth notes.
     - `contributors`: top 5–8 contributors with `login`, avatar (initials badge), and `contributions`.
     - `recentActivity`: 5–10 display-ready rows with `title`, type (issue / PR), label, author, author avatar, and `updated`.
   - Numbers must add up (open ≤ total, contributors list ≤ contributor count, chart trend matches the growth delta).
   - In the final reply, say the figures are illustrative mock data.

3. **Apply the visual system**
   - Use the design system's `DESIGN.md` and `tokens.css` (see SKILL.md Step 0).
   - The Soft Paper defaults reflected in `references/template.html` are: `#F2F2F0` canvas, white cards, `#ECECEA` borders, `#0A0A0A` ink, Geist/Inter typography, 256px sidebar, 48px topbar, and 16px card radius.
   - Keep color small and semantic: green for healthy metrics, amber for warning, blue for feature/PR labels, red only for defects or risk.

4. **Lay out the page**
   - Shell: 256px sidebar + main panel, both white, rounded 16px, 1px hairline border.
   - Topbar: repo context on the left, refresh/export/action affordances on the right.
   - Header: repository name, description, and date/settings/actions row.
   - KPI strip: 5 compact cards for stars, forks, contributors, issues, PRs.
   - Main grid: 2fr/1fr split with a growth chart or activity table on the left and top contributors/health cards on the right.
   - Footer: data note / last-updated note in small muted text.

5. **Write the page**
   - One self-contained `index.html` with inline CSS and no external JS libraries.
   - Tag major regions with stable `data-section` values: `sidebar`, `topbar`, `repo-header`, `kpi-strip`, `growth-chart`, `contributors`, `activity`, `provenance`.

## Visual rules

- Light mode only.
- 256px fixed sidebar on desktop; stack on narrow screens.
- 4 or 5 KPI cards in the first row.
- Use tabular lining numerals for all counts.
- Avatars are circular, 28–32px in tables and contributor lists.
- Tables use 13px body text, 11px uppercase column labels, 1px row dividers.
- Cards use hairline borders and a barely visible shadow at most: `0 1px 2px rgba(10,10,10,.04), 0 1px 1px rgba(10,10,10,.02)`.
- Do not use gradients except tiny workflow/repo icon placeholders.
- Do not make the page look like the code-hosting site itself. This is a custom operational dashboard, not a clone of the hosting platform's UI.

## Check, then run `../../references/critique.md`

- Every metric is from the brief/attachments or is consistent mock data noted in the footer.
- No private data or credentials appear in the page.
- Data labels are specific to the repository, not placeholders.
- The screen still reads clearly at 50% zoom.
- The dashboard uses at most one solid black primary action per area.
- Status labels and issue/PR chips are pastel pills, not saturated badges.

## Output

Write the page to `design/<slug>/index.html` (assets next to it, relative paths), then follow SKILL.md: critique, publish.
