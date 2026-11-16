# Tech Sharing — dark code-forward talk

Developer-talk deck on a code-editor dark canvas: JetBrains Mono kickers with a `>` prompt, mint→sky→lilac gradient headline, terminal code blocks, agenda and Q&A.

`example.html` is a finished example of this template — study its structure, density and finish, do not copy its copy.

Visual system, layouts and the keyboard runtime come from the MIT-licensed [`lewislulu/html-ppt-skill`](https://github.com/lewislulu/html-ppt-skill); the licence ships at `../html-ppt/LICENSE` — keep it in place when redistributing.

## Start here

- Shared rules — self-contained `design/<slug>/` folder, which assets to copy, speaker notes, presenter mode, keyboard runtime: `../html-ppt/GUIDE.md`.
- Starting point: `../html-ppt/templates/full-decks/tech-sharing/` — copy `index.html` + `style.css` into `design/<slug>/`, keep `<body class="tpl-tech-sharing">`, copy `base.css`, `fonts.css`, `animations/animations.css`, `runtime.js` from `../html-ppt/assets/` into `design/<slug>/assets/` and rewrite the `../../../assets/...` links to `./assets/...`.
- `example.html` is the same template filled with a realistic brief, with all CSS inlined; it loads `../html-ppt/assets/runtime.js`. Use it as the density/finish reference; if you start from it instead, copy `runtime.js` into `design/<slug>/assets/` and point the script at `./assets/runtime.js`.
- Swap content, not classes — the scoped `.tpl-tech-sharing` classes are the identity. Re-skin only through the variables at the top of `style.css`.

## Visual system

- Palette: `#0d1117` canvas with two faint radial glows (sky top-right, mint bottom-left); text `#e6edf3` / `#8b949e` / `#6e7681`; accents mint `#7ee787`, sky `#79c0ff`, coral `#ff7b72`; `--grad` mint → sky → lilac `#d2a8ff`.
- Type: Inter 800 `.h1` 78px / `.h2` 54px in white; `.kicker` in JetBrains Mono with a `> ` prefix; mono for code, tags, metadata.
- Code: `.terminal` blocks with syntax spans `.kw` `.str` `.fn` `.cmt` `.num` — keep the token colours.
- 14–20px radii, deep shadows; `.speaker` block on the cover.
- Every font stack keeps a Chinese fallback — sans: `"PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif`; serif: `"Songti SC","Noto Serif SC",serif`. Google Fonts links may stay. Copy is Chinese with `<html lang="zh-CN">`.

## Slide vocabulary

1. Cover — mono kicker, `.h1` with gradient phrase, lede, `.speaker` (avatar, name, session tags).
2. Agenda — `.agenda-row` numbered list with timings.
3. Context — why this matters, 2–3 cards.
4–5. Deep dives — diagram/cards per mechanism, `.card-accent` for the key one.
6. Code — one `.terminal` block (≤ 18 lines) + 2–3 callouts.
7. Takeaways — 3 numbered lessons.
8. Q&A — contact, repo, `.pill` tags.

## Fits

技术分享、内部 tech talk、架构讲解、会议演讲 — 工程师听众. Pair with presenter-mode notes when it will be spoken.

## Linked edits

- The cover's `<span class="slide-number" data-current="1" data-total="8">` is rewritten by `runtime.js` (only the first `.slide-number` is), so no hand edit when slides change; a `.slide-number` added elsewhere would stay frozen.
- The Agenda `.agenda-row .num` list (`01`–`05`, with `~Nmin` timings) mirrors the section slides, whose kickers carry hand-typed counters (`workflow map · 1 / 2`, `pilot · 2 / 2`) — add, drop or reorder a section in both places.
- Accent hexes are restated outside the variables: `--grad` (`#7ee787`, `#79c0ff`), the `.slide::before` radial glows (`rgba(121,192,255,.12)`, `rgba(126,231,135,.08)`) and `.pill-accent` (`rgba(126,231,135,…)`) — change them with `--accent` / `--accent-2`.
- The canvas `#0d1117` is literal in both `.tpl-tech-sharing` and `.tpl-tech-sharing .slide`, besides `--bg`; headings are literal `#fff` — a light re-skin must change all of them.
- Code colours are fixed GitHub-dark hexes, independent of the accents: `.kw .fn .str .cmt .num`, `.terminal` `#010409`, `.terminal .bar` `#161b22`, the three `.terminal .dot` colours.
- If you copy and edit `runtime.js`, keep its `window.deck = { slides, get index(), go }` line — the toolkit drives the deck through it.

## Print

Supported. Browser print (Cmd/Ctrl+P → Save as PDF) gives one 1920×1080 page per slide; deck-toolkit.js lays the slides out for print, so keep it loaded. The cover's `.slide-number` shows whichever slide is current, so press Home before printing; `.terminal pre` is capped at `max-height:440px` with scrolling, so code longer than that is cut off in print.

## Checklist

- [ ] Code is real and runnable-looking, trimmed to the lines that matter, with highlighted tokens.
- [ ] One gradient phrase per slide max; body text never gradient.
- [ ] Footer/speaker block doesn't overlap the slide number (check at 1280px wide).
- [ ] Speaker notes live in `.notes`; no presenter-only text on slides.
- [ ] All links resolve inside `design/<slug>/`; Chinese fallback in every font stack.
