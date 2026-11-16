# Deck review — five dimensions

Before you publish, review the deck you just wrote against five dimensions and fix what falls short. This is a quality bar, not a performance: do the review, apply the fixes, and describe the outcome in ordinary prose.

If the template has its own checklist (`templates/<id>/checklist.md` or `templates/<id>/references/checklist.md`), run it first — every P0 item must pass. Then review the five dimensions below.

## The five dimensions

Judge the deck from five angles. Each one owns its own scope; do not let a strength in one excuse a failure in another.

- **Craft** — every slide fits the 16:9 stage with nothing clipped or overflowing, hierarchy reads at a glance from the back of the room, alignment and spacing follow the template's grid, and the sequence has rhythm (no three dense slides in a row; covers, section breaks and big-number slides give the eye a rest). Compare against the template's example: yours should hold the same level of finish.
- **Critique** — does the deck make its case for the audience in the creation message? Read only the slide titles in order: they should tell the whole story. Look for the weakest claim and the slide a sceptical listener would attack first. Every input the requester gave (topic, points, audience, page count, speaker notes, attachments) must show up where it matters.
- **Brand** — stays inside the template's own visual system (or the design system it names): its palette, fonts, slide vocabulary and decoration. Do not mix layouts from other templates or add colours the system does not have.
- **Accessibility** — contrast (body text ≥ 4.5:1, large text ≥ 3:1), body text no smaller than the template's body size, `lang` on `<html>`, keyboard navigation (← → at least) still works and `?` opens the presenting toolkit (`./assets/deck-toolkit.js` loaded in `<head>`), charts carry their numbers as text, not colour alone. See `craft/accessibility-baseline.md`.
- **Copy** — one idea per slide; titles are claims, not topic labels ("留存三个月翻倍", not "留存数据"); specific, in the request's language, no filler. Placeholder phrasing, invented numbers, quotes, logos or customers count as defects. Presenter-only text belongs in the speaker notes, never on the slide. See `craft/anti-ai-slop.md`.

## What to do with the findings

Record each concrete defect and fix it in the same turn. Open the deck in a headless browser and step through the slides when you can; overflow is the most common defect and is invisible in the source. A finding you cannot fix (missing real imagery, missing data) is worth stating plainly in the final reply, with the reason, so the group can decide.

Keep iterating while defects remain. Stop when the deck clears all five dimensions, or when further rounds stop producing real improvements — three passes is a sensible ceiling.

## How to report it

In the final reply, one or two plain sentences on what you checked and fixed, and anything deliberately left alone. Do not write a scored panel, a review transcript, reviewer personas, or a `critique.json` file.
