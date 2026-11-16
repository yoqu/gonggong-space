# Cyber Terminal — 暗终端评测

Honest-reviewer terminal deck: near-black `#0a0c10`, a 56px cyber grid with CRT vignette and scanlines, window traffic-light chrome, `$ prompt` command headlines, mint-glow monospace titles with a blinking cursor, stroke-only charts and amber/green/red tags.

`example.html` is a finished example of this template — study its structure, density and finish, do not copy its copy.

Visual system, layouts and the keyboard runtime come from the MIT-licensed [`lewislulu/html-ppt-skill`](https://github.com/lewislulu/html-ppt-skill); the licence ships at `../html-ppt/LICENSE` — keep it in place when redistributing.

## Start here

- Shared rules — self-contained `design/<slug>/` folder, which assets to copy, speaker notes, presenter mode, keyboard runtime: `../html-ppt/GUIDE.md`.
- Starting point: `../html-ppt/templates/full-decks/hermes-cyber-terminal/` — copy `index.html` + `style.css` into `design/<slug>/`, keep `<body class="tpl-hermes-cyber-terminal">`, copy `base.css`, `fonts.css`, `animations/animations.css`, `runtime.js` from `../html-ppt/assets/` into `design/<slug>/assets/` and rewrite the `../../../assets/...` links to `./assets/...`.
- `example.html` is the same template filled with a realistic brief, with all CSS inlined; it loads `../html-ppt/assets/runtime.js`. Use it as the density/finish reference; if you start from it instead, copy `runtime.js` into `design/<slug>/assets/` and point the script at `./assets/runtime.js`.
- Swap content, not classes — the scoped `.tpl-hermes-cyber-terminal` classes are the identity. Re-skin only through the variables at the top of `style.css`.

## Visual system

- Palette: `#0a0c10` / `#15151b`, surface `#12141a`, mint-tinted border; text `#e4e2d8` / `#8a8892`; accents mint `#7ed3a4` (primary glow), cyan `#64dfdf`, amber `#e9c58a`, rose `#d4a0b9`, red `#ff6b6b`.
- Type: JetBrains Mono throughout (`.hc-h1` uppercase with text-shadow glow + `.hc-cursor`), Inter only for lede paragraphs.
- Atmosphere layers on every slide: `.hc-grid` (masked), `.hc-scanlines`, `.hc-vignette`; `.hc-chrome` = traffic lights + session path/size/clock.
- Components: `.hc-prompt` (`$ command`), `.hc-tag` coloured by verdict (green good, amber trade-off, red risk), `.hc-card`, `.hc-codebox`, `.hc-big` numbers, stroke-only bar charts.
- Every font stack keeps a Chinese fallback — sans: `"PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif`; serif: `"Songti SC","Noto Serif SC",serif`. Google Fonts links may stay. Copy is Chinese with `<html lang="zh-CN">`.

## Slide vocabulary

1. Cover — chrome, `$` prompt line, 2-line glowing title + cursor, lede, verdict tags.
2. Section divider.
3. Content — spec cards (`.hc-grid-2/3`).
4. Code — config or trace in `.hc-codebox`.
5. Chart — stroke-only benchmark bars.
6. Stats — `.hc-big` numbers.
7. CTA — the verdict / recommendation.
8. Thanks.

## Fits

Reviews of CLI / agent / dev tools with traces, diffs and benchmarks; model/vendor selection; hands-on technical walkthroughs.

## Checklist

- [ ] Tag colours encode verdicts consistently across the deck.
- [ ] Glow only on the title; body text plain for legibility. Chinese titles still read clearly in the mono stack (add the Chinese sans fallback).
- [ ] Benchmarks state method and units.
- [ ] Speaker notes live in `.notes`; no presenter-only text on slides.
- [ ] All links resolve inside `design/<slug>/`; Chinese fallback in every font stack.
