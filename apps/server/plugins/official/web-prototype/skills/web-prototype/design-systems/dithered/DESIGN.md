# Dithered Design System

> Category: Retro & Nostalgic
> Dot-pattern rendering technique that simulates shades with a limited palette for nostalgic, retro, high-contrast visuals.
>
> Exact values: `tokens.css` wins. Where a hex value or font name below differs from `tokens.css`, use `tokens.css`; read this file for the style's intent.

## 1. Visual Theme & Atmosphere

Dot-pattern rendering technique that simulates shades with a limited palette for nostalgic, retro, high-contrast visuals.

- **Visual style:** modern, minimal
- **Color stance:** primary, neutral, success, warning, danger
- **Design intent:** Keep outputs recognizable to this style family while preserving usability and readability.

## 2. Color

- **Background:** `#E6ECD8` — Page canvas.
- **Surface:** `#F3F6EA` — Cards, panels, inputs.
- **Text:** `#172015` — Headlines and body copy.
- **Muted:** `#485740` — Secondary text, captions, metadata.
- **Border:** `#9FB08A` — Dividers, card and input edges.
- **Primary:** `#2F4A1F` — CTAs, links, active states; text on it is `#E6ECD8`.
- **Success:** `#15803D`
- **Warning:** `#B45309`
- **Danger:** `#DC2626`

- Favor Primary (#2F4A1F) for CTA emphasis; at most two visible uses per screen.
- Use Background (#E6ECD8) for the page and Surface (#F3F6EA) for cards.
- Keep body copy on Text (#172015) for legibility.

## 3. Typography

- **Scale:** 14/16/18/24/32/40
- **Families:** display=Space Mono, body=IBM Plex Sans, mono=Space Mono (from `tokens.css`)
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

- Buttons: primary action uses `#2F4A1F`; secondary actions stay neutral.
- Inputs: strong focus-visible states, clear labels, and predictable error messaging.
- Cards/sections: use consistent radii, spacing, and elevation strategy across the page.

## 7. Motion & Interaction

- Use subtle transitions that emphasize Primary (#2F4A1F) as the interaction signal.
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
