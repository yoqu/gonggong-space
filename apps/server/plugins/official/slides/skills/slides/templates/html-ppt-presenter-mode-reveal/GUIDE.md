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

## Linked edits

- `data-themes` on `<html>` must match the files in `./assets/themes/<name>.css` and the `<link id="theme-link">` href (runtime derives the theme folder from it, falling back to `assets/themes/`); the example's inline `<style data-theme="tokyo-night">` is the default and must be replaced if you change the default theme.
- Theme names/count are also written in copy — the closing `.code-block` (`switch theme (5 presets)`) and the last slide's notes list all five themes; update them with `data-themes`.
- Several colours ignore the theme and stay GitHub-dark: `.blue/.green/.orange/.purple/.red`, `.code-block` (`#0d1117`, `#e6edf3`, token colours), the `.speaker .av` gradient stop `#bc8cff`, and the fixed key-hint `color:#484f5866` — check them against every theme in `data-themes`, especially `corporate-clean`.
- Agenda `.agenda-row .num` (01–05), the heading `Five things on the agenda`, each section slide's `.kicker` (`// part 0N · …`) and the cover notes (`five parts`) must stay in sync when parts change.
- `.slide-number` sits on the cover and the last slide, but runtime only updates the first one in the document, so the last slide's `data-current="6" data-total="6"` is hand-written — fix it when the slide count changes.
- Shortcut copy appears in three places — cover `.lede`, the closing `.code-block`, and the fixed bottom-left hint `<div>` after `.deck` — keep them consistent with what actually works (deck-toolkit.js owns S and O; its presenter window resets the timer with a button, not R).
- Every slide's `<aside class="notes">` must stay inside its `section.slide`; both the toolkit presenter window and runtime's N overlay read it from there.
- Navigation comes from `runtime.js` (slides are `.deck .slide`; it sets `window.deck = { slides, index, go }` for deck-toolkit.js) — if you copy or edit `runtime.js`, keep that line.

## Print

Supported. Browser print (Cmd/Ctrl+P → Save as PDF) gives one 1920×1080 page per slide; deck-toolkit.js lays the slides out for print, so keep it loaded. The shared base print CSS hides `.deck-footer` (hashtags + `.slide-number`) and the fixed shortcut hint is dropped; speaker notes never print.

## Checklist

- [ ] Every slide has 150–300 字 notes following the three rules in `../html-ppt/references/presenter-mode.md` (提示信号、加粗核心词、过渡句独立成段、口语).
- [ ] Slides stay sparse — the script carries the detail, the slide carries the claim.
- [ ] Every theme in `data-themes` exists under `./assets/themes/`.
- [ ] Speaker notes live in `.notes`; no presenter-only text on slides.
- [ ] All links resolve inside `design/<slug>/`; Chinese fallback in every font stack.
