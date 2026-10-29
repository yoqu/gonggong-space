# Email Marketing

A brand product-launch email — masthead with wordmark, hero image block, headline lockup with skewed-italic accent, body copy, primary CTA, and a specifications grid. Pure HTML email layout (centered single column, table fallback). Use when the brief asks for an "email", "newsletter blast", "MJML", "product launch email", or "email template".

Produce a single HTML email — centered, single column, no chrome around the email body. Treat it like a marketing piece: one big idea, one CTA.

`example.html` is a finished example of this template — study its structure and quality bar, do not copy its copy.

## Workflow

1. **Read the design system's `DESIGN.md` and `tokens.css`** (see SKILL.md Step 0). Email leans on the display
   font more than any other surface — pick the loudest type token in the DS
   for the headline lockup.
2. **Pick the brand + product** from the brief. Generate a real wordmark, a
   real product name, and one real benefit sentence — no placeholders.
3. **Layout**, in order, all centered inside a 600–680px column on a tinted
   page background (so the email body looks like an email, not the page):
   - **Masthead** — wordmark on the left + 3 short nav links (SHOP, JOURNAL,
     MEMBERS) on the right. Thin underline.
   - **Hero block** — a 16:9 product image placeholder. Use a DS-tinted
     gradient or a stylized SVG silhouette of the product (shoe, bottle,
     headphones, whatever the brief implies). Add a tiny brand stamp on the
     top-left and a colorway tag on the bottom-left.
   - **Eyebrow** — small caps, accent color, separated by `·` characters
     (e.g. "NEW · MAX-CUSHION TRAINER · EMBER FLARE").
   - **Headline lockup** — 2–3 line headline using the display font, all caps,
     extra-tight tracking. Apply a slight skew (`transform: skew(-6deg)`) on
     one accent word to give it a sporty parallelogram feel.
   - **Body** — 2–3 sentence paragraph, left-aligned, body font.
   - **Primary CTA** — solid pill or block button. One only.
   - **Specs grid** — 2×2 grid of (big number + unit + label) callouts using
     the display font for the numbers.
   - **Footer** — wordmark, address line, unsubscribe + view-in-browser links.
4. **Write** a single HTML document:
   - `<!doctype html>` through `</html>`, CSS inline.
   - Center the column with `margin: 0 auto`. Set `body { background: <tint> }`
     so the email-on-page metaphor reads.
   - No external images — use inline SVG or DS-tinted gradient blocks for the
     product photo.
   - `data-section` on the masthead, hero, headline, CTA, specs.
   - Write the page to `design/<slug>/index.html` (assets next to it, relative paths), then follow SKILL.md: critique, publish.
5. **Self-check** (then run `../../references/critique.md`):
   - Email reads top to bottom in 8–10 seconds.
   - One CTA. Accent appears at most twice (eyebrow + CTA, or headline word).
   - Looks legible on a 480px window (column reflows, type drops one step).
