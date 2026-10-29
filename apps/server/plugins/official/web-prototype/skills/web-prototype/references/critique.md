# Design review — five dimensions

Before you publish, review the page you just wrote against five dimensions and fix what falls short. This is a quality bar, not a performance: do the review, apply the fixes, and describe the outcome in ordinary prose.

Run the template's checklist (the end of `templates/<id>/GUIDE.md`) first — every P0 item must pass. Then review the five dimensions below.

## The five dimensions

Judge the page from five angles. Each one owns its own scope; do not let a strength in one excuse a failure in another.

- **Craft** — layout, hierarchy, spacing, alignment, and visual rhythm. Does it read as deliberate work rather than a template with the words swapped out? Compare against the template's `example/`: yours should hold the same level of finish.
- **Critique** — does it actually solve the request in the creation message? Look for the weakest claim, the thinnest section, the thing a sceptical reviewer would attack first. Every input the requester gave (title, points, audience, tone, attachments) must show up where it matters.
- **Brand** — does it follow the chosen design system's `tokens.css` and `DESIGN.md`: colours, fonts, radius, density, voice? No colours outside the tokens; one accent, used sparingly. A design-system violation is a defect even when the result looks pleasant.
- **Accessibility** — contrast (body text ≥ 4.5:1, large text ≥ 3:1), touch targets ≥ 44px on mobile, visible focus, labels on inputs and icon buttons, keyboard-reachable controls, sensible heading order, `lang` on `<html>`. See `craft/accessibility-baseline.md`.
- **Copy** — specific, readable, in the request's language, free of filler. Placeholder phrasing ("Lorem", "Feature One", "Metric A"), invented testimonials or logos, and marketing padding all count as defects. See `craft/anti-ai-slop.md`.

## What to do with the findings

Record each concrete defect and fix it in the same turn. A finding you cannot fix (missing real imagery, missing data) is worth stating plainly in the final reply, with the reason, so the group can decide.

Keep iterating while defects remain. Stop when the page clears all five dimensions, or when further rounds stop producing real improvements — three passes is a sensible ceiling.

## How to report it

In the final reply, one or two plain sentences on what you checked and fixed, and anything deliberately left alone. Do not write a scored panel, a review transcript, reviewer personas, or a `critique.json` file.
