# Annotated Wireframe

Design system: optional — this template has its own visual language; use the design system only for accent colour and fonts.

Produce a single flat, low-fidelity landing-page wireframe with a redline spec.
The whole point is "structure + handoff notes, not pixels" — greyboxes carry
the layout, numbered pins call out regions, and a right-hand spec panel turns
each pin into a short engineering / UX note. Keep it clean and flat; never
hand-drawn or scribbly.

`example.html` is a finished example of this template — study its structure and quality bar, do not copy its copy.

## Workflow

1. **Skip finished UI.** This template explicitly wants a low-fidelity greybox
   look. Honor type tokens only loosely (one clean sans like Inter / system-ui
   for labels, one mono like IBM Plex Mono for the spec notes and pin numbers).
   Use medium-grey fills with defined darker borders so the page reads as a
   thumbnail — avoid near-white-on-white, which renders blank.

2. **Set the two-column shell.** LEFT is the wireframe canvas: a browser-chrome
   framed greybox page. RIGHT is a narrow "ANNOTATIONS / SPEC" panel. Pick ONE
   accent color (coral or blue) and use it ONLY for the numbered pins and the
   matching spec numbers — everything else stays greyscale.

3. **Lay out the canvas**, top to bottom, each block a greybox with a numbered
   pin absolutely positioned on it:
   - **Top nav** — logo greybox + nav lorem-bars + a primary button block. Pin ①.
   - **Hero** — big headline lorem bars + subhead + two CTA button blocks on the
     left; a large image placeholder (rect with a diagonal X) on the right. Pin ②.
   - **Logo strip** — a row of 5 small greybox partner logos. Pin ③.
   - **Feature grid** — 3 cards, each an icon square + title bar + 2 text bars. Pin ④.
   - **Footer** — columns of lorem link-bars. Pin ⑤.

4. **Mirror every pin in the spec panel.** Each spec row = the circled number in
   the accent color + a short mono/sans note, e.g. "① Sticky nav, 64px, condenses
   on scroll", "② Hero H1 48/56, CTA pair primary+ghost", "③ 5 partner logos,
   greyscale", "④ 3-up at ≥960px → 1-up mobile", "⑤ 4-col footer, legal row".
   Mark the panel and each row with `data-section`.

5. **Check**, then run `../../references/critique.md`:
   - Every numbered pin on the canvas has exactly one matching spec row.
   - The accent color appears ONLY on pins + spec numbers; the rest is greyscale.
   - The page should read clearly at thumbnail size; if blocks vanish into the
     background, darken the fills/borders.
   - It must NOT look pixel-perfect or hand-drawn — flat greyboxes only.

## Output

Write the page to `design/<slug>/index.html` (assets next to it, relative paths), then follow SKILL.md: critique, publish.
