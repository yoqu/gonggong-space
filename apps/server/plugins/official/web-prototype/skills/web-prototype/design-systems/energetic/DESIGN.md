# Energetic Design System

> Category: Bold & Expressive
> Dynamic, vibrant style with thick borders, geometric shapes, high-contrast colors, and expressive typography conveying motion and vitality.
>
> Exact values: `tokens.css` wins. Where a hex value or font name below differs from `tokens.css`, use `tokens.css`; read this file for the style's intent.

## 1. Visual Theme & Atmosphere

Dynamic, vibrant style with thick borders, geometric shapes, high-contrast colors, and expressive typography conveying motion and vitality.

- **Visual style:** bold, geometric, vibrant, thick-bordered
- **Color stance:** primary, secondary, neutral
- **Design intent:** Keep outputs recognizable to this style family while preserving usability and readability.

## 2. Color

- **Background:** `#FFEDD5` — Page canvas.
- **Surface:** `#FFF7ED` — Cards, panels, inputs.
- **Tint:** `#FDBA74` — Highlighted tiles and secondary panels.
- **Text:** `#431407` — Headlines and body copy.
- **Muted:** `#7C2D12` — Secondary text, captions, metadata.
- **Border:** `#431407` — Dividers, card and input edges.
- **Primary:** `#EA580B` — CTAs, links, active states; text on it is `#1C0A03`.
- **Success:** `#15803D`
- **Warning:** `#B45309`
- **Danger:** `#DC2626`

- Favor Primary (#EA580B) for CTA emphasis; at most two visible uses per screen.
- Use Background (#FFEDD5) for the page and Surface (#FFF7ED) for cards.
- Keep body copy on Text (#431407) for legibility.

## 3. Typography

- **Scale:** 12/14/16/20/24/32/48
- **Families:** display=Archivo, body=Inter, mono=JetBrains Mono (from `tokens.css`)
- **Weights:** 400
- Headings should carry the style personality; body text should optimize scanability and contrast.

## 4. Spacing & Grid

- **Spacing scale:** 4/8/12/16/24/32/48/64
- Keep vertical rhythm consistent across sections and components.
- Align columns and modules to a predictable grid; avoid ad-hoc offsets.

## 5. Layout & Composition

- Prefer clear content blocks with consistent internal padding.
- Keep hierarchy obvious: headline → support text → primary action.
- Use whitespace to separate concerns before adding borders or shadows.

## 6. Components

- Buttons: primary action uses `#EA580B`; secondary actions stay neutral.
- Inputs: strong focus-visible states, clear labels, and predictable error messaging.
- Cards/sections: use consistent radii, spacing, and elevation strategy across the page.

## 7. Motion & Interaction

- Use subtle transitions that emphasize Primary (#EA580B) as the interaction signal.
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
