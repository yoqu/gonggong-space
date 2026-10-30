---
name: web-prototype
description: >-
  Build a clickable multi-screen product prototype (WeChat mini program, mobile app or web app screens) on the
  platform's fixed shell: you write only gg-artifact.json, one HTML file per screen and the design system's
  DESIGN.md and tokens.css into design/<slug>/; the platform hosts and previews it (without hosting, publish it with
  preview_static). Use when a creation request names this
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
├── kit/                           ← platform-owned shell and runtime: never edit (copied only without hosting)
│   ├── index.html                 ← the shell: canvas of all screens with link arrows, plus a click-through play view
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

A creation message @-mentions you and names the template id, the design system directory (e.g. `design-systems/luke-plus`), whether to explore visual directions first (`先出 2–3 个视觉方向：是` / `否`), and parameters as `label：value` lines: `主题` (title, required), `设备` (device), `内容要点` (points), `页面清单` (screens, one per line), `目标受众` (audience), and the design sources `粘贴 DESIGN.md` (a whole DESIGN.md, possibly several lines), `参考网站` (a URL) and `参考仓库` (a repository URL or a workspace path). Attachments (logos, screenshots, photos, copy, data) beat anything you would invent.

`设备` sets `device` in gg-artifact.json and `data-gg-device` on every screen: `小程序` → `miniprogram`, `手机 App` → `mobile`, `桌面 Web` → `desktop`. Without it, follow the template guide.

A plain chat request (no creation message) is confirmed first: pick the template and design system (gonggong's `plugin_catalog` with `plugin: web-prototype` lists them), fill in what the conversation says, and post a 创作确认卡 with `creation_propose`. Build nothing until the creation message arrives. Without those tools, build directly with `app-screens` and the design system that fits the request best.

## Hosted or not

The creation message says which:

- **Hosted** (it names the artifact directory and says no `preview_static` is needed): gonggong checked the folder out before your turn and uploads it as a new version afterwards; the server serves `index.html` and `_gg/` from this plugin's `kit/`. Do **not** copy `index.html` or `_gg/` into the folder and do not call `preview_static`. People may edit the folder between turns (texts, styles, links, DESIGN.md, tokens.css): start from what is there.
- **Not hosted** (older daemons; the message asks you to publish with `preview_static`): copy `kit/index.html` to `index.html` and `kit/gg-kit.css`, `kit/gg-kit.js` to `_gg/` verbatim so the folder previews on its own, then publish with `preview_static`.

## Output contract

```
design/<slug>/
├── gg-artifact.json        ← { "title", "device": "miniprogram" | "mobile" | "desktop", "entry": "<screen id>",
│                               "screens": [{ "id", "title", "file": "screens/<id>.html", "statusBar"?: "light" | "dark",
│                                             "prompt": "<设计说明, ≤ 4000 chars>" }] }
├── DESIGN.md               ← copied verbatim from the design system (the artifact's design source of truth)
├── tokens.css              ← copied verbatim from the design system
├── screens/<id>.html       ← one full HTML document per screen (skeleton below)
├── assets/                 ← images you were given or fetched, referenced relatively
├── refs/                   ← reference files people put on the canvas (images, PDFs, text); read them, don't edit
├── index.html              ← not hosted only: copied verbatim from kit/index.html (platform shell)
└── _gg/                    ← not hosted only: copied verbatim from kit/gg-kit.css and kit/gg-kit.js (platform runtime)
```

People may add reference nodes to the canvas: `gg-artifact.json` then has `"refs": [{ "id", "title", "file": "refs/<id>.<ext>", "kind", "x"?, "y"? }]`. Keep `refs` as it is whenever you rewrite the manifest, and leave `refs/` alone.

`index.html` and `_gg/` belong to the platform: never edit them and never put your own files there; the platform replaces them when it renders. Once `DESIGN.md` and `tokens.css` are in the folder they are the artifact's own: later turns read and follow those copies (people may have changed them), not the plugin's originals.

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
3. **Design system.** Pick its source, first match wins:
   1. `粘贴 DESIGN.md` is given, or an attachment is named `DESIGN.md`: that is the design system. Use it as the artifact's `DESIGN.md` (keep its wording; add the front matter sections the naming rule below needs if it lacks them) and generate `tokens.css` from its front matter.
   2. `参考网站` is given: fetch the page (WebFetch, or a headless browser for script-rendered sites) and extract its palette, font families and sizes, radii, spacing and component styles (buttons, cards, inputs, navigation). `参考仓库`: read its style sources (CSS variables, theme or Tailwind config, design tokens) the same way. Write what you found as `DESIGN.md` in the same format as this plugin's design systems (front matter tokens, then Overview, Colors, Typography, Layout, Components, Do's and Don'ts), generate `tokens.css` from it, and say in your reply what you extracted and from where. Do not copy logos, images or wording from the source.
   3. Otherwise the design system the creation message names.

   Read the resulting `DESIGN.md` fully (front matter tokens, components, Do's and Don'ts) and `tokens.css`. Token names follow the front matter: `colors.x` → `--color-x`, `rounded.x` → `--rounded-x`, `spacing.x` → `--space-x`, `typography.x` → class `.t-x` (and `--text-x-size/-weight/-leading`). Generating `tokens.css`: one `:root` rule with those custom properties in front-matter order (colours, then radii, then spacing), `--font-sans` from the first typography family plus system fallbacks, and one `.t-x { font-family: var(--font-sans); font-size: …; font-weight: …; line-height: … }` rule per typography entry using its variables; open with a comment naming the system — see any `design-systems/*/tokens.css`. Only custom properties, comments and `.t-*` rules: no `@import`, `url(` or other selectors.
4. **Craft.** Skim `craft/anti-ai-slop.md`; for forms read `craft/form-validation.md`, for empty/loading/error states `craft/state-coverage.md`.

### Progress card

Report the stages with gonggong's `progress_card` so the group sees where you are (skip it only when the tool is not available). Create the card when you start — title `生成「<主题>」`, stages `搭建设计系统`, `搭建应用骨架`, one `生成 <屏幕标题>（<i>/<n>）` per screen, then `自检与连线` — and update the same card (pass its `id`, send the whole `stages` list) as each stage starts (`running`) and ends (`done`, or `failed` with the reason in `detail`). 搭建设计系统 covers Step 0's design system and copying or writing `DESIGN.md` / `tokens.css`; 搭建应用骨架 is `gg-artifact.json` with every screen's `prompt`; 自检与连线 is Step 3. A card holds at most 12 stages: past nine screens, group them (`生成 首页等 3 屏（1/4）`). Changing an existing prototype: one stage per screen you touch plus `自检与连线`.

### Step 1 — Build

1. Copy the design system's `DESIGN.md` and `tokens.css` to `design/<slug>/` (or write the ones you made in Step 0). Not hosted only: also copy `kit/index.html` to `design/<slug>/index.html` and `kit/gg-kit.css`, `kit/gg-kit.js` to `design/<slug>/_gg/`.
2. Write `gg-artifact.json`, then each screen following the template guide. Give every screen a `prompt`: its design brief in the request's language, one paragraph — what the screen is for, its sections in order, the key copy and where its links go (see the example's manifest). People read it in the screen's details and you read it when changing the screen later; when you change a screen, update its `prompt` to match. Links may carry `data-gg-transition` (`push`, `push-back`, `slide-up`, `fade`, `none`; the default is `push`) for the play view.

### Step 2 — Visual directions (only when asked)

1. Build only the entry screen in 2–3 directions as `design/<slug>/directions/<n>-<name>.html` (same skeleton, `../_gg/` and `../tokens.css` paths unchanged). Directions differ in composition — layout, density, imagery treatment, hierarchy — never in colours outside the tokens.
2. Screenshot each to `<n>-<name>.png` at the device size (375×812 for miniprogram, 390×844 for mobile) with headless Chrome/Chromium; skip the PNG if no browser is available.
3. Call `ask_group_members` with one `single` question (`选哪个视觉方向？`), one short Chinese option name per direction, `recommended` set to your pick, and `option_meta` per option: `description` (one sentence, ≤ 120 chars) and `image` (the workspace-relative PNG, or the HTML when there is no PNG).
4. Build all screens in the chosen direction, then delete `directions/`. On timeout use your pick and say so.

### Step 3 — Check and critique

1. Serve the folder over a local HTTP server (the shell reads `gg-artifact.json` with `fetch`) and screenshot with headless Chrome. Hosted folders have no `index.html` or `_gg/`: copy the folder to a temporary directory outside the workspace, add the kit there (`index.html`, `_gg/`) and serve that copy — never add them to `design/<slug>/`. `index.html` shows the canvas (every screen plus link arrows: check each link lands where intended), `index.html#play:<id>` shows one screen in the device frame. Look for: nothing under the status bar, capsule or bottom bars; lists full; text not clipped.
2. Run the template's checklist in its GUIDE.md (every P0 must pass), then `references/critique.md`, and fix what they find.

### Step 4 — Publish and reply

1. Not hosted only: call the gonggong `preview_static` tool with `dir` = `design/<slug>` and `title` = the prototype title. Hosted folders are uploaded and previewed by the platform after your turn.
2. Reply briefly: the folder, template and design system, the screens and how they link in one line, what the critique fixed, and remaining placeholders or assumptions. Do not paste HTML into chat.

## Hard rules

- **Tokens only.** No hex, `rgb()`, named colours, font sizes or radii in screen files except through the tokens; tints via `color-mix()` on a token.
- **Static first.** Write content as static HTML. JavaScript in a screen is allowed only for in-screen interaction (tabs, toggles) and never to generate content: generated elements cannot be edited later.
- **No external code.** No frameworks, CDNs or web fonts; the kit and tokens are all the CSS and JS you get besides your own inline `<style>` (and inline `<script>` when needed).
- **Real content, real images or labelled placeholders** (`.gg-ph`), never hotlinks, never invented logos, testimonials or awards.
- **`data-section` on every top-level region** so people can point at a part. When asked to change one part, edit only that region and leave the rest byte-for-byte.
- **Keep the split.** Never edit `index.html` or `_gg/`; never draw the status bar, capsule or home indicator.
- **The folder's design system rules.** Follow the folder's own `DESIGN.md` and `tokens.css`; when asked to restyle, change them first and keep screens on the tokens.
