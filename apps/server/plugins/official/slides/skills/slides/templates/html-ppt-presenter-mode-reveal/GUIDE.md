# Presenter Mode — talk with 逐字稿

A deck built around the speaker: restrained Tokyo-Night dark by default (T cycles 5 themes), clean agenda/feature rows, and 150–300 字 of 逐字稿 in every slide, read in the S presenter window.

`example.html` is a finished example of this template — study its structure, density and finish, do not copy its copy.

Visual system, layouts and the keyboard runtime come from the MIT-licensed [`lewislulu/html-ppt-skill`](https://github.com/lewislulu/html-ppt-skill); the licence ships at `../html-ppt/LICENSE` — keep it in place when redistributing.

## Start here

- Shared rules — self-contained `design/<slug>/` folder, which assets to copy, speaker notes, presenter mode, keyboard runtime: `../html-ppt/GUIDE.md`.
- Starting point: `../html-ppt/templates/full-decks/presenter-mode-reveal/` — copy `index.html` + `style.css` into `design/<slug>/`, keep `<body class="tpl-presenter-mode-reveal">`, copy `base.css`, `fonts.css`, `animations/animations.css`, `runtime.js` from `../html-ppt/assets/` into `design/<slug>/assets/` and rewrite the `../../../assets/...` links to `./assets/...`.
- `example.html` is the same template filled with a realistic brief, with all CSS inlined; it loads `../html-ppt/assets/runtime.js`. Use it as the density/finish reference; if you start from it instead, copy `runtime.js` into `design/<slug>/assets/` and point the script at `./assets/runtime.js`.
- Swap content, not classes — the scoped `.tpl-presenter-mode-reveal` classes are the identity. Re-skin only through the variables at the top of `style.css`.

## Visual system

- Theme-driven: the template inherits tokens from the active theme. Default `tokyo-night`; `data-themes="tokyo-night,dracula,catppuccin-mocha,nord,corporate-clean"` on `<html>` — copy all five theme files into `design/<slug>/assets/themes/` (or trim the list to what you copy).
- Type: `.h1` `clamp(44px,5.6vw,76px)`, `.h2` `clamp(32px,3.6vw,48px)`, mono uppercase `.kicker` with wide tracking, `.lede` 20px.
- Colour helpers `.blue` `.purple` `.green` `.orange` `.red` `.accent` for single words; gradient title on the cover only.
- Components: `.agenda-row`, `.feature-row`, `.rule-row`, `.card` / `.card-accent`, `.code-block`, `.speaker`; a footer key hint (S / T / ← →).
- Every font stack keeps a Chinese fallback — sans: `"PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif`; serif: `"Songti SC","Noto Serif SC",serif`. Google Fonts links may stay. Copy is Chinese with `<html lang="zh-CN">`.

## Slide vocabulary

1. Cover — kicker, two-line title, key hint, `.speaker`.
2. Agenda — `.agenda-row` with minutes per part.
3. Problem — one claim + evidence.
4. Core idea / demo setup — `.feature-row` cards.
5. Rules / script — `.rule-row` list (e.g. the three 逐字稿 rules).
6. Demo & close — what to try, CTA.
Every slide carries `<aside class="notes">` with 150–300 字 of 逐字稿.

## Fits

技术分享、路演、课程讲授、现场演示 — 任何「要上台讲」且需要提词的场景.

## Checklist

- [ ] Every slide has 150–300 字 notes following the three rules in `../html-ppt/references/presenter-mode.md` (提示信号、加粗核心词、过渡句独立成段、口语).
- [ ] Slides stay sparse — the script carries the detail, the slide carries the claim.
- [ ] Every theme in `data-themes` exists under `./assets/themes/`.
- [ ] Speaker notes live in `.notes`; no presenter-only text on slides.
- [ ] All links resolve inside `design/<slug>/`; Chinese fallback in every font stack.
