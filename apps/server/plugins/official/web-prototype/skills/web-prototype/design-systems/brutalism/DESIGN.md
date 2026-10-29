# Brutalism Design System

> Category: Bold & Expressive
> Raw, anti-design aesthetic inspired by concrete architecture with unadorned elements, jarring layouts, and functional minimalism.
>
> Exact values: `tokens.css` wins. Where a hex value or font name below differs from `tokens.css`, use `tokens.css`; read this file for the style's intent.

## 1. Visual Theme & Atmosphere

Raw, anti-design aesthetic inspired by concrete architecture with unadorned elements, jarring layouts, and functional minimalism.

- **Visual style:** bold
- **Color stance:** primary, secondary, neutral, success, warning, danger
- **Design intent:** Keep outputs recognizable to this style family while preserving usability and readability.

## 2. Color

- **Background:** `#E9E7E2` — Page canvas.
- **Surface:** `#FFFFFF` — Cards, panels, inputs.
- **Text:** `#000000` — Headlines and body copy.
- **Muted:** `#4A4A4A` — Secondary text, captions, metadata.
- **Border:** `#000000` — Dividers, card and input edges.
- **Primary:** `#DD614C` — CTAs, links, active states; text on it is `#000000`.
- **Success:** `#15803D`
- **Warning:** `#DAA144`
- **Danger:** `#DC2626`

- Favor Primary (#DD614C) for CTA emphasis; at most two visible uses per screen.
- Use Background (#E9E7E2) for the page and Surface (#FFFFFF) for cards.
- Keep body copy on Text (#000000) for legibility.

## 3. Typography

- **Scale:** desktop-first expressive scale
- **Families:** display=Archivo Black, body=Arial, mono=Courier Prime (from `tokens.css`)
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

- Buttons: primary action uses `#DD614C`; secondary actions stay neutral.
- Inputs: strong focus-visible states, clear labels, and predictable error messaging.
- Cards/sections: use consistent radii, spacing, and elevation strategy across the page.

## 7. Motion & Interaction

- Use subtle transitions that emphasize Primary (#DD614C) as the interaction signal.
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
