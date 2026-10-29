# Premium Design System

> Category: Professional & Corporate
> Premium consumer-hardware aesthetic with precise spacing, modern typography, and a refined, polished visual language.
>
> Exact values: `tokens.css` wins. Where a hex value or font name below differs from `tokens.css`, use `tokens.css`; read this file for the style's intent.

## 1. Visual Theme & Atmosphere

Premium consumer-hardware aesthetic with precise spacing, modern typography, and a refined, polished visual language.

- **Visual style:** modern
- **Color stance:** primary, neutral, success, warning, danger
- **Design intent:** Keep outputs recognizable to this style family while preserving usability and readability.

## 2. Color

- **Background:** `#1D1D1F` — Page canvas.
- **Surface:** `#2A2A2D` — Cards, panels, inputs.
- **Text:** `#F5F5F7` — Headlines and body copy.
- **Muted:** `#A1A1A6` — Secondary text, captions, metadata.
- **Border:** `#3A3A3D` — Dividers, card and input edges.
- **Primary:** `#D6C3A1` — CTAs, links, active states; text on it is `#1D1D1F`.
- **Success:** `#4ADE80`
- **Warning:** `#FBBF24`
- **Danger:** `#F87171`

- Favor Primary (#D6C3A1) for CTA emphasis; at most two visible uses per screen.
- Use Background (#1D1D1F) for the page and Surface (#2A2A2D) for cards.
- Keep body copy on Text (#F5F5F7) for legibility.

## 3. Typography

- **Scale:** 12/14/16/18/24/30/36
- **Families:** display=Fraunces, body=Inter, mono=IBM Plex Mono (from `tokens.css`)
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

- Buttons: primary action uses `#D6C3A1`; secondary actions stay neutral.
- Inputs: strong focus-visible states, clear labels, and predictable error messaging.
- Cards/sections: use consistent radii, spacing, and elevation strategy across the page.

## 7. Motion & Interaction

- Use subtle transitions that emphasize Primary (#D6C3A1) as the interaction signal.
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
