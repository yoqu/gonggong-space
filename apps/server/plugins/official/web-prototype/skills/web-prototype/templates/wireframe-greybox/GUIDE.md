# Wireframe Greybox

Design system: optional — this template has its own visual language; use the design system only for accent colour and fonts.

Produce a single crisp greybox wireframe page. The whole point is
*structure, not skin* — communicate hierarchy and layout with neutral
grey blocks, never with real color, copy, or imagery. Everything is a
placeholder: text is grey "lorem bars", images are rectangles with a
diagonal cross, numbers are big solid blocks. The only color on the page
is the single redline accent reserved for monospace annotations.

`example.html` is a finished example of this template — study its structure and quality bar, do not copy its copy.

## Workflow

1. **Stay structural.** Ignore any design system that pushes finished UI —
   this is deliberately low fidelity. Use a clean system sans (Inter /
   system-ui) for shape and a mono (IBM Plex Mono / JetBrains Mono) for
   the redline annotations only. No hand-drawn fonts, no brand color.
2. **Set the greybox palette.** Page is a pale neutral (`#f7f7f8`),
   blocks are medium grey (`#e3e3e6`), borders are crisp and defined
   (`#c9c9cf` for soft edges, `#1c1b1a` for emphasis), and exactly one
   accent (a blue or coral redline) carries every monospace annotation.
   Keep contrast high enough to read as a small thumbnail — never
   near-white-on-white.
3. **Lay out the dashboard**, in order, each on its own `data-section`:
   - **App bar** — a logo greybox, a row of nav lorem-bars, and an
     avatar circle on the right.
   - **Sidebar nav** — icon squares + lorem-bar labels; mark one item
     active with a filled/inverted block.
   - **KPI row** — four greyboxes, each a small label bar above a big
     solid "number" bar.
   - **Chart panel** — an inline SVG greybox: axes plus a few
     hatched/grey bars or a schematic line. No real data.
   - **List / table panel** — a header row plus ~5 rows of lorem bars,
     with one column of image-placeholders drawn as a box with a
     diagonal X.
   - **Annotations** — one or two small monospace redlines pinned to the
     canvas (e.g. `01 · 12-col grid`, `max-width 1280`).
4. **Write** one self-contained HTML document — `<!doctype html>`
   through `</html>`, CSS inline, no external JS or images. SVG and CSS
   draw every placeholder. A `max-width` container plus a media query
   collapses columns under ~1000px.
5. **Check.** It should read as a blueprint at thumbnail size: grey
   blocks, X-crossed image boxes, lorem bars, and exactly one accent
   color on the monospace redlines. If any greybox is missing, the page
   looks colored, or it disappears as a blank thumbnail, fix it. Then run
   `../../references/critique.md`.

## Output

Write the page to `design/<slug>/index.html` (assets next to it, relative paths), then follow SKILL.md: critique, publish.
