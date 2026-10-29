# Digital E-Guide

Craft: read ../../craft/typography.md, ../../craft/typography-hierarchy.md, ../../craft/typography-hierarchy-editorial.md, ../../craft/rtl-and-bidi.md before writing.

Produce a two-page digital guide preview side-by-side. Cover on the inline-start,
inside spread on the inline-end. Lifestyle creator tone, lots of negative space,
serif display headings, careful column rhythm.

`example.html` is a finished example of this template — study its structure and quality bar, do not copy its copy.

## Workflow

1. Read the design system's `DESIGN.md` and `tokens.css` (see SKILL.md Step 0). Pick a serif display
   token for the title (italic ligatures encouraged), a body serif for
   long-form, and a mono token for stats / labels.
2. **Pick the topic + author** from the brief. Generate a real title (e.g.
   "The Creator's Style & Format Guide"), a real subtitle, and a one-line
   author byline.
3. **Layout** — center two pages on a tinted backdrop:
   - **Page 1 — cover**:
     - Eyebrow ("STYLE & FORMAT GUIDE FOR CREATORS").
     - Display title with mixed weights and one italic flourish word
       ("The Creator's Style & Format guide" — `&` and `guide` italic).
     - 3-cell stat row ("16 PRINCIPLES OF STYLE", "38 DOS & DON'TS",
       "1 BLOCK, ZERO TEMPLATES") in mono, separated by `·`.
     - "What's inside" header with a 2-column TOC (chapters + page numbers
       in mono, leader dots).
     - Footer: "FIND YOUR VOICE" + page 01 mono.
     - Subtle decorative dot or sticker (CSS) in a corner.
   - **Page 2 — spread**:
     - Eyebrow with chapter number + name ("CHAPTER 02 · TONE").
     - Display sub-title ("Write like you talk — only sharper.").
     - 2-column body: opening paragraph + a numbered 4-step list ("01 Pick
       the rule", "02 Drop the filler"…).
     - Pull-quote pinned to inline-end: for Latin scripts use large italic display
       and accent color; for Arabic, Persian, and Urdu use regular or light
       emphasis (no italics); for Hebrew use regular or light emphasis (no
       italics). Include attribution. (script-aware)
     - Bottom strip with "EXERCISE" callout (mono label + 1 sentence prompt
       in italic).
     - Footer: chapter title + page 18 mono.
4. **Write** a single HTML document:
   - `<!doctype html>` through `</html>`, CSS inline.
   - Pages are 600×860 paper-tone cards with 6px shadow, slight rotation
     opposing each other (±0.6deg) for a magazine-on-desk feel.
   - `data-section` on cover, spread, toc, pull-quote, exercise.
5. **Check**, then run `../../references/critique.md`:
   - Type hierarchy is editorial — title owns page 1, sub-title owns page 2.
   - Italic accent appears once per page.
   - Mono used only for labels, stats, and TOC numbers.

## Output

Write the page to `design/<slug>/index.html` (assets next to it, relative paths), then follow SKILL.md: critique, publish.
