# Cross-tool Daily Briefing

Design system: not used — this template has its own visual language (see Design system policy below).

Cross-tool morning briefing: the past 24 hours of activity from every tool the user works in (code hosting, issue tracker, docs, chat, calendar, mail, file storage, error monitoring, deploys…) laid out as one editorial bento dashboard. Each tool module picks its own UI form (list, avatar stack, status ring, heatmap, file grid, alert card, …) based on the shape of its data.

There is no live data feed: use the activity in the brief and attachments; otherwise write realistic mock data inline.

## ⚠️ Source-of-truth protocol (read this first)

**Step 1.** Open and read the shipped `example.html` in this folder
before writing any output. It is a finished example of this template
and the canonical design — your job is to **reproduce its structure**,
not reinterpret it (do not copy its copy).

**Step 2.** Mirror the example's structure 1:1:
- Same DOM hierarchy and class names
- Same number and order of sections
- Same number of bento modules in the same order
- Same tool list (do **not** add or drop tools)
- Same KPI labels, same Top 3 entries, same "people waiting" set
- Same footer string

**Step 3.** You may freshen mock data values (counts, names, times) so
they read as "today" — but you must not invent new UI elements,
sections, modules, badges, callouts, ribbons, banners, decorations or
chrome that aren't already in `example.html`. If a detail is not in
the example, it does not belong in your output.

**Identity guard.** Treat every person name or handle in `example.html`
as mock content only. Do not infer the current user's display name from
the example, account labels, owners, assignees, senders, or mentions
unless the request explicitly identifies the user. If no explicit
current-user name is available, use neutral wording such as `you`,
`your`, `current user`, `我`, or `你`.

The body sections below are a **reference for the visual language and
tokens** — they are not a license to add features the example doesn't
already render.

## ⚠️ Design system policy

This template ships with its **own** complete visual language baked into
`example.html`. Do **not** apply the selected design system's tokens to
the output.

- If a design system is selected, **ignore it**.
- If the user supplies brand tokens or a Figma file, **ignore them**.
- Use exclusively the colors / fonts / radii / chrome defined in
  `example.html`.

This is a hard constraint: the briefing must read as its own editorial
bento language, not as the user's brand.

## Canvas tokens (use these exact values)

```
--bg:        #FAF7F2     /* off-white page */
--surface:   #FFFFFF     /* card */
--fg:        #1A1816     /* ink */
--muted:     #6B6660     /* secondary text */
--border:    #EAE5DD     /* 1px hairline only */
--orange:    #D86A47     /* accent (CTAs, hero highlight, meeting blocks) */
--green:     #2E7D5B     /* ok / done */
--yellow:    #C9982E     /* waiting */
--red:       #C0473A     /* alert / fail */
--radius-l:  24px        /* outer container */
--radius-m:  16px        /* bento cards */
--radius-s:  12px        /* inner blocks */
```

Type stack:
- Display serif: `'Cormorant', Georgia, serif` — KPI numerals, Hero h1,
  Top 3 serial numbers, italic comment quotes
- Body sans: `'Inter', -apple-system, system-ui, sans-serif`
- Numbers: always `font-variant-numeric: tabular-nums`

No shadows. No gradients. No emoji as primary visuals.
Tool icons must be monochrome line SVG (1.5 stroke).

## Page sections (top to bottom)

1. **Hero** — single row, ~80px tall.
   Left: `☀ 你好` (Cormorant 38px).
   Right of greeting: `· 2026 年 5 月 6 日 · 星期三` (muted, 18px).
   Far right: round avatar (40px) + small ⚙ + ✕ icons.

2. **KPI strip** — single row, ~120px tall, 5 columns equal width.
   Each cell: serif number (Cormorant 64px, `--fg`) over a muted
   uppercase tracking label (Inter 11px, letter-spacing 0.06em).
   Optional ▲/▼ delta tag in `--green`/`--red` next to the number.
   Suggested labels: `待办 / 待 review / 会议 / @ 我 / agent 跑完`.

3. **Today's timeline** — full width, ~140px tall.
   Horizontal time axis from 09:00 → 19:00, hour ticks below.
   Meeting blocks: filled `--orange` rounded rectangles spanning their
   start/end, with the meeting name + attendee count inside.
   Deep-work suggestions: pale-green translucent bands behind the axis.
   "Now" indicator: a 1px vertical `--red` line with a pulsing dot
   (`@keyframes pulse 2s ease-in-out infinite`) and a tiny `现在` label.

4. **Top 3** — 3 equal cards, ~220px tall.
   Each card: huge serif numeral 1 / 2 / 3 (Cormorant 96px, in `--fg`)
   left-aligned; one-sentence task headline (Inter 18px medium); a
   meta row at the bottom with the tool source label + line-icon
   + `等待 Xh` waiting time. Cards have `--border` 1px outline only.

5. **Tool modules** — adaptive bento, the heart of the briefing.
   Render 10–16 modules. Sizes vary: data-rich tools take a
   2-column or 2-row span, simple ones stay 1×1. **No two modules
   should look identical.** Pick UI per the data family below.

6. **People waiting on you** — full-width strip ~110px tall.
   Title left: `5 人在等你 · 最久 22h` (serif 24px).
   Right: 5 overlapping circular avatars (44px, ~8px overlap), each
   with the person's name + waiting reason underneath in 12px muted.

7. **Footer** — single line, ~52px.
   Left: `Daily Digest · auto-generated 06:42 · N tools`.
   Border-top 1px, all text 12px muted.

All top-level regions carry `data-section` (as in the example).

## Tool → UI mapping (pick the matching family)

| Family        | Examples                              | UI form                                              |
|---------------|---------------------------------------|------------------------------------------------------|
| Code collab   | GitHub, GitLab, Bitbucket             | Status-dot list (open/merged/closed/CI fail) + reviewer count, optional 2–3 line diff preview |
| Task mgmt     | Linear, Jira, Asana, ClickUp          | Issue list with colored status dot + priority bars; for cycle, add a small ring or progress strip |
| Comms         | Gmail, Slack, 飞书 IM, Outlook        | Round avatar + one-line quote, accent color for "awaiting reply" |
| Knowledge     | Notion, Confluence, 飞书 Doc          | Doc title + 2-line excerpt block; comment quote in italic serif |
| Time          | Calendar                              | Already lives in the global timeline; module form: agenda list with start time gutter |
| Alerts        | Sentry, Datadog, PagerDuty            | Big red Cormorant number (e.g. `4`), 7 small squares as 7-day heatmap, plus 1 latest error line |
| Status        | Vercel, GH Actions, Netlify           | Colored status dot per recent build/deploy + branch + duration |
| Files         | Drive, Dropbox, Box                   | Filename list with tiny thumbnail squares + "edited by" attribution |
| Board         | Trello, Miro, FigJam                  | 3 compact kanban columns with rounded card chips |
| Finance       | Stripe, PayPal, banking, Brex         | Cormorant currency number + 7-day sparkline + last 3 transactions list |
| CRM / Sales   | Salesforce, HubSpot, Pipedrive        | 3-column deal pipeline (Open / Negotiation / Won) + 1–2 priority contact cards |
| Support       | Zendesk, Intercom, Help Scout         | Ticket queue list with SLA timer pill (green / yellow / red) + assignee avatar |
| Analytics     | Google Analytics, Mixpanel, Amplitude | Mini funnel chart (4 bars descending) + 1-line cohort delta (`▲ 12% W/W`) |
| Infrastructure| AWS, GCP, Kubernetes, Docker          | Resource meters (CPU / mem / disk percent bars) + last 2 deployment lines |
| Security      | 1Password, Auth0, Okta                | Event list with red shield for high-severity items + audit timestamp |
| Voice/Misc    | unknown tool                          | See **Fallback heuristics** below |

### Fallback heuristics (for unknown tools)

When a tool doesn't match any family above, infer by the **shape of its
data**:

- Numbers + a time series → treat as **Alerts** (big number + heatmap)
- Rows with a `status` field → treat as **Task mgmt** (status-dot list)
- Rows with `from` / `subject` → treat as **Comms** (avatar + quote)
- Documents / file names → treat as **Files** (list + thumbnails)
- A small set of named "states" (deploy / build / cycle) → treat as **Status**
- Dated events → treat as **Time** (agenda list)

If still ambiguous, fall back to a status-dot list (the safest default).

## Implementation constraints (paired do / don't)

| Don't | Do |
|---|---|
| Render every module as the same card shape | Vary by family — Alert = big red number + heatmap; Status = status-dot list; Files = thumbnail grid; Comms = avatar + quote |
| Render error monitoring / on-call alerts as a plain list | Big red Cormorant number + 7-day heatmap + latest error line (`TypeError: …`) |
| Render Calendar as a plain text agenda | Visualize on the horizontal timeline at the top; module form is an agenda list with start-time gutter |
| Use placeholder names like "Service A / Project X" | Infer plausible real names from the tool type — code hosting → `acme/web-app`, error monitoring → `frontend-prod`, issue tracker → `ENG / DES` cycle 24, payments → `Pro plan / Acme Co.` |
| Use lorem ipsum filler | Write specific mock copy that reads as a real workday — names, numbers, errors, paths, percentages |
| Mix emoji and SVG icons in the same module set | Use monochrome line SVGs (1.5 stroke) consistently for all tool icons; emoji are reserved for hero greeting and section anchors only |
| Square or rounded-square avatars | Always circles; sizes 28 / 32 / 40 / 44 px depending on context |
| Drop shadows / gradients / glows on cards | Flat surfaces only; differentiate cards with the 1px `#EAE5DD` hairline border |
| Use brand colors from the user's design system | Use exclusively the canvas tokens above (`#FAF7F2`, `#1A1816`, `#D86A47` …) — the briefing's own editorial language |

## Check

Run `../../references/critique.md` (its design-system checks apply to this template's own tokens above).

## Output

Write the page to `design/<slug>/index.html` (assets next to it, relative paths), then follow SKILL.md: critique, publish.
