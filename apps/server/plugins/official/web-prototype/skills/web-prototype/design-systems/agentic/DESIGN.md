# Agentic Design System

> Category: Themed & Unique
> Conversational AI-first interface with minimal controls, clear outcomes, and delegated task flows for agentic workflows.
>
> Exact values: `tokens.css` wins. Where a hex value or font name below differs from `tokens.css`, use `tokens.css`; read this file for the style's intent.

## 1. Visual Theme & Atmosphere

Conversational AI-first interface with minimal controls, clear outcomes, and delegated task flows for agentic workflows.

- **Visual style:** modern, bold
- **Color stance:** surface/subtle layers
- **Design intent:** Keep outputs recognizable to this style family while preserving usability and readability.

## 2. Color

- **Background:** `#141413` — Page canvas.
- **Surface:** `#1F1E1C` — Cards, panels, inputs.
- **Text:** `#F6F6F1` — Headlines and body copy.
- **Muted:** `#A3A29A` — Secondary text, captions, metadata.
- **Border:** `#34332F` — Dividers, card and input edges.
- **Primary:** `#FF5701` — CTAs, links, active states; text on it is `#141413`.
- **Success:** `#4ADE80`
- **Warning:** `#FBBF24`
- **Danger:** `#F87171`

- Favor Primary (#FF5701) for CTA emphasis; at most two visible uses per screen.
- Use Background (#141413) for the page and Surface (#1F1E1C) for cards.
- Keep body copy on Text (#F6F6F1) for legibility.

## 3. Typography

- **Scale:** 14/16/18/24/32/40
- **Families:** display=Inter Tight, body=Inter, mono=JetBrains Mono (from `tokens.css`)
- **Weights:** 100, 200, 300, 400, 500, 600, 700, 800, 900
- Headings should carry the style personality; body text should optimize scanability and contrast.

## 4. Spacing & Grid

- **Spacing scale:** 8pt baseline grid
- Keep vertical rhythm consistent across sections and components.
- Align columns and modules to a predictable grid; avoid ad-hoc offsets.

## 5. Layout & Composition

- Prefer clear content blocks with consistent internal padding.
- Keep hierarchy obvious: headline → support text → primary action.
- Use whitespace to separate concerns before adding borders or shadows.

## 6. Components

- Buttons: primary action uses `#FF5701`; secondary actions stay neutral.
- Inputs: strong focus-visible states, clear labels, and predictable error messaging.
- Cards/sections: use consistent radii, spacing, and elevation strategy across the page.

## 7. Motion & Interaction

- Use subtle transitions that emphasize Primary (#FF5701) as the interaction signal.
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
