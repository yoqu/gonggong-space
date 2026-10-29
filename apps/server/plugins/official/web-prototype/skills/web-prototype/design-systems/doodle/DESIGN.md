# Doodle Design System

> Category: Creative & Artistic
> Hand-drawn, sketch-like style with doodles, handwritten fonts, and imperfect lines for a playful, informal feel.
>
> Exact values: `tokens.css` wins. Where a hex value or font name below differs from `tokens.css`, use `tokens.css`; read this file for the style's intent.

## 1. Visual Theme & Atmosphere

Hand-drawn, sketch-like style with doodles, handwritten fonts, and imperfect lines for a playful, informal feel.

- **Visual style:** playful
- **Color stance:** primary, secondary, neutral, success, warning, danger
- **Design intent:** Keep outputs recognizable to this style family while preserving usability and readability.

## 2. Color

- **Background:** `#FFFDF6` — Page canvas.
- **Surface:** `#FFFFFF` — Cards, panels, inputs.
- **Tint:** `#E3F4FB` — Highlighted tiles and secondary panels.
- **Text:** `#263D5B` — Headlines and body copy.
- **Muted:** `#56657B` — Secondary text, captions, metadata.
- **Border:** `#263D5B` — Dividers, card and input edges.
- **Primary:** `#49B6E5` — CTAs, links, active states; text on it is `#0F2236`.
- **Success:** `#15803D`
- **Warning:** `#B45309`
- **Danger:** `#DC2626`

- Favor Primary (#49B6E5) for CTA emphasis; at most two visible uses per screen.
- Use Background (#FFFDF6) for the page and Surface (#FFFFFF) for cards.
- Keep body copy on Text (#263D5B) for legibility.

## 3. Typography

- **Scale:** 14/16/18/24/32/40
- **Families:** display=Patrick Hand, body=Nunito, mono=JetBrains Mono (from `tokens.css`)
- **Weights:** 100, 200, 300, 400, 500, 600, 700, 800, 900
- Headings should carry the style personality; body text should optimize scanability and contrast.

## 4. Spacing & Grid

- **Spacing scale:** 4/8/12/16/24/32
- Keep vertical rhythm consistent across sections and components.
- Align columns and modules to a predictable grid; avoid ad-hoc offsets.

## 5. Layout & Composition

- Prefer clear content blocks with consistent internal padding.
- Keep hierarchy obvious: headline → support text → primary action.
- Use whitespace to separate concerns before adding borders or shadows.

## 6. Components

- Buttons: primary action uses `#49B6E5`; secondary actions stay neutral.
- Inputs: strong focus-visible states, clear labels, and predictable error messaging.
- Cards/sections: use consistent radii, spacing, and elevation strategy across the page.

## 7. Motion & Interaction

- Use subtle transitions that emphasize Primary (#49B6E5) as the interaction signal.
- Default to short, purposeful transitions (150–250ms) with stable easing.
- Ensure hover, focus-visible, active, disabled, and loading states are explicit.

## 8. Voice & Brand

- Tone should reflect the visual style: concise, confident, and product-specific.
- Keep microcopy action-oriented and avoid generic filler language.
- Preserve the style identity in headlines while keeping UI labels literal and clear.

## 9. Anti-patterns

- Do not introduce off-palette colors when an existing token can solve the problem.
- Do not flatten hierarchy by using the same type size/weight for all text.
- Do not add decorative effects that reduce readability or accessibility.
- Do not mix unrelated visual metaphors in the same interface.
