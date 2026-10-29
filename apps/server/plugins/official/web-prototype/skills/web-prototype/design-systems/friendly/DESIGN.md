# Friendly Design System

> Category: Creative & Artistic
> Approachable, intuitive design with rounded elements, ample whitespace, and soft pastel color palettes.
>
> Exact values: `tokens.css` wins. Where a hex value or font name below differs from `tokens.css`, use `tokens.css`; read this file for the style's intent.

## 1. Visual Theme & Atmosphere

Approachable, intuitive design with rounded elements, ample whitespace, and soft pastel color palettes.

- **Visual style:** bold, playful, premium
- **Color stance:** primary, secondary, neutral
- **Design intent:** Keep outputs recognizable to this style family while preserving usability and readability.

## 2. Color

- **Background:** `#FFFAF7` — Page canvas.
- **Surface:** `#FFFFFF` — Cards, panels, inputs.
- **Tint:** `#E98A9B` — Highlighted tiles and secondary panels.
- **Text:** `#2D2A32` — Headlines and body copy.
- **Muted:** `#68616E` — Secondary text, captions, metadata.
- **Border:** `#F0E1E3` — Dividers, card and input edges.
- **Primary:** `#E98A9B` — CTAs, links, active states; text on it is `#2D1A1F`.
- **Success:** `#3F9A5A`
- **Warning:** `#B45309`
- **Danger:** `#DC2626`

- Favor Primary (#E98A9B) for CTA emphasis; at most two visible uses per screen.
- Use Background (#FFFAF7) for the page and Surface (#FFFFFF) for cards.
- Keep body copy on Text (#2D2A32) for legibility.

## 3. Typography

- **Scale:** 14/16/18/24/32/40
- **Families:** display=Quicksand, body=Nunito, mono=JetBrains Mono (from `tokens.css`)
- **Weights:** 100, 200, 300, 400, 500, 600, 700, 800, 900
- Headings should carry the style personality; body text should optimize scanability and contrast.

## 4. Spacing & Grid

- **Spacing scale:** compact density mode
- Keep vertical rhythm consistent across sections and components.
- Align columns and modules to a predictable grid; avoid ad-hoc offsets.

## 5. Layout & Composition

- Prefer clear content blocks with consistent internal padding.
- Keep hierarchy obvious: headline → support text → primary action.
- Use whitespace to separate concerns before adding borders or shadows.

## 6. Components

- Buttons: primary action uses `#E98A9B`; secondary actions stay neutral.
- Inputs: strong focus-visible states, clear labels, and predictable error messaging.
- Cards/sections: use consistent radii, spacing, and elevation strategy across the page.

## 7. Motion & Interaction

- Use subtle transitions that emphasize Primary (#E98A9B) as the interaction signal.
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
