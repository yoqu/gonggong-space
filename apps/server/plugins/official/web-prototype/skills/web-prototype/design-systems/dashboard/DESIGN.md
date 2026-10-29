# Dashboard Design System

> Category: Professional & Corporate
> Dark-themed cloud-platform aesthetic with modular grids, glass-like panels, and strong data hierarchy for productivity dashboards.
>
> Exact values: `tokens.css` wins. Where a hex value or font name below differs from `tokens.css`, use `tokens.css`; read this file for the style's intent.

## 1. Visual Theme & Atmosphere

Dark-themed cloud-platform aesthetic with modular grids, glass-like panels, and strong data hierarchy for productivity dashboards.

- **Visual style:** modern, clean, cloud-platform aesthetic, dark theme, subtle gradients, soft shadows, glass-like panels, rounded components
- **Color stance:** primary, neutral, success, warning, danger
- **Design intent:** Keep outputs recognizable to this style family while preserving usability and readability.

## 2. Color

- **Background:** `#09090B` — Page canvas.
- **Surface:** `#131316` — Cards, panels, inputs.
- **Text:** `#FAFAFA` — Headlines and body copy.
- **Muted:** `#A1A1AA` — Secondary text, captions, metadata.
- **Border:** `#27272A` — Dividers, card and input edges.
- **Primary:** `#0C5CAB` — CTAs, links, active states; text on it is `#FFFFFF`.
- **Success:** `#10B981`
- **Warning:** `#F59E0B`
- **Danger:** `#EF4444`

- Favor Primary (#0C5CAB) for CTA emphasis; at most two visible uses per screen.
- Use Background (#09090B) for the page and Surface (#131316) for cards.
- Keep body copy on Text (#FAFAFA) for legibility.

## 3. Typography

- **Scale:** 12/14/16/20/24/32
- **Families:** display=Inter, body=Inter, mono=IBM Plex Mono (from `tokens.css`)
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

- Buttons: primary action uses `#0C5CAB`; secondary actions stay neutral.
- Inputs: strong focus-visible states, clear labels, and predictable error messaging.
- Cards/sections: use consistent radii, spacing, and elevation strategy across the page.

## 7. Motion & Interaction

- Use subtle transitions that emphasize Primary (#0C5CAB) as the interaction signal.
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
