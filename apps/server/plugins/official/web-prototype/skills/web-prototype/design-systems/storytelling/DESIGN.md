# Storytelling Design System

> Category: Creative & Artistic
> Narrative-driven design using visuals, copy, and interaction to guide users through engaging, emotionally resonant journeys.
>
> Exact values: `tokens.css` wins. Where a hex value or font name below differs from `tokens.css`, use `tokens.css`; read this file for the style's intent.

## 1. Visual Theme & Atmosphere

Narrative-driven design using visuals, copy, and interaction to guide users through engaging, emotionally resonant journeys.

- **Visual style:** playful
- **Color stance:** primary, neutral, success, warning, danger
- **Design intent:** Keep outputs recognizable to this style family while preserving usability and readability.

## 2. Color

- **Background:** `#1B1714` — Page canvas.
- **Surface:** `#252019` — Cards, panels, inputs.
- **Text:** `#F3EBE0` — Headlines and body copy.
- **Muted:** `#B3A796` — Secondary text, captions, metadata.
- **Border:** `#3D342B` — Dividers, card and input edges.
- **Primary:** `#E8A35C` — CTAs, links, active states; text on it is `#1B1714`.
- **Success:** `#4ADE80`
- **Warning:** `#FBBF24`
- **Danger:** `#F87171`

- Favor Primary (#E8A35C) for CTA emphasis; at most two visible uses per screen.
- Use Background (#1B1714) for the page and Surface (#252019) for cards.
- Keep body copy on Text (#F3EBE0) for legibility.

## 3. Typography

- **Scale:** desktop-first expressive scale
- **Families:** display=Fraunces, body=Source Serif 4, mono=JetBrains Mono (from `tokens.css`)
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

- Buttons: primary action uses `#E8A35C`; secondary actions stay neutral.
- Inputs: strong focus-visible states, clear labels, and predictable error messaging.
- Cards/sections: use consistent radii, spacing, and elevation strategy across the page.

## 7. Motion & Interaction

- Use subtle transitions that emphasize Primary (#E8A35C) as the interaction signal.
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
