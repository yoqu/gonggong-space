# Gamified App

Craft: read ../../craft/state-coverage.md, ../../craft/animation-discipline.md before writing.

Produce a multi-screen gamified mobile prototype (habit tracker, RPG-style life app, daily quests, XP / streak app) on a single dark showcase page. Three phone frames side-by-side, each one its own moment in the journey.

`example.html` is a finished example of this template — study its structure and quality bar, do not copy its copy.

## Workflow

1. **Read the design system's `DESIGN.md` and `tokens.css`** (see SKILL.md Step 0). For gamified apps, lean
   on bold display type for headlines and a brighter, broader palette than
   most products — quests look like quests because the colors do.
2. **Pick the brand + value prop** from the brief. Generate real quest
   names (e.g. "Body — 20-min strength: pushups & planks", "Read — Four
   Thousand Weeks", "Listen — Huberman Lab · Sleep Architecture",
   "Nourish — Cook a high-protein lunch", "Mind — 10-min focus
   meditation", "Watch — The Bear · S3 E4").
3. **Stage** — full-bleed dark page (near-black `#0e0d0c` or DS dark token)
   with a soft top spotlight gradient. Above the phones, a small caption
   row: "HI-FI PROTOTYPE · IPHONE" left, brand wordmark right, both in mono.
4. **Phones** — three 360×780 phone frames in a horizontal row (wraps to
   stack on narrow viewports). Each phone:
   - 12px black bezel, 44px corner radius, dynamic-island notch.
   - Status bar (time / signal / battery).
   - Phone-specific content (below).
   - Bottom tab bar with 5 icons (Today, Library, Stats, ⊕ central CTA,
     Profile). Active tab in accent.
5. **Phone 1 — cover poster (sales/value prop)**:
   - Status bar.
   - HI-FI PROTOTYPE · IPHONE eyebrow.
   - Big display headline ("Daily quests for becoming a better human."),
     accent on "becoming".
   - 1–2 sentence body in muted serif/sans.
   - Mono tip line ("Tap quests to open detail. Toggle [theme] in the
     toolbar to switch theme & layout.")
   - Subtle scrolling teaser of the next screen at the bottom edge.
6. **Phone 2 — today's quests dashboard** (the hero screen):
   - Greeting "Good morning, Sam" + small XP-bell ringing.
   - Level ribbon — "LV 14 · Level 14 · 1648 / 2480 XP" with a progress
     bar inside a glassmorphic ribbon.
   - Sub-line: "8 quests waiting · earn 430 XP today".
   - 3×2 grid of quest tiles. Each tile: rounded corner, pastel accent
     color, glyph chip in top-left, title, mini-meta line, "+NN XP" pill
     in bottom-right.
   - Bottom tab bar.
7. **Phone 3 — quest detail**:
   - Back arrow + screen title ("Quest").
   - Hero block with the quest's accent color, big serif quest title
     ("Body — strength"), short narrative body, "REWARD +90 XP" stamp.
   - Steps checklist (3–4 micro-tasks, one done, two pending).
   - Big primary CTA "Start quest" pill at the bottom in accent.
8. **Write** a single HTML document:
   - `<!doctype html>` through `</html>`, CSS inline.
   - All in CSS — no images. Use `linear-gradient` and inline SVG glyphs
     for tile chips and tab icons.
   - `data-section` on stage, each phone, each frame's regions.
9. **Check**, then run `../../references/critique.md`:
   - Three frames, each with a distinct purpose. Not three copies of the
     same screen.
   - Tile colors don't overpower — each quest tile uses a different pastel
     against the same neutral surface.
   - Reads as gamified and adult — playful, not childish.

## Output

Write the page to `design/<slug>/index.html` (assets next to it, relative paths), then follow SKILL.md: critique, publish.
