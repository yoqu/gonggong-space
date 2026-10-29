# Blog Post

Craft: read ../../craft/typography.md, ../../craft/typography-hierarchy.md, ../../craft/typography-hierarchy-editorial.md, ../../craft/rtl-and-bidi.md before writing.

Produce a single long-form article page — editorial layout, no chrome: masthead, hero image placeholder, article body with figures and pull quotes, author byline, related posts. Use when the brief asks for "blog", "article", "post", "essay", or "case study".

`example.html` is a finished example of this template — study its structure and quality bar, do not copy its copy.

## Workflow

1. **Read the design system's `DESIGN.md` and `tokens.css`** (see SKILL.md Step 0). Lean into the typography
   tokens — long-form is 70% type, 20% image, 10% chrome.
2. **Pick the topic** from the brief and write a real article — at least 600
   words across 4–6 H2 sections. No lorem ipsum.
3. **Sections**, in order:
   - **Masthead** — small wordmark + 4–6 nav links, plain.
   - **Article header** — category eyebrow, headline (display token, large),
     deck (1–2 sentence subhead), author name + role + date.
   - **Hero image** — a 16:9 placeholder block using a DS-tinted gradient or
     solid fill (no external images). Add a 1-line caption underneath.
   - **Body** — alternating prose paragraphs with at least:
     - 1 pull quote (large display type, accent rule on the inline-start edge so the layout flips correctly under `dir="rtl"`).
     - 1 figure (image placeholder + caption).
     - 1 list (numbered or bulleted).
     - 1 inline blockquote.
   - **Author footer** — author avatar (initials in a circle), bio paragraph.
   - **Related** — 3 cards linking to other posts. Each card: tiny image
     block, title, 1-line excerpt, date.
4. **Write** a single HTML document:
   - `<!doctype html>` through `</html>`, CSS inline.
   - Article body uses the DS body font, centered, max-width per DS layout
     rule (typically 680–720px).
   - Drop caps (`first-letter`) only if the DS mood is editorial / serif —
     skip on tech-y DSes.
   - `data-section` on the headline, hero, body, pull quote, related grid.
   - Write the page to `design/<slug>/index.html` (assets next to it, relative paths), then follow SKILL.md: critique, publish.
5. **Self-check** (then run `../../references/critique.md`):
   - Type hierarchy is unambiguous — H1 is clearly the headline; H2s are
     section dividers; pull quotes do not compete with H1.
   - Line length 60–75 chars for body prose.
   - Accent appears at most twice (eyebrow + pull-quote rule, or one link).
   - The page reads like a magazine, not a marketing landing.
