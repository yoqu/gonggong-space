# Safety Alert — 红琥珀警示

"This is serious, don't skim" deck: warm-white canvas framed by 45° red/black hazard stripes, red strike-through negation headlines, L1/L2/L3 green/amber/red tier cards, an alert box with a pulsing status dot, policy-as-code blocks and a red/green checklist.

`example.html` is a finished example of this template — study its structure, density and finish, do not copy its copy.

Visual system, layouts and the keyboard runtime come from the MIT-licensed [`lewislulu/html-ppt-skill`](https://github.com/lewislulu/html-ppt-skill); the licence ships at `../html-ppt/LICENSE` — keep it in place when redistributing.

## Start here

- Shared rules — self-contained `design/<slug>/` folder, which assets to copy, speaker notes, presenter mode, keyboard runtime: `../html-ppt/GUIDE.md`.
- Starting point: `../html-ppt/templates/full-decks/testing-safety-alert/` — copy `index.html` + `style.css` into `design/<slug>/`, keep `<body class="tpl-testing-safety-alert">`, copy `base.css`, `fonts.css`, `animations/animations.css`, `runtime.js` from `../html-ppt/assets/` into `design/<slug>/assets/` and rewrite the `../../../assets/...` links to `./assets/...`.
- `example.html` is the same template filled with a realistic brief, with all CSS inlined; it loads `../html-ppt/assets/runtime.js`. Use it as the density/finish reference; if you start from it instead, copy `runtime.js` into `design/<slug>/assets/` and point the script at `./assets/runtime.js`.
- Swap content, not classes — the scoped `.tpl-testing-safety-alert` classes are the identity. Re-skin only through the variables at the top of `style.css`.

## Visual system

- Palette: `#fffaf7` canvas, ink `#14141a` / `#4a4955`, muted `#8a8892`; red `#e0314a` (+ soft `#ffecee`), amber `#d97706` (+ `#fff5e6`), green `#067647` (+ `#e8f8ee`). Red = must stop, amber = watch, green = OK — never decorative.
- Type: Inter + Noto Sans SC 900 `.ts-h1`, a struck-through line (red bar) for the claim being rejected, then the replacement in red; JetBrains Mono for code.
- Chrome: `.ts-stripe` (14px top) and `.ts-stripe-b` (6px bottom) hazard stripes; `.ts-chrome` with `.ts-alert-tag` (⚠ + label, red or `.amber`) and `.ts-page`.
- Components: `.ts-alert-box` with status dot, `.ts-card` tiers, `.ts-highlight-red/amber/green`, `.ts-codebox` with red left border, `.ts-checklist` / `.ts-check`.
- Every font stack keeps a Chinese fallback — sans: `"PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif`; serif: `"Songti SC","Noto Serif SC",serif`. Google Fonts links may stay. Copy is Chinese with `<html lang="zh-CN">`.

## Slide vocabulary

1. Cover — alert tag, kicker (org · topic), 3-line headline: claim struck through → what to do instead in red, factual lede, `.ts-alert-box` with the decision needed.
2. Section.
3. Risk levels — L1/L2/L3 tier cards.
4. Policy / code — `.ts-codebox` with bad keywords highlighted.
5. Chart — incident stacked bars.
6. Checklist — red ✗ / green ✓ items.
7. CTA — the decision and owner.
8. Thanks.

## Fits

Safety, risk, compliance, data governance, incident post-mortems, red-team findings, pre-launch reviews, board briefings that need a decision.

## Checklist

- [ ] The decision being asked is on the cover and again on the CTA, with an owner.
- [ ] Status colours used strictly by meaning; the strike-through is used once (cover).
- [ ] Every risk has severity, evidence and mitigation.
- [ ] Speaker notes live in `.notes`; no presenter-only text on slides.
- [ ] All links resolve inside `design/<slug>/`; Chinese fallback in every font stack.
