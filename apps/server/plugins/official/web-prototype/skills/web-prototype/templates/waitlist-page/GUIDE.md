# Waitlist Page

Minimal pre-launch landing with email capture, brand logo, and optional decorative layer. Best for: product launches, beta signups, early access programs, indie projects.

Pre-launch pages are your first handshake with future users. This template builds a focused, honest entrance: your brand identity, what you're making, one clear path to join the early list. No artificial scarcity, no fake countdown, no inflation tactics—just a clean, mobile-first vessel for genuine interest.

`example.html` is a finished example of this template — study its structure and quality bar, do not copy its copy.

## Inputs

- Product name and tagline (required).
- Logo mark (optional): text initials, or an inline SVG.
- Colors and fonts are derived from the design system (see token mapping below).

## Workflow

### Preflight: Load hardened template and brand foundation

0. **Load the brand identity** — Read the design system's `DESIGN.md` and `tokens.css` (see SKILL.md Step 0) for the color system, font pairing, and spatial rules. This is your foundation. A waitlist page lives or dies by consistency with the brand it represents.
1. **Read and copy the reusable template** — Read `assets/template.html`. This template is the hardened seed for all outputs. Copy it to `design/<slug>/index.html` as your base. Do not write HTML from scratch or deviate from this structure. The template has all required layout, form structure, decorations, focus styles, and accessibility scaffolding baked in.

### Steps: Token replacement with validation and escaping

2. **Map tokens from inputs** — For each placeholder in the template (e.g., `{{PRODUCT_NAME}}`, `{{BG_EXPRESSION}}`, `{{BORDER_EXPRESSION}}`, `{{LOGO_MARK}}`), follow the replacement rules below:
   - **Text tokens** (`{{PRODUCT_NAME}}`, `{{TAGLINE}}`): HTML-escape `<`, `>`, `&`, `"`, `'` before insertion into HTML text nodes or attribute values.
   - **HTML tokens** (`{{LOGO_MARK}}`): If using text initials, HTML-escape them by default. If using inline SVG, you must strictly sanitize it using an allowlist: strip `<script>` tags, event handlers (`on*`), `<foreignObject>`, external refs (`href`, `xlink:href`, `url()`), and any disallowed attributes/elements before insertion. If the SVG cannot be safely sanitized, fallback to escaped text initials. Never emit raw, unsanitized arbitrary HTML. Ensure any SVG scales cleanly within its container.
   - **Color expression tokens** (`{{BG_EXPRESSION}}`, `{{FG_EXPRESSION}}`, `{{ACCENT_EXPRESSION}}`, `{{DECO_EXPRESSION}}`, `{{STRIPE_EXPRESSION}}`, `{{SUCCESS_EXPRESSION}}`, `{{BORDER_EXPRESSION}}`, `{{BTN_LABEL_EXPRESSION}}`, `{{TICKER_BG_EXPRESSION}}`, `{{TICKER_FG_EXPRESSION}}`, `{{DECO_STROKE_EXPRESSION}}`, `{{LOGO_SHADOW_EXPRESSION}}`, `{{LOGO_FG_EXPRESSION}}`): Must strictly adhere to an explicit color grammar (`#hex`, `rgb`/`rgba`, `hsl`/`hsla`, `oklch`, or `color-mix()` using only local variables). Hard reject any input containing `;`, `{}`, `<`, `>`, comments (`/*`), `@`, `url(`, or external refs to prevent CSS injection. Do not wrap in `#` or add extra quotes. Examples: `rgba(196, 169, 154, 0.38)`, `color-mix(in srgb, var(--fg) 38%, transparent)`, `#FDE8DF`. Insert as-is into `:root` CSS variables. Derive `--success` from the design system if present; otherwise use the allowed fallback `#2D6A4F` only.
   - **Font name tokens** (`{{DISPLAY_FONT_CSS}}`, `{{BODY_FONT_CSS}}`): These are CSS font-family values, already quoted if they contain spaces (e.g., `'DM Sans'`, `Syne`). Insert as-is into `--font-display` and `--font-body` declarations; do NOT add extra quotes.
   - **Font URL tokens** (`{{DISPLAY_FONT_URL}}`, `{{BODY_FONT_URL}}`): Spaces must be encoded as `+` for the Google Fonts URL (e.g., `DM+Sans`, `IBM+Plex+Serif`). Validate the URL is well-formed before insertion.
3. **Verify token mapping rules** — All color tokens are now in CSS variables:
   - `--bg` = `{{BG_EXPRESSION}}` (e.g., `#FDE8DF`)
   - `--fg` = `{{FG_EXPRESSION}}` (e.g., `#1A1410`)
   - `--accent` = `{{ACCENT_EXPRESSION}}` (brand badge)
   - `--deco` = `{{DECO_EXPRESSION}}` (decoration primary)
   - `--deco-stripe` = `{{STRIPE_EXPRESSION}}` (accent stripe)
   - `--input-border` = `{{BORDER_EXPRESSION}}` (full CSS expression with opacity)
   - `--success` = `{{SUCCESS_EXPRESSION}}` or `#2D6A4F` fallback
   - `--btn-label` = `{{BTN_LABEL_EXPRESSION}}` (button text color for contrast)
   - `--ticker-bg` = `{{TICKER_BG_EXPRESSION}}` (animated ticker background)
   - `--ticker-fg` = `{{TICKER_FG_EXPRESSION}}` (animated ticker text)
   - `--deco-stroke` = `{{DECO_STROKE_EXPRESSION}}` (SVG strokes, typically muted with 12–15% opacity)
   - `--logo-shadow` = `{{LOGO_SHADOW_EXPRESSION}}` (logo container shadow, subtle foreground shade)
   - `--logo-fg` = `{{LOGO_FG_EXPRESSION}}` (contrasting text color for logo initials)
4. **Responsive layout** — The template includes mobile-first scaling:
   - 375px: form stacks to single column, logo shrinks to 40px, decoration compresses, no horizontal scroll.
   - 768px: comfortable two-column breathing room.
   - 1440px+: centered layout with generous whitespace.
   - Verify all text remains readable and the email input + button are fully visible (no clipping) at 375×667 and 390×844.

### Validation: Run hardened quality gates before delivering

5. **Run the quality checklist** — Read `references/checklist.md`. Validate every **P0 gate** before delivering:
   - Exactly one CTA (email form)
   - No countdown timer, no fake social proof, no emoji
   - No horizontal scroll at 375px
   - Email input has `type="email"` and `required`; first name has no `required`
   - Form does NOT use `novalidate`; JS uses `checkValidity()` guard
   - Success message has `role="status"` or `aria-live="polite"`
   - All colors from the design system or allowed fallback; **no invented hex values**
   - All user text is HTML-escaped; color tokens adhere to strict grammar; fonts are URL-encoded
   - **Pass P0 or do not deliver.** If any P0 gate fails, ask the user or fix the token mappings and try again.
6. **Verify P1 gates** for quality submission (recommended):
   - Hover and active states on submit button
   - Form validation with clear feedback
   - Ticker animation respects `prefers-reduced-motion: reduce`
   - All interactive elements have visible focus styles (input:focus includes `outline`)
   - Tab/Enter keyboard support
   - WCAG AA contrast for body text (≥4.5:1) and button label (≥4.5:1)
   - Logo alt/aria-label present; ticker has `aria-hidden="true"`
   - `<html lang="">` is set
7. Then run `../../references/critique.md`.

### Output

8. Single file, CSS inlined, SVG for graphics. Keep the template's `data-section` marks (headline, form, logo, ticker, grid, etc.). Write the page to `design/<slug>/index.html` (assets next to it, relative paths), then follow SKILL.md: critique, publish.

## Quality gates

This template enforces a hardened, template-based workflow to ensure compliance. **You must follow this execution path; deviating from the template disqualifies the output.**

**Mandatory template-based execution:**
- Read `assets/template.html` as your base; do not write HTML from scratch.
- Copy it to `design/<slug>/index.html` and replace only the `{{PLACEHOLDER}}` tokens with validated/escaped values.
- Run every P0 gate in `references/checklist.md` before delivering; if any fail, fix and re-validate.

**P0 gates (must pass):**
- Single CTA: Email form is the only interactive element. No nav, no secondary buttons, no social links.
- Logo placement: Fixed top-left, matches the design system accent color, scales down on mobile (50px → 40px).
- Color consistency: Every color from the design system palette. Only allowed hardcoded exception: `#2D6A4F` for `--success`.
- No anti-patterns: No countdown timer, no fake social proof, no emoji icons, no lorem ipsum.
- Content integrity: Headline and copy tie directly to the product name and tagline—no filler copy.
- Mobile fit: No horizontal scroll at 375px. Email input and submit button are fully visible (no clipping) at 375×667 and 390×844. Vertical overflow is scrollable, not hidden.
- Typographic discipline: Display + body fonts only (2-font rule). Consistent sizing across sections.
- Form structure: Two fields (first name optional, email required), `checkValidity()` guard, success message with `role="status"`.
- Token escaping: All user-supplied text HTML-escaped; color tokens adhere to strict grammar and contain no unsafe characters (`;`, `{}`, `<`, `>`, `/*`, `@`, `url(`); font names are URL-encoded; `{{LOGO_MARK}}` is escaped text initials or strictly sanitized inline SVG (no scripts, no event handlers, no foreignObject, no external hrefs).

**P1 gates (should pass for quality submission):**
- Hero section visually distinct and above-the-fold.
- Email submit button has hover and active states.
- Form validation provides clear feedback.
- Page scrollable (not clipped) at all mobile viewports; CTA visible without scroll.
- Ticker animation paused/removed under `prefers-reduced-motion: reduce`.
- All interactive elements have visible focus styles (outline, not just outline:none).
- Keyboard: Tab reaches each form field; Enter submits.
- WCAG AA contrast: Body text ≥4.5:1, button label ≥4.5:1.
- Logo alt/aria-label present; ticker has `aria-hidden="true"`.
- `<html lang="">` set to correct language code.

**Decoration restraint:**
- Lower zone enhances without distraction. Opacity, subtle strokes, muted animation.
- No gradient that spans more than 20% of viewport height.
- Coil, stripe, grid, or ticker all use colors from the design system only.

**Iterations:** If the user asks for changes, update `index.html` in place and re-run the P0 checklist gates before publishing the next version. Do not skip validation on iterations.
