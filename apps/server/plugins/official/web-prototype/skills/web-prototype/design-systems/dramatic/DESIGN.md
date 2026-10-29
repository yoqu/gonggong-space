# Dramatic Design System

> Category: Bold & Expressive
> High-contrast, theatrical design with bold layouts, immersive visuals, and unconventional compositions that command attention.
>
> Exact values: `tokens.css` wins. Where a hex value or font name below differs from `tokens.css`, use `tokens.css`; read this file for the style's intent.

## 1. Visual Theme & Atmosphere

High-contrast, theatrical design with bold layouts, immersive visuals, and unconventional compositions that command attention.

- **Visual style:** modern, clean, high-contrast
- **Color stance:** primary, neutral, success, warning, danger
- **Design intent:** Keep outputs recognizable to this style family while preserving usability and readability.

## 2. Color

- **Background:** `#0D0A14` — Page canvas.
- **Surface:** `#17121F` — Cards, panels, inputs.
- **Text:** `#FAF8FF` — Headlines and body copy.
- **Muted:** `#A8A0BB` — Secondary text, captions, metadata.
- **Border:** `#2E2540` — Dividers, card and input edges.
- **Primary:** `#7C3AED` — CTAs, links, active states; text on it is `#FFFFFF`.
- **Success:** `#4ADE80`
- **Warning:** `#FBBF24`
- **Danger:** `#F43F5E`

- Favor Primary (#7C3AED) for CTA emphasis; at most two visible uses per screen.
- Use Background (#0D0A14) for the page and Surface (#17121F) for cards.
- Keep body copy on Text (#FAF8FF) for legibility.

## 3. Typography

- **Scale:** 12/14/16/20/24/32
- **Families:** display=Playfair Display, body=Inter, mono=JetBrains Mono (from `tokens.css`)
- **Weights:** 400, 900
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

- Buttons: primary action uses `#7C3AED`; secondary actions stay neutral.
- Inputs: strong focus-visible states, clear labels, and predictable error messaging.
- Cards/sections: use consistent radii, spacing, and elevation strategy across the page.

## 7. Motion & Interaction

- Use subtle transitions that emphasize Primary (#7C3AED) as the interaction signal.
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
