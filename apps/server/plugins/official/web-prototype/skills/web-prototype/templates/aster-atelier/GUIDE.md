# Aster Atelier

Design system: optional — this template has its own visual language; use the design system only for accent colour and fonts.

Use this template when the user wants an artistic creative-studio website with classical imagery, cobalt skies, elegant serif typography and cinematic scrolling.

Start from `example.html`. It is the full runnable source, with embedded original artwork, styles and JavaScript. Keep its visual composition and functional interactions while adapting the brand and copy to the user's brief. Do not substitute a screenshot or use an unrelated website as source.

License: this template folder is MIT-licensed (`LICENSE`), separate from the rest of the plugin. `ASSET-SOURCES.md` records the original generated art and code provenance. Keep both files with any redistributed copy of the seed. The demo brand does not represent a real client or imply endorsement.

## Visual system

- Palette: cobalt `#0758bc`, deep night `#083d86`, ivory `#fffaf0`, parchment `#fff6e3`, bronze `#f5cf7c`.
- System serif typography: Georgia / Times New Roman; system sans and monospace for body and coordinates. No fonts are distributed.
- Editorial composition: generous side margins, large serif headings, small uppercase coordinates, fine rules and open space.
- Five chapters: astronomer hero, point-cloud instrument / approach, observatory artwork and services, questions / contact, oversized wordmark footer.
- The two original illustrations are embedded WebP data URIs. Reuse them directly, preserving aspect and focus; do not fetch the previous inspiration site's resources.
- The armillary instrument is original Canvas 2D point-cloud code with three-dimensional rotation, drawn procedurally. Preserve its animation visibility gating and DPR cap.

## Interaction contract

- Hero CTA scrolls to approach. Navigation has functioning chapter anchors.
- Navigation and contact use native `dialog`, with close buttons, Escape handling and focus return.
- Services and FAQ use native `details` / `summary`.
- Form inputs have visible labels, HTML validation and local-only save feedback. No fake submission or external endpoint. The user can download a text brief.
- Honor reduced motion. Stop the canvas loop while offscreen or in a hidden tab.
- Preserve mobile layout at 390px, legible headings, usable controls and no horizontal overflow.

## Workflow

1. Read the seed and the user's brand/context; keep sensible defaults for missing optional details.
2. Edit copy, semantic content and brand without flattening the layout.
3. Keep it self-contained. Do not introduce external scripts, paid images or fonts.
4. Check hero, all chapter links, menus, modal focus, forms and mobile overflow.
5. Read `references/checklist.md` and pass its P0 gates, then run `../../references/critique.md`.
6. Write the page to `design/<slug>/index.html` (assets next to it, relative paths), then follow SKILL.md: critique, publish. Describe backend behavior honestly. Never fabricate project metrics, awards or client endorsements.
