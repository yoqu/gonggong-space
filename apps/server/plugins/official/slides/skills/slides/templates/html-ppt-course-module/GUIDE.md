# Course Module — warm paper classroom

Teaching deck on warm paper: Playfair serif headlines, a persistent left sidebar of learning objectives, concept boxes, worked examples, an exercise and an MCQ self-check.

`example.html` is a finished example of this template — study its structure, density and finish, do not copy its copy.

Visual system, layouts and the keyboard runtime come from the MIT-licensed [`lewislulu/html-ppt-skill`](https://github.com/lewislulu/html-ppt-skill); the licence ships at `../html-ppt/LICENSE` — keep it in place when redistributing.

## Start here

- Shared rules — self-contained `design/<slug>/` folder, which assets to copy, speaker notes, presenter mode, keyboard runtime: `../html-ppt/GUIDE.md`.
- Starting point: `../html-ppt/templates/full-decks/course-module/` — copy `index.html` + `style.css` into `design/<slug>/`, keep `<body class="tpl-course-module">`, copy `base.css`, `fonts.css`, `animations/animations.css`, `runtime.js` from `../html-ppt/assets/` into `design/<slug>/assets/` and rewrite the `../../../assets/...` links to `./assets/...`.
- `example.html` is the same template filled with a realistic brief, with all CSS inlined; it loads `../html-ppt/assets/runtime.js`. Use it as the density/finish reference; if you start from it instead, copy `runtime.js` into `design/<slug>/assets/` and point the script at `./assets/runtime.js`.
- Swap content, not classes — the scoped `.tpl-course-module` classes are the identity. Re-skin only through the variables at the top of `style.css`.

## Visual system

- Palette: paper `#fbfaf6` / `#f4f1e8`, ink `#2a2418` / `#5a5140` / `#8a7f68`; accents deep teal `#2d7d6e`, amber `#d88a3a`, terracotta `#c4593f`.
- Type: Playfair Display for `.h1`/`.h2` and the sidebar brand (italic for one emphasised word), Inter body, JetBrains Mono for chips (`~ 45 min`, audience, outcome) and code.
- Layout: content slides are a 260px `.sidebar` + `.main` grid; `.slide.full` for cover/summary. Sidebar lists objectives (`.obj-list`) and marks the current one.
- 14–20px radii, soft warm shadows, dashed dividers.
- Every font stack keeps a Chinese fallback — sans: `"PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif`; serif: `"Songti SC","Noto Serif SC",serif`. Google Fonts links may stay. Copy is Chinese with `<html lang="zh-CN">`.

## Slide vocabulary

1. Cover (`.full`) — kicker (course · module), serif title with an italic word, lede on what learners will be able to do, meta chips.
2. Objectives — 3–4 measurable objectives.
3. Concept — `.concept-box` + `.callout` for the key definition.
4. Example — worked example, step by step (`.code` if technical).
5. Exercise — `.exercise` task with time box and expected output.
6. Check — `.mcq` question with 3–4 options; answer in notes.
7. Summary — recap against objectives, next module.

## Fits

课程模块、新人培训、内部赋能、工作坊、在线课 — 讲师带学员逐步学会一件事.

## Checklist

- [ ] Objectives are verbs learners can demonstrate; the summary maps back to them.
- [ ] Sidebar shows the same objective list on every content slide, current one marked.
- [ ] Exercise has a time box and success criterion; MCQ answer and explanation in notes.
- [ ] Speaker notes live in `.notes`; no presenter-only text on slides.
- [ ] All links resolve inside `design/<slug>/`; Chinese fallback in every font stack.
