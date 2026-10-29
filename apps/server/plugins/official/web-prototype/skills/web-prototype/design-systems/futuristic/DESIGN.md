# Futuristic Design System

> Category: Themed & Unique
> Forward-looking design with tech-inspired typography, modern layouts, and a sleek, innovation-driven aesthetic.
>
> Exact values: `tokens.css` wins. Where a hex value or font name below differs from `tokens.css`, use `tokens.css`; read this file for the style's intent.

## 1. Visual Theme & Atmosphere

Forward-looking design with tech-inspired typography, modern layouts, and a sleek, innovation-driven aesthetic.

- **Visual style:** modern
- **Color stance:** primary, neutral, success, warning, danger
- **Design intent:** Keep outputs recognizable to this style family while preserving usability and readability.

## 2. Color

- **Background:** `#E8EBEF` — Page canvas.
- **Surface:** `#F6F7F9` — Cards, panels, inputs.
- **Text:** `#0B0F14` — Headlines and body copy.
- **Muted:** `#525C68` — Secondary text, captions, metadata.
- **Border:** `#C8D0D9` — Dividers, card and input edges.
- **Primary:** `#FF2D55` — CTAs, links, active states; text on it is `#0B0F14`.
- **Success:** `#15803D`
- **Warning:** `#B45309`
- **Danger:** `#DC2626`

- Favor Primary (#FF2D55) for CTA emphasis; at most two visible uses per screen.
- Use Background (#E8EBEF) for the page and Surface (#F6F7F9) for cards.
- Keep body copy on Text (#0B0F14) for legibility.

## 3. Typography

- **Scale:** desktop-first expressive scale
- **Families:** display=Chakra Petch, body=Inter, mono=JetBrains Mono (from `tokens.css`)
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

- Buttons: primary action uses `#FF2D55`; secondary actions stay neutral.
- Inputs: strong focus-visible states, clear labels, and predictable error messaging.
- Cards/sections: use consistent radii, spacing, and elevation strategy across the page.

## 7. Motion & Interaction

- Use subtle transitions that emphasize Primary (#FF2D55) as the interaction signal.
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
