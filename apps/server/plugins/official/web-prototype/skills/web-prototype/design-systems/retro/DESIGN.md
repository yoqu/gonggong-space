# Retro Design System

> Category: Retro & Nostalgic
> Throwback design with vintage-inspired typography, high-contrast retro palettes, and nostalgic visual elements.
>
> Exact values: `tokens.css` wins. Where a hex value or font name below differs from `tokens.css`, use `tokens.css`; read this file for the style's intent.

## 1. Visual Theme & Atmosphere

Throwback design with vintage-inspired typography, high-contrast retro palettes, and nostalgic visual elements.

- **Visual style:** high-contrast, retro
- **Color stance:** primary, neutral, success, warning, danger
- **Design intent:** Keep outputs recognizable to this style family while preserving usability and readability.

## 2. Color

- **Background:** `#F6EAD2` — Page canvas.
- **Surface:** `#FFF8E9` — Cards, panels, inputs.
- **Text:** `#3B2314` — Headlines and body copy.
- **Muted:** `#6E4F3A` — Secondary text, captions, metadata.
- **Border:** `#3B2314` — Dividers, card and input edges.
- **Primary:** `#E0A526` — CTAs, links, active states; text on it is `#2B1609`.
- **Success:** `#15803D`
- **Warning:** `#B45309`
- **Danger:** `#C8452C`

- Favor Primary (#E0A526) for CTA emphasis; at most two visible uses per screen.
- Use Background (#F6EAD2) for the page and Surface (#FFF8E9) for cards.
- Keep body copy on Text (#3B2314) for legibility.

## 3. Typography

- **Scale:** desktop-first expressive scale
- **Families:** display=Righteous, body=DM Sans, mono=Courier Prime (from `tokens.css`)
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

- Buttons: primary action uses `#E0A526`; secondary actions stay neutral.
- Inputs: strong focus-visible states, clear labels, and predictable error messaging.
- Cards/sections: use consistent radii, spacing, and elevation strategy across the page.

## 7. Motion & Interaction

- Use subtle transitions that emphasize Primary (#E0A526) as the interaction signal.
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
