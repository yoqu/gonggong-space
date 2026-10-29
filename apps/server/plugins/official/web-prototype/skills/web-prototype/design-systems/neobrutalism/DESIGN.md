# Neobrutalism Design System

> Category: Bold & Expressive
> Modern take on brutalism with bold borders, vivid accent colors, and raw, high-contrast layouts on warm surfaces.
>
> Exact values: `tokens.css` wins. Where a hex value or font name below differs from `tokens.css`, use `tokens.css`; read this file for the style's intent.

## 1. Visual Theme & Atmosphere

Modern take on brutalism with bold borders, vivid accent colors, and raw, high-contrast layouts on warm surfaces.

- **Visual style:** modern, clean, high-contrast
- **Color stance:** primary, neutral, success, warning, danger
- **Design intent:** Keep outputs recognizable to this style family while preserving usability and readability.

## 2. Color

- **Background:** `#FBFBF9` — Page canvas.
- **Surface:** `#FFFFFF` — Cards, panels, inputs.
- **Tint:** `#E7E3FF` — Highlighted tiles and secondary panels.
- **Text:** `#1C293C` — Headlines and body copy.
- **Muted:** `#4F5B6D` — Secondary text, captions, metadata.
- **Border:** `#1C293C` — Dividers, card and input edges.
- **Primary:** `#FDC800` — CTAs, links, active states; text on it is `#1C293C`.
- **Success:** `#15803D`
- **Warning:** `#B45309`
- **Danger:** `#DC2626`

- Favor Primary (#FDC800) for CTA emphasis; at most two visible uses per screen.
- Use Background (#FBFBF9) for the page and Surface (#FFFFFF) for cards.
- Keep body copy on Text (#1C293C) for legibility.

## 3. Typography

- **Scale:** 13/15/17/21/27/35
- **Families:** display=Space Grotesk, body=Space Grotesk, mono=JetBrains Mono (from `tokens.css`)
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

- Buttons: primary action uses `#FDC800`; secondary actions stay neutral.
- Inputs: strong focus-visible states, clear labels, and predictable error messaging.
- Cards/sections: use consistent radii, spacing, and elevation strategy across the page.

## 7. Motion & Interaction

- Use subtle transitions that emphasize Primary (#FDC800) as the interaction signal.
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
