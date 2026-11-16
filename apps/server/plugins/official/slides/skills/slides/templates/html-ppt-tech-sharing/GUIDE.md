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

## Checklist

- [ ] Code is real and runnable-looking, trimmed to the lines that matter, with highlighted tokens.
- [ ] One gradient phrase per slide max; body text never gradient.
- [ ] Footer/speaker block doesn't overlap the slide number (check at 1280px wide).
- [ ] Speaker notes live in `.notes`; no presenter-only text on slides.
- [ ] All links resolve inside `design/<slug>/`; Chinese fallback in every font stack.
