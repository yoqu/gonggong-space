# Pitch Deck — gradient seed pitch

Classic 10-slide investor pitch: clean white canvas, blue→purple→magenta gradient accent, oversized headlines and big numbers — confident, data-forward, built for a partner who skims forty decks a day.

`example.html` is a finished example of this template — study its structure, density and finish, do not copy its copy.

Visual system, layouts and the keyboard runtime come from the MIT-licensed [`lewislulu/html-ppt-skill`](https://github.com/lewislulu/html-ppt-skill); the licence ships at `../html-ppt/LICENSE` — keep it in place when redistributing.

## Start here

- Shared rules — self-contained `design/<slug>/` folder, which assets to copy, speaker notes, presenter mode, keyboard runtime: `../html-ppt/GUIDE.md`.
- Starting point: `../html-ppt/templates/full-decks/pitch-deck/` — copy `index.html` + `style.css` into `design/<slug>/`, keep `<body class="tpl-pitch-deck">`, copy `base.css`, `fonts.css`, `animations/animations.css`, `runtime.js` from `../html-ppt/assets/` into `design/<slug>/assets/` and rewrite the `../../../assets/...` links to `./assets/...`.
- `example.html` is the same template filled with a realistic brief, with all CSS inlined; it loads `../html-ppt/assets/runtime.js`. Use it as the density/finish reference; if you start from it instead, copy `runtime.js` into `design/<slug>/assets/` and point the script at `./assets/runtime.js`.
- Swap content, not classes — the scoped `.tpl-pitch-deck` classes are the identity. Re-skin only through the variables at the top of `style.css`.

## Visual system

- Palette (scoped vars): `--bg #ffffff`, `--bg-soft #f6f7fb`, ink `--text-1 #0d1130` / `--text-2 #4a5070` / `--text-3 #8a90ad`; accents `#3b5bff` → `#7a46ff` → `#d94cff` as `--grad`; `--grad-soft` pastel wash for cover/thanks. Re-brand by overriding `--grad`.
- Type: Inter 900 headlines (`.h1` 86px, `.h2` 62px, tracking −.03em), `.mega` 180px gradient-filled numbers; Playfair accents only where the template uses them.
- Shapes: 20–28px radii, soft two-layer shadows, blurred gradient `.cover-blob` on the cover, `.brand-dot` + brand wordmark top-left.
- Slide padding 88px 112px; `.kicker` in accent, `.num-tag` + `.section-num` as section markers.
- Every font stack keeps a Chinese fallback — sans: `"PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif`; serif: `"Songti SC","Noto Serif SC",serif`. Google Fonts links may stay. Copy is Chinese with `<html lang="zh-CN">`.

## Slide vocabulary

1. Cover — brand, kicker (round · year), two-line `.h1` with one gradient phrase, lede, founder in footer.
2. Problem — `.section-num`, `.h2`, three cards of pain with numbers.
3. Solution — one-sentence answer + supporting cards.
4. Product — screenshot/feature slide.
5. Market — TAM/SAM/SOM as `.mega` numbers.
6. Business model — pricing / unit economics.
7. Traction — `.traction-bar` chart + `.metric` callouts.
8. Team — `.team-card` with `.avatar`.
9. The Ask — `.ask-box`: amount, use of funds, milestones.
10. Thanks — `.mega` closing word, contact pills.

## Fits

Fundraising, accelerator demo day, investor meetings, "state of the company" updates. One idea and one number per slide; the traction slide is the climax.

## Checklist

- [ ] Story arc problem → solution → why now → traction → ask; the ask states amount and what it buys.
- [ ] Every number is real or clearly marked as a placeholder; one `.mega` number per slide at most.
- [ ] Gradient used for emphasis on one phrase/number per slide, not on body text.
- [ ] Speaker notes live in `.notes`; no presenter-only text on slides.
- [ ] All links resolve inside `design/<slug>/`; Chinese fallback in every font stack.
