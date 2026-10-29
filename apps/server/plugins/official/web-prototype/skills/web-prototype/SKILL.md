---
name: web-prototype
description: >-
  Build a clickable multi-screen product prototype (WeChat mini program, mobile app or web app screens) on the
  platform's fixed shell: you write only gg-artifact.json, one HTML file per screen and the design system's
  tokens.css into design/<slug>/, then publish it with preview_static. Use when a creation request names this
  plugin, or when someone asks for app screens, a mini program page, a mobile mockup, a UI prototype or a
  clickable flow.
---

# Product Prototype Skill

You write the business content of a prototype — screens, copy, layout, links between screens. The platform owns everything around it: the device frame, status bar and capsule, screen navigation, base styles and (later) element editing. Keep to that split: it is what lets people edit your screens directly afterwards.

## Resource map

All paths are relative to this skill's directory.

```
web-prototype/
├── SKILL.md                       ← this file (shared workflow and contract)
├── kit/                           ← platform-owned shell and runtime: copy verbatim, never edit
│   ├── index.html                 ← the shell (device frame, screen switcher)
│   ├── gg-kit.css                 ← base styles, device variables, .gg-ph / .gg-scroll-x
│   └── gg-kit.js                  ← data-gg-link / data-gg-back navigation
├── templates/<id>/GUIDE.md        ← per-template instructions; templates/<id>/example/ is a finished reference
├── design-systems/<id>/           ← DESIGN.md (source of truth) + tokens.css (generated from its front matter)
├── craft/                         ← cross-template rules (anti-ai-slop, accessibility, states, forms, UX laws)
└── references/critique.md         ← five-dimension self-review before publishing
```

## Template index

<!-- TEMPLATE-INDEX -->
- `app-screens` 多屏应用原型 — 小程序或 App 的多屏可点击原型：每屏一个文件，平台外壳负责设备框与跳转

## What the creation message gives you

A creation message @-mentions you and names the template id, the design system directory (e.g. `design-systems/luke-plus`), whether to explore visual directions first (`先出 2–3 个视觉方向：是` / `否`), and parameters as `label：value` lines: `主题` (title, required), `内容要点` (points), `页面清单` (screens, one per line), `目标受众` (audience). Attachments (logos, screenshots, photos, copy, data) beat anything you would invent.

A plain chat request (no creation message) is confirmed first: pick the template and design system (gonggong's `plugin_catalog` with `plugin: web-prototype` lists them), fill in what the conversation says, and post a 创作确认卡 with `creation_propose`. Build nothing until the creation message arrives. Without those tools, build directly with `app-screens` and the only design system.

## Output contract

```
design/<slug>/
├── gg-artifact.json        ← { "title", "device": "miniprogram" | "mobile" | "desktop", "entry": "<screen id>",
│                               "screens": [{ "id", "title", "file": "screens/<id>.html", "statusBar"?: "light" | "dark" }] }
├── tokens.css              ← copied verbatim from the design system
├── screens/<id>.html       ← one full HTML document per screen (skeleton below)
├── assets/                 ← images you were given or fetched, referenced relatively
├── index.html              ← copied verbatim from kit/index.html (platform shell)
└── _gg/                    ← copied verbatim from kit/gg-kit.css and kit/gg-kit.js (platform runtime)
```

`index.html` and `_gg/` belong to the platform: copy them, never edit them, never put your own files there. The platform may replace them when it renders.

Screen skeleton:

```html
<!doctype html>
<html lang="zh-CN" data-gg-device="miniprogram">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>首页</title>
<link rel="stylesheet" href="../_gg/gg-kit.css">
<link rel="stylesheet" href="../tokens.css">
<script src="../_gg/gg-kit.js" defer></script>
<style>/* this screen's styles, tokens only */</style>
</head>
<body>
  <section data-section="hero">…</section>
</body>
</html>
```

## Workflow

### Step 0 — Pre-flight

1. **Folder.** If the creation message names a directory, use it. Otherwise `slug` = short kebab-case ASCII from the title; if `design/<slug>/` exists and is not this prototype, append `-2`, `-3`…
2. **Template.** Read `templates/<id>/GUIDE.md`, then open `templates/<id>/example/` (manifest and every screen) to see the expected finish.
3. **Design system.** Read `DESIGN.md` fully (front matter tokens, components, Do's and Don'ts) and `tokens.css`. Token names follow the front matter: `colors.x` → `--color-x`, `rounded.x` → `--rounded-x`, `spacing.x` → `--space-x`, `typography.x` → class `.t-x` (and `--text-x-size/-weight/-leading`).
4. **Craft.** Skim `craft/anti-ai-slop.md`; for forms read `craft/form-validation.md`, for empty/loading/error states `craft/state-coverage.md`.

### Step 1 — Build

1. Copy `kit/index.html` to `design/<slug>/index.html`, `kit/gg-kit.css` and `kit/gg-kit.js` to `design/<slug>/_gg/`, the design system's `tokens.css` to `design/<slug>/tokens.css`.
2. Write `gg-artifact.json`, then each screen following the template guide.

### Step 2 — Visual directions (only when asked)

1. Build only the entry screen in 2–3 directions as `design/<slug>/directions/<n>-<name>.html` (same skeleton, `../_gg/` and `../tokens.css` paths unchanged). Directions differ in composition — layout, density, imagery treatment, hierarchy — never in colours outside the tokens.
2. Screenshot each to `<n>-<name>.png` at the device size (375×812 for miniprogram, 390×844 for mobile) with headless Chrome/Chromium; skip the PNG if no browser is available.
3. Call `ask_group_members` with one `single` question (`选哪个视觉方向？`), one short Chinese option name per direction, `recommended` set to your pick, and `option_meta` per option: `description` (one sentence, ≤ 120 chars) and `image` (the workspace-relative PNG, or the HTML when there is no PNG).
4. Build all screens in the chosen direction, then delete `directions/`. On timeout use your pick and say so.

### Step 3 — Check and critique

1. Open every screen through the shell with headless Chrome (serve `design/<slug>/` over a local HTTP server; the shell reads `gg-artifact.json` with `fetch`) and look at the screenshots: nothing under the status bar, capsule or bottom bars; lists full; text not clipped.
2. Run the template's checklist in its GUIDE.md (every P0 must pass), then `references/critique.md`, and fix what they find.

### Step 4 — Publish and reply

1. Call the gonggong `preview_static` tool with `dir` = `design/<slug>` and `title` = the prototype title.
2. Reply briefly: the folder, template and design system, the screens and how they link in one line, what the critique fixed, and remaining placeholders or assumptions. Do not paste HTML into chat.

## Hard rules

- **Tokens only.** No hex, `rgb()`, named colours, font sizes or radii in screen files except through the tokens; tints via `color-mix()` on a token.
- **Static first.** Write content as static HTML. JavaScript in a screen is allowed only for in-screen interaction (tabs, toggles) and never to generate content: generated elements cannot be edited later.
- **No external code.** No frameworks, CDNs or web fonts; the kit and tokens are all the CSS and JS you get besides your own inline `<style>` (and inline `<script>` when needed).
- **Real content, real images or labelled placeholders** (`.gg-ph`), never hotlinks, never invented logos, testimonials or awards.
- **`data-section` on every top-level region** so people can point at a part. When asked to change one part, edit only that region and leave the rest byte-for-byte.
- **Keep the split.** Never edit `index.html` or `_gg/`; never draw the status bar, capsule or home indicator.
