# Skeumorphism Design System

> Category: Morphism & Effects
> Real-world mimicry with textured surfaces, 3D effects, and familiar physical metaphors for intuitive digital interfaces.
>
> Exact values: `tokens.css` wins. Where a hex value or font name below differs from `tokens.css`, use `tokens.css`; read this file for the style's intent.

## 1. Visual Theme & Atmosphere

Real-world mimicry with textured surfaces, 3D effects, and familiar physical metaphors for intuitive digital interfaces.

- **Visual style:** playful
- **Color stance:** primary, secondary, neutral, success, warning, danger
- **Design intent:** Keep outputs recognizable to this style family while preserving usability and readability.

## 2. Color

- **Background:** `#DDD3C4` — Page canvas.
- **Surface:** `#F4EFE6` — Cards, panels, inputs.
- **Text:** `#2A2420` — Headlines and body copy.
- **Muted:** `#564C44` — Secondary text, captions, metadata.
- **Border:** `#B5A894` — Dividers, card and input edges.
- **Primary:** `#D7261E` — CTAs, links, active states; text on it is `#FFFFFF`.
- **Success:** `#15803D`
- **Warning:** `#F08321`
- **Danger:** `#DC2626`

- Favor Primary (#D7261E) for CTA emphasis; at most two visible uses per screen.
- Use Background (#DDD3C4) for the page and Surface (#F4EFE6) for cards.
- Keep body copy on Text (#2A2420) for legibility.

## 3. Typography

- **Scale:** 12/14/16/20/24/32
- **Families:** display=Lora, body=Inter, mono=JetBrains Mono (from `tokens.css`)
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

- Buttons: primary action uses `#D7261E`; secondary actions stay neutral.
- Inputs: strong focus-visible states, clear labels, and predictable error messaging.
- Cards/sections: use consistent radii, spacing, and elevation strategy across the page.

## 7. Motion & Interaction

- Use subtle transitions that emphasize Primary (#D7261E) as the interaction signal.
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
