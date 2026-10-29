# Cosmic Design System

> Category: Creative & Artistic
> Futuristic sci-fi aesthetic with dark themes, vibrant neon accents, and immersive spatial elements.
>
> Exact values: `tokens.css` wins. Where a hex value or font name below differs from `tokens.css`, use `tokens.css`; read this file for the style's intent.

## 1. Visual Theme & Atmosphere

Futuristic sci-fi aesthetic with dark themes, vibrant neon accents, and immersive spatial elements.

- **Visual style:** playful, premium
- **Color stance:** primary, neutral, success, warning, danger
- **Design intent:** Keep outputs recognizable to this style family while preserving usability and readability.

## 2. Color

- **Background:** `#05061A` — Page canvas.
- **Surface:** `#0E1030` — Cards, panels, inputs.
- **Text:** `#EEF0FF` — Headlines and body copy.
- **Muted:** `#9BA1CF` — Secondary text, captions, metadata.
- **Border:** `#262A5C` — Dividers, card and input edges.
- **Primary:** `#FF7AD9` — CTAs, links, active states; text on it is `#05061A`.
- **Success:** `#4ADE80`
- **Warning:** `#FBBF24`
- **Danger:** `#F87171`

- Favor Primary (#FF7AD9) for CTA emphasis; at most two visible uses per screen.
- Use Background (#05061A) for the page and Surface (#0E1030) for cards.
- Keep body copy on Text (#EEF0FF) for legibility.

## 3. Typography

- **Scale:** 12/14/16/20/24/32
- **Families:** display=Sora, body=Sora, mono=JetBrains Mono (from `tokens.css`)
- **Weights:** 400
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

- Buttons: primary action uses `#FF7AD9`; secondary actions stay neutral.
- Inputs: strong focus-visible states, clear labels, and predictable error messaging.
- Cards/sections: use consistent radii, spacing, and elevation strategy across the page.

## 7. Motion & Interaction

- Use subtle transitions that emphasize Primary (#FF7AD9) as the interaction signal.
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
