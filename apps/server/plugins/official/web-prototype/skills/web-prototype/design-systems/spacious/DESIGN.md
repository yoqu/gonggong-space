# Spacious Design System

> Category: Layout & Structure
> Generous whitespace, consistent padding, and grid-based layouts for clean, readable, and breathing interfaces.
>
> Exact values: `tokens.css` wins. Where a hex value or font name below differs from `tokens.css`, use `tokens.css`; read this file for the style's intent.

## 1. Visual Theme & Atmosphere

Generous whitespace, consistent padding, and grid-based layouts for clean, readable, and breathing interfaces.

- **Visual style:** minimal, clean
- **Color stance:** primary, neutral, success, warning, danger
- **Design intent:** Keep outputs recognizable to this style family while preserving usability and readability.

## 2. Color

- **Background:** `#F7F3EC` — Page canvas.
- **Surface:** `#FFFFFF` — Cards, panels, inputs.
- **Text:** `#1F1A14` — Headlines and body copy.
- **Muted:** `#5F5647` — Secondary text, captions, metadata.
- **Border:** `#E6DDCF` — Dividers, card and input edges.
- **Primary:** `#0E7490` — CTAs, links, active states; text on it is `#FFFFFF`.
- **Success:** `#15803D`
- **Warning:** `#B45309`
- **Danger:** `#DC2626`

- Favor Primary (#0E7490) for CTA emphasis; at most two visible uses per screen.
- Use Background (#F7F3EC) for the page and Surface (#FFFFFF) for cards.
- Keep body copy on Text (#1F1A14) for legibility.

## 3. Typography

- **Scale:** 12/14/16/18/24/30/36
- **Families:** display=DM Sans, body=DM Sans, mono=JetBrains Mono (from `tokens.css`)
- **Weights:** 100, 200, 300, 400, 500, 600, 700, 800, 900
- Headings should carry the style personality; body text should optimize scanability and contrast.

## 4. Spacing & Grid

- **Spacing scale:** 8pt baseline grid
- Keep vertical rhythm consistent across sections and components.
- Align columns and modules to a predictable grid; avoid ad-hoc offsets.

## 5. Layout & Composition

- Prefer clear content blocks with consistent internal padding.
- Keep hierarchy obvious: headline → support text → primary action.
- Use whitespace to separate concerns before adding borders or shadows.

## 6. Components

- Buttons: primary action uses `#0E7490`; secondary actions stay neutral.
- Inputs: strong focus-visible states, clear labels, and predictable error messaging.
- Cards/sections: use consistent radii, spacing, and elevation strategy across the page.

## 7. Motion & Interaction

- Use subtle transitions that emphasize Primary (#0E7490) as the interaction signal.
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
