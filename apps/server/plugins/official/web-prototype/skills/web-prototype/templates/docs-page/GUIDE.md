# Docs Page

Craft: read ../../craft/typography.md, ../../craft/typography-hierarchy.md, ../../craft/typography-hierarchy-editorial.md, ../../craft/rtl-and-bidi.md before writing.

Produce a single, three-column documentation page in one HTML file — inline-start nav, scrollable article body, inline-end table of contents. Use when the brief mentions "docs", "documentation", "guide", "API reference", or "tutorial".

`example.html` is a finished example of this template — study its structure and quality bar, do not copy its copy.

## Workflow

1. **Read the design system's `DESIGN.md` and `tokens.css`** (see SKILL.md Step 0). Use the body type token for
   prose; the mono token for code; respect line-height and max-width rules.
2. **Pick a topic** from the brief — the page should look like real docs, not
   a generic wireframe. Concrete API names, command examples, plausible
   parameters.
3. **Lay out** three regions, expressed on the inline axis so the
   layout flips correctly under `dir="rtl"`:
   - **Inline-start nav** (240–280px, sticky): grouped link list, current
     page bolded with an `inline-start`-edge accent stripe. 3–5 groups
     of 4–8 links.
   - **Article body** (max-width ~720px, centered in the middle column):
     H1, lede paragraph, H2 sections, code blocks, callout boxes (note /
     warning), inline links, lists.
   - **Inline-end TOC** (200–240px, sticky): "On this page" with the
     H2/H3 anchors, current section highlighted as the user scrolls.
4. **Write** a single HTML document:
   - `<!doctype html>` through `</html>`, all CSS inline.
   - CSS Grid for the three columns; sticky positioning for the rails.
   - Code blocks: monospace token, soft surface fill, copy-button affordance
     (visual only — no JS needed).
   - Anchor IDs on every H2/H3 so the TOC links work.
   - `data-section` on the nav, article, and TOC.
   - Write the page to `design/<slug>/index.html` (assets next to it, relative paths), then follow SKILL.md: critique, publish.
5. **Prose**: write at least 350 words of believable docs. Include at least
   one shell command, one code snippet (5–15 lines), one callout, one table.
6. **Self-check** (then run `../../references/critique.md`):
   - Body text wraps at the DS line-length sweet spot (60–75 chars).
   - Code uses the DS mono token, not generic `monospace`.
   - Accent is restrained — used for active nav item, links, one callout
     border. Not on body text.
   - Page is readable at 1280w and collapses gracefully below 900w (TOC drops
     out, nav becomes a top drawer).
   - Use logical CSS (`margin-inline-start`, `border-inline-start`,
     `inset-inline-end`, `text-align: start`) on the rails and accent
     stripe so the layout flips correctly under `dir="rtl"`.
