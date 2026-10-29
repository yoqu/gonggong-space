# Expressive Design System

> Category: Bold & Expressive
> Vibrant, personality-driven design with bold colors, playful graphics, and dynamic layouts that balance creativity with structure.
>
> Exact values: `tokens.css` wins. Where a hex value or font name below differs from `tokens.css`, use `tokens.css`; read this file for the style's intent.

## 1. Visual Theme & Atmosphere

Vibrant, personality-driven design with bold colors, playful graphics, and dynamic layouts that balance creativity with structure.

- **Visual style:** modern, playful
- **Color stance:** primary, secondary, neutral, success, warning, danger
- **Design intent:** Keep outputs recognizable to this style family while preserving usability and readability.

## 2. Color

- **Background:** `#FFF7FB` — Page canvas.
- **Surface:** `#FFFFFF` — Cards, panels, inputs.
- **Text:** `#1F1023` — Headlines and body copy.
- **Muted:** `#6A5470` — Secondary text, captions, metadata.
- **Border:** `#F2D5E5` — Dividers, card and input edges.
- **Primary:** `#DB2777` — CTAs, links, active states; text on it is `#FFFFFF`.
- **Success:** `#15803D`
- **Warning:** `#B45309`
- **Danger:** `#DC2626`

- Favor Primary (#DB2777) for CTA emphasis; at most two visible uses per screen.
- Use Background (#FFF7FB) for the page and Surface (#FFFFFF) for cards.
- Keep body copy on Text (#1F1023) for legibility.

## 3. Typography

- **Scale:** 14/16/18/24/32/40
- **Families:** display=Syne, body=Inter, mono=JetBrains Mono (from `tokens.css`)
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

- Buttons: primary action uses `#DB2777`; secondary actions stay neutral.
- Inputs: strong focus-visible states, clear labels, and predictable error messaging.
- Cards/sections: use consistent radii, spacing, and elevation strategy across the page.

## 7. Motion & Interaction

- Use subtle transitions that emphasize Primary (#DB2777) as the interaction signal.
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
