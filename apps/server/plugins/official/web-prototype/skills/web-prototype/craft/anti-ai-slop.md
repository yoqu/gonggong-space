# Anti-AI-slop rules

Concrete, checkable rules that distinguish "designed by a human who has
shipped product" from "default LLM output." The P0 rules are not
style preferences — breaking one is a regression. Rules flagged
"(guidance)" are judgement calls for agents and reviewers.

> Adapted from [refero_skill](https://github.com/referodesign/refero_skill)
> (MIT).

## The seven cardinal sins

These are P0 (must-fix):

1. **Default Tailwind indigo as accent** — exactly `#6366f1`, `#4f46e5`,
   `#4338ca`, `#3730a3`, `#8b5cf6`, `#7c3aed`, `#a855f7`. The active
   design system's `tokens.css` provides the brand colour (`--color-primary`); use it. Indigo is the
   textbook AI tell.
2. **Two-stop "trust" gradient on the hero** — purple→blue, blue→cyan,
   indigo→pink. A flat surface + intentional type beats this every
   time.
3. **Emoji as feature icons** — `✨`, `🚀`, `🎯`, `⚡`, `🔥`, `💡`
   inside `<h*>`, `<button>`, `<li>`, or `class*="icon"`. Use
   1.6–1.8px-stroke monoline SVG with `currentColor`.
4. **Sans-serif on display text when the seed binds a serif** — h1/h2
   must use `var(--font-display)`, not a hardcoded Inter / Roboto /
   `system-ui`.
5. **Rounded card with a colored left-border accent** — the canonical
   "AI dashboard tile" shape. Drop either the radius or the left
   border.
6. **Invented metrics** — "10× faster", "99.9% uptime", "3× more
   productive". Either pull from a real source or use a labelled
   placeholder.
7. **Filler copy** — `lorem ipsum`, `feature one / two / three`,
   `placeholder text`, `sample content`. An empty section is a design
   problem to solve with composition, not by inventing words.

## Soft tells (P1 — should fix)

- **Standard "Hero → Features → Pricing → FAQ → CTA" sequence with no
  variation** *(guidance)*. This is the AI-template
  skeleton; introduce at least one unconventional section (testimonial
  wall as full-bleed quote, pricing as comparison-against-status-quo,
  an inline mini-product-demo).
- **External placeholder image CDNs** (`unsplash.com`, `placehold.co`,
  `placekitten.com`, `picsum.photos`). Fragile and obvious. Download a
  real photo into `assets/` and reference it relatively
  (`craft/imagery.md`); a labelled `.gg-ph` only when nothing fits.
- **More than ~12 raw hex values outside `:root`.** Tokens were not
  honoured.
- **The brand colour (`--color-primary`) spread beyond what `DESIGN.md` assigns it.** Use it only
  where the design system says (e.g. primary buttons, highlighted numbers), nowhere decorative.

## Polish tells (P2 — nice to fix)

- **Sections without `data-section`** — reviewers can't point at them.
- **Decorative blob / wave SVG backgrounds** *(guidance)* — meaningless
  geometry.
- **Perfect symmetric layout with no visual tension** *(guidance)* —
  alternating density (one tight section, one
  breathing section) reads as intentional.

## How to add soul without breaking the rules

Aim for **~80% proven patterns + ~20% distinctive choice**. The 20%
should live in:

- One bold visual move — a typography choice, a single color decision,
  an unexpected proportion.
- Voice and microcopy — a button that says "Start tracking" beats one
  that says "Get started".
- One micro-interaction the user will remember — a button press that
  moves 2px, a number that counts up.
- One detail that could only have been put there by someone who used
  the product (a subtle kbd shortcut hint, a status badge with
  product-specific phrasing).

If a reviewer screenshots the page and someone outside the project
can identify which product it's from — you have soul. If not, you
shipped a template.
