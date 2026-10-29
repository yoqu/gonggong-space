# Mono Design System

> Category: Modern & Minimal
> Monospace-driven, matrix-inspired design with high-contrast elements, compact density, and a hacker-chic aesthetic.
>
> Exact values: `tokens.css` wins. Where a hex value or font name below differs from `tokens.css`, use `tokens.css`; read this file for the style's intent.

## 1. Visual Theme & Atmosphere

Monospace-driven, matrix-inspired design with high-contrast elements, compact density, and a hacker-chic aesthetic.

- **Visual style:** minimal, clean, high-contrast, playful, matrix
- **Color stance:** primary, secondary, success, warning, danger, info
- **Design intent:** Keep outputs recognizable to this style family while preserving usability and readability.

## 2. Color

- **Background:** `#E7E5E4` — Page canvas.
- **Surface:** `#F5F5F4` — Cards, panels, inputs.
- **Text:** `#1C1917` — Headlines and body copy.
- **Muted:** `#57534E` — Secondary text, captions, metadata.
- **Border:** `#C9C5C2` — Dividers, card and input edges.
- **Primary:** `#37F712` — CTAs, links, active states; text on it is `#0C0A09`.
- **Success:** `#00A63D`
- **Warning:** `#FE9900`
- **Danger:** `#FF2157`

- Favor Primary (#37F712) for CTA emphasis; at most two visible uses per screen.
- Use Background (#E7E5E4) for the page and Surface (#F5F5F4) for cards.
- Keep body copy on Text (#1C1917) for legibility.

## 3. Typography

- **Scale:** desktop-first expressive scale
- **Families:** display=IBM Plex Mono, body=IBM Plex Mono, mono=IBM Plex Mono (from `tokens.css`)
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

- Buttons: primary action uses `#37F712`; secondary actions stay neutral.
- Inputs: strong focus-visible states, clear labels, and predictable error messaging.
- Cards/sections: use consistent radii, spacing, and elevation strategy across the page.

## 7. Motion & Interaction

- Use subtle transitions that emphasize Primary (#37F712) as the interaction signal.
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
