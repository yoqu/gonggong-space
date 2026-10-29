# Dating Web Dashboard

A consumer-feeling dating / matchmaking dashboard — left rail navigation, ticker bar of community signals, headline KPIs, a 30-day mutual-matches bar chart, and a match-rate trend block. Editorial typography, restrained accent. Use when the brief asks for a "dating site", "matchmaking", "community dashboard", "social network dashboard", or any consumer product where the data is the story.

Produce a single-screen consumer dashboard that feels like a Sunday-paper dating column rendered as software. Editorial type, single restrained accent, lots of negative space, *no* swipe deck or hookup tropes.

`example.html` is a finished example of this template — study its structure and quality bar, do not copy its copy.

## Workflow

1. **Read the design system's `DESIGN.md` and `tokens.css`** (see SKILL.md Step 0). Lean into a serif display
   token for the metric numerals — these screens live or die on numerals.
2. **Pick a brand voice** — wry, observational, slightly literary. Generate
   real, specific copy. Examples: "the people who'd text back within a day",
   "manageable. two are now friends.", "your single greatest compatibility
   asset."
3. **Layout**, in order:
   - **Top ticker** — single-row horizontal strip across the top in a
     sans-serif eyebrow style: tagline left, "NEXT TIER AT 2,080 MUTUALS"
     right, both in mono caps with letter-spacing. Thin rule below.
   - **Left rail** — 220–260px sidebar. Brand wordmark in serif italic at
     top. User card (avatar / handle / ratio / tier). Three groups of nav:
     "TODAY" (specimen, inbox, queue, notifications), "YOU" (your stats,
     mutuals & communities, blocked, settings), "ARCHIVE" (past issues,
     expired matches). Active item gets accent text + accent dot.
   - **Main content**:
     - **KPI grid** — 3 columns × 3 rows (or 9 cells). Each cell: small
       caps mono label, an oversized serif numeral (use accent or muted
       green for positive, muted red for caution), one-line italic
       footnote. Plausible specifics — "1,842 ↑ 41 this wk · healthy
       growth.", "14% above median for your cohort.", "4 / exes in your
       circle · manageable. two are now friends."
     - **Bar chart panel** — "mutuals — last 30 days". Tall thin black
       bars, last two days highlighted in accent. Caption above with
       "↑ TRENDING UP · +3 CLOSE MUTUALS THIS MONTH · TWO VIA THE SAME
       OFFSITE" in mono.
     - **Trend panel** — "match rate — last 12 weeks". One line of body
       copy below ("STEADY CLIMB FROM 8% → 14%. ATTRIBUTABLE TO ONE
       COMMUNITY JOIN…"). Footer rule.
4. **Write** a single HTML document:
   - `<!doctype html>` through `</html>`, CSS inline.
   - Background creamy off-white, body serif, mono labels everywhere.
   - Use `font-feature-settings: 'tnum'` on the metric numerals.
   - SVG bar chart with ~30 bars, varied heights.
   - `data-section` on ticker, sidebar, kpi grid, chart, trend.
   - Write the page to `design/<slug>/index.html` (assets next to it, relative paths), then follow SKILL.md: critique, publish.
5. **Self-check** (then run `../../references/critique.md`):
   - Reads as restrained, editorial, slightly funny — not horny.
   - Single accent token used in 3–4 places max (one KPI, two highlight
     bars, one nav active state).
   - No swipe deck, no hearts, no fire emoji.
