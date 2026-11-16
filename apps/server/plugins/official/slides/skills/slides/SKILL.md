---
name: slides
description: >-
  Build a self-contained HTML slide deck — strategy and consulting decks, pitch and fundraising decks, product
  launches, tech talks, weekly reports, course modules, design showcases, social-card decks — from a bundled
  per-template guide, seed and finished example, write it to design/<slug>/index.html in the workspace and publish
  it with preview_static. Use when a creation request names this plugin, or when someone asks for slides, a deck,
  a PPT, a presentation, a pitch deck, a 汇报/路演/分享/课件 in HTML.
---

# Slides Skill

Produce one self-contained HTML slide deck that runs in a browser (← → to navigate). Every template is its own visual system with a guide, and almost all ship a finished example or a seed — build from those, **not** from scratch, and never mix two templates' systems.

## Resource map

All paths are relative to this skill's directory.

```
slides/
├── SKILL.md                    ← you're reading this (shared workflow)
├── templates/<id>/GUIDE.md     ← per-template instructions (+ example.html, assets/, references/, design-system/)
├── templates/html-ppt/         ← shared runtime, 36 themes and 31 layouts used by every html-ppt-* template
├── toolkit/deck-toolkit.js     ← presenting toolkit injected into every deck (Step 3)
├── toolkit/stage-seed.html     ← the 1920×1080 stage kernel the self-made templates share
├── craft/                      ← cross-template craft rules (anti-ai-slop, color, typography, accessibility…)
└── references/critique.md      ← five-dimension self-review before publishing
```

## What the creation message gives you

A creation request is a chat message that @-mentions you. It names:

- the **template** id (possibly with its Chinese title);
- whether to explore visual directions first — `先出 2–3 个视觉方向：是` / `否`;
- parameters as `label：value` lines: `主题` (topic, required), `内容要点` (points, sources, must-keep numbers), `目标受众` (audience), `页数` (slide count), `演讲者备注` (`是` = write speaker notes for every slide);
- optionally attachments (outlines, documents, data, logos, screenshots, photos) — use them, they beat anything you would fetch or invent.

A plain request in the chat (no creation message) is confirmed first: pick the closest template from the index below (`html-ppt` when nothing fits better; gonggong's `plugin_catalog` with `plugin: slides` lists them all), fill in what the conversation already says, and post a 创作确认卡 with `creation_propose`, leaving unknown required parameters blank. Build nothing until the creation message arrives. Without those tools, build directly with the closest template and no directions.

## Template index

The guide for template `<id>` is `templates/<id>/GUIDE.md`.

<!-- TEMPLATE-INDEX -->
**经典·汇报**
- `html-ppt-weekly-report` 数据周报 — 浅灰白底单一钴蓝强调，八格指标、已交付清单、八周柱图与下周负责人表，结论即标题。
- `simple-deck` 简洁汇报 — 明暗页交替节奏，单一强调色，随设计系统或品牌色换肤；适合经营复盘、产品介绍与短路演。
- `gov-report` 政企汇报 — 白底正红配深灰、页眉单位名与红色粗线，任务完成表、成效数据、问题与下步计划，适合国企、机关与大型企业的年度汇报。
- `html-ppt-zhangzara-signal` 深蓝战略 — 深海军蓝底配骨白纸页，单一暗金强调，衬线标题沉稳克制；适合战略决策、董事会与咨询交付。
- `ib-pitch-book` 投行资料册 — 机密标识与页眉，可比公司表、估值足球场、DCF 敏感性矩阵；适合并购顾问与战略选项讨论。
- `html-ppt-testing-safety-alert` 警示合规 — 暖白底红黑警示斜纹、删除线否定标题、红黄绿分级卡与检查清单，适合风险合规与复盘。
- `html-ppt-zhangzara-grove` 森林政策 — 墨绿底配骨白衬线与铁锈红点缀，明暗页交替、侧栏标注，中英双语友好，适合政策与议会简报。

**经典·发布路演**
- `html-ppt-pitch-deck` 融资路演 — 白底配蓝紫渐变、超大标题与巨型数字，十页经典结构：问题、方案、市场、牵引、融资额。
- `html-ppt-product-launch` 暗场发布 — 深色主视觉配暖橙渐变光球，功能卡、步骤、价格档与客户证言收尾，适合发布会与上线公告。
- `guizang-ppt` 杂志发布会 — 电子杂志加电子墨水风，衬线大标题与流体动态背景，横向翻页；适合发布会、行业分享与营销规划。
- `html-ppt-zhangzara-coral` 珊瑚增长 — 奶油、珊瑚红与近黑交替，Bebas 窄体大写标题配锯齿纹，适合增长计划、品牌营销汇报。
- `html-ppt-zhangzara-bold-poster` 巨字海报 — 白底黑字配消防红单色点缀、超大复古手写体堆叠标题，适合品牌宣言、愿景路演、融资故事。
- `new-chinese` 新中式 — 宣纸米白底、墨色宋楷配朱砂印章，竖排标题与水墨线描留白，适合文化品牌、茶与文旅、非遗与国风新品发布。

**经典·技术教育**
- `html-ppt` 演示工作室 — 36 套主题、31 种版式、15 套整稿起点，键盘翻页与演讲者模式；按场景选主题与模板，通用各类演示。
- `html-ppt-tech-sharing` 代码分享 — 代码编辑器暗底、等宽提示符小标题、薄荷到天蓝渐变标题与终端代码块，适合工程师内部分享。
- `html-ppt-taste-brutalist` CRT 简报 — 炭黑底荧白等宽字、唯一警示红、扫描线与发丝线网格、零圆角，适合事故复盘与安全评审。
- `html-ppt-course-module` 课程模块 — 暖米纸面配衬线大标题，左侧常驻学习目标栏，概念框、例题、练习与选择题自测。
- `html-ppt-presenter-mode-reveal` 逐字稿演讲 — 深色主题可切换，每页附 150–300 字逐字稿，按 S 打开演讲者视图看当前、下页与计时。
- `kami-deck` 羊皮纸学术 — 暖羊皮纸底单一墨蓝强调，统一字重衬线、无斜体，印刷质感；适合学术组会、研究汇报与白皮书。
- `html-ppt-zhangzara-daisy-days` 粉彩课堂 — 奶油底配粉彩圆角卡片、手绘雏菊星星彩虹与粗描边，适合培训工作坊、课堂、社区活动。

**经典·创意社媒**
- `html-ppt-taste-editorial` 极简杂志 — 暖米白底衬线标题配无衬线正文与等宽注记、发丝线分隔、单一低饱和强调色，适合投资人更新。
- `html-ppt-xhs-white-editorial` 小红书长图 — 纯白底彩虹顶条、黑色粗标题配渐变词与黑底重点胶囊、马卡龙软卡片，适合干货与晋升材料。
- `html-ppt-zhangzara-scatterbrain` 便利贴白板 — 软木与纸面底上的彩色便利贴，花体标题配手写字，像设计白板；适合毕设答辩、头脑风暴与工作坊。
- `html-ppt-zhangzara-block-frame` 新粗野提案 — 米白底配粉蓝绿黄色块、4px黑粗框与硬投影，适合品牌改版、创意提案、独立产品发布。
- `html-ppt-zhangzara-8-bit-orbit` 像素街机 — 深蓝星空底配粉青黄霓虹、像素描边大字与扫描线，适合游戏、黑客松、极客爱好分享。
- `bento-grid` 便当格 — 大小不一的圆角卡片拼成不规则网格，大数字、迷你图表与短句错峰浮现，适合产品特性一览、年度回顾与成绩单。

**交互实验**
- `newspaper` 报纸头版 — 新闻纸底黑色报头、多栏排版与首字下沉，头条逐字排出、短讯点开看全文，适合发布公告、重大新闻式汇报与年度大事记。
- `metro-map` 地铁路线图 — 整份演示是一条地铁线、每页一站，顶部迷你线路随进度点亮、点站名可跳转，适合项目路线图、里程碑与学习路径。
- `chat-story` 对话叙事 — 每页一个聊天界面，按 → 气泡逐条出现，穿插旁白大字与数据页，适合用户故事、访谈复盘、客服案例与使用场景。
- `living-model` 活体模型 — 参数面板加实时重算的图表，台上拖动滑块现场推演增长、单位经济、盈亏平衡与情景对比，适合商业模型与预算方案。
- `blueprint` 蓝图工程 — 工程蓝底白色细线、网格与图框标题栏，尺寸标注与引线编号，线条绘制入场、部件悬停说明，适合系统架构与工程方案评审。
<!-- /TEMPLATE-INDEX -->

### Retired template ids

v0.2 merged look-alike templates. A creation message (or an older request in the chat) that names one of these ids is built with the template it maps to; say so in the final reply.

<!-- RETIRED -->
| Retired id | Build with |
|---|---|
| `html-ppt-graphify-dark-graph` | `html-ppt-tech-sharing` 代码分享 |
| `html-ppt-hermes-cyber-terminal` | `html-ppt-tech-sharing` 代码分享 |
| `html-ppt-knowledge-arch-blueprint` | `blueprint` 蓝图工程 |
| `html-ppt-obsidian-claude-gradient` | `html-ppt-tech-sharing` 代码分享 |
| `html-ppt-xhs-pastel-card` | `html-ppt-xhs-white-editorial` 小红书长图 |
| `html-ppt-zhangzara-biennale-yellow` | `html-ppt-taste-editorial` 极简杂志 |
| `html-ppt-zhangzara-blue-professional` | `simple-deck` 简洁汇报 |
| `html-ppt-zhangzara-broadside` | `newspaper` 报纸头版 |
| `html-ppt-zhangzara-capsule` | `html-ppt-xhs-white-editorial` 小红书长图 |
| `html-ppt-zhangzara-cartesian` | `kami-deck` 羊皮纸学术 |
| `html-ppt-zhangzara-cobalt-grid` | `simple-deck` 简洁汇报 |
| `html-ppt-zhangzara-creative-mode` | `html-ppt-zhangzara-block-frame` 新粗野提案 |
| `html-ppt-zhangzara-editorial-tri-tone` | `html-ppt-taste-editorial` 极简杂志 |
| `html-ppt-zhangzara-long-table` | `html-ppt-zhangzara-bold-poster` 巨字海报 |
| `html-ppt-zhangzara-mat` | `html-ppt-zhangzara-signal` 深蓝战略 |
| `html-ppt-zhangzara-monochrome` | `kami-deck` 羊皮纸学术 |
| `html-ppt-zhangzara-neo-grid-bold` | `html-ppt-zhangzara-block-frame` 新粗野提案 |
| `html-ppt-zhangzara-peoples-platform` | `html-ppt-zhangzara-grove` 森林政策 |
| `html-ppt-zhangzara-pin-and-paper` | `html-ppt-zhangzara-scatterbrain` 便利贴白板 |
| `html-ppt-zhangzara-pink-script` | `html-ppt-taste-editorial` 极简杂志 |
| `html-ppt-zhangzara-playful` | `html-ppt-zhangzara-daisy-days` 粉彩课堂 |
| `html-ppt-zhangzara-raw-grid` | `html-ppt-zhangzara-block-frame` 新粗野提案 |
| `html-ppt-zhangzara-retro-windows` | `html-ppt-zhangzara-8-bit-orbit` 像素街机 |
| `html-ppt-zhangzara-retro-zine` | `html-ppt-zhangzara-scatterbrain` 便利贴白板 |
| `html-ppt-zhangzara-sakura-chroma` | `html-ppt-xhs-white-editorial` 小红书长图 |
| `html-ppt-zhangzara-soft-editorial` | `html-ppt-taste-editorial` 极简杂志 |
| `html-ppt-zhangzara-stencil-tablet` | `html-ppt-testing-safety-alert` 警示合规 |
| `html-ppt-zhangzara-studio` | `html-ppt-zhangzara-block-frame` 新粗野提案 |
| `html-ppt-zhangzara-vellum` | `kami-deck` 羊皮纸学术 |
| `weekly-update` | `html-ppt-weekly-report` 数据周报 |
<!-- /RETIRED -->

## Interaction rules

- **Ask at most one round, only when required information is missing.** The only hard requirement is a topic you can build a story on. If it is missing and cannot be inferred from the message or attachments, call `ask_group_members` once with every open question in that single call (≤ 4). After that round — answered or timed out — proceed with your best judgement and list the assumptions in your final reply. Never ask a second round.
- **Otherwise go straight to the deck.** Plan the storyline internally; do not ask anyone to confirm the outline, theme or rhythm.
- **Visual directions first, only when the message says `是`.** See Step 2.

Write slide copy in the language of the creation message (usually Chinese) and set `<html lang="zh-CN">` for Chinese decks. Every font stack ends with a Chinese fallback — sans: `"PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif`; serif: `"Songti SC","Noto Serif SC",serif`.

## Workflow

### Step 0 — Pre-flight (once, before writing anything)

1. **Pick the output folder.** `slug` = short kebab-case ASCII derived from the topic (e.g. `q3-growth-review`); if `design/<slug>/` already exists and is not this same deck, append `-2`, `-3`… Everything for this deck lives in `design/<slug>/` in the workspace.
2. **Read the template guide** `templates/<id>/GUIDE.md` and every file it tells you to read first (seed, layouts, themes, checklist, design system). Open the example: it is a finished deck in this system — study its structure, density and finish, never copy its copy, people, brands or links.
3. **Skim `craft/anti-ai-slop.md`** — it applies to every template.

### Step 1 — Plan the story

Before any HTML, decide internally:

- **Slide count.** Use `页数` when given; otherwise 8–12 for a talk or report, 6 for a short pitch or lightning talk.
- **The storyline.** Write one claim-style title per slide (the titles alone should tell the story), then pick the template layout that carries each one. Alternate dense and breathing slides; open with a cover, close with a clear ask, decision or summary.
- **Numbers.** Use only figures from the message, attachments or sources you actually fetched. Where a number is needed but unknown, show a clearly marked placeholder (e.g. `【待补：转化率】`) and list it in the final reply.

### Step 2 — Visual directions (only when asked)

1. Write 2–3 direction sketches to `design/<slug>/directions/<n>-<name>.html` (e.g. `1-bold.html`). Each holds the cover plus one signature content slide, built in the chosen template's system. Directions must differ in composition, not just copy: layout, type scale, colour emphasis, imagery treatment, density.
2. Screenshot each sketch's cover to a PNG next to it (`<n>-<name>.png`, 1280×720), e.g. with headless Chrome/Chromium: `--headless=new --screenshot=<abs png path> --window-size=1280,720 file://<abs html path>`. If no browser is available or the screenshot fails, skip the PNG.
3. Call `ask_group_members` with one `single` question (title like `选哪个视觉方向？`), one short Chinese option name per direction, `recommended` set to your pick, and `option_meta` aligned with the options by index: `description` — one sentence on what makes the direction distinct (≤ 120 chars); `image` — the workspace-relative PNG path, or the HTML path when there is no PNG.
4. Wait for the answer, then build the full deck in the chosen direction. If someone answers with their own text, fold it in. If the question times out, use your recommended direction and say so in the final reply. This counts as your one question round.

### Step 3 — Build

Follow the template guide. Where the guide and this file disagree on *what to build*, the guide wins; on *where to write and how to publish*, this file wins.

- Start from the template's seed or example: copy it to `design/<slug>/index.html`, keep its CSS and navigation script, and replace the content slide by slide.
- Copy every local file the deck links (scripts, stylesheets, fonts, images) into `design/<slug>/` and reference it relatively — the folder must work on its own. Never link back into the skill directory.
- When `演讲者备注：是`, write notes for every slide in the template's notes mechanism (the guide names it); otherwise skip notes.
- **Inject the presenting toolkit.** Copy `toolkit/deck-toolkit.js` to `design/<slug>/assets/deck-toolkit.js` and load it as the last element of `<head>`: `<script src="./assets/deck-toolkit.js"></script>` (examples and seeds already carry the tag with a path into the skill — rewrite it). It must sit in `<head>` so its keys win over the template's. It adds `?` help, O overview, S presenter window, L laser, D pen, B/W black/white screen, digits + Enter jump and print layout (Cmd/Ctrl+P → one 1920×1080 PDF page per slide) to whatever paging the template has; never remove the template's own paging script. The toolkit drives the deck through `window.deck = { slides, index, go(i) }` when the template script sets it (keep that line when you edit the script) and falls back to ← → key presses otherwise.

### Step 4 — Critique

Run `references/critique.md` (it starts with the template's own checklist when there is one) and fix what it finds before publishing.

### Step 5 — Publish and reply

1. Make sure `design/<slug>/index.html` and every asset it uses are in `design/<slug>/`.
2. Call the gonggong `preview_static` tool with `dir` = `design/<slug>` and `title` = the deck title.
3. Reply with one short message: the file path, template used, slide count and the storyline in one line, how to navigate (← →, `?` for the presenting keys, S for the presenter window), what the critique fixed, and any assumptions or remaining placeholders. Do not paste the HTML into chat.

## Hard rules

- **Stay in the system.** Colours, fonts and decoration come from the template (or the design system its guide names). One template per deck.
- **Real content.** Specific copy from the brief and attachments; no lorem, "Point One", invented quotes, customer logos, awards or statistics.
- **Real imagery, never remote hotlinks.** Prefer attachments. For a named real-world referent, fetch the correct real image, copy it into `design/<slug>/` and reference it relatively; never generate or invent a substitute. If no compliant asset can be acquired, keep an intentional labeled placeholder and say so. Charts and diagrams are inline SVG or HTML/CSS.
- **Fits the stage.** Nothing overflows or is clipped at 16:9; split a slide rather than shrink text below the template's body size.
- **`data-section="<id>"` on every slide** (short, unique, kebab-case) so people can point at a slide when they give feedback. When someone later asks to change one slide, edit only that slide and keep the rest byte-for-byte.
- **One file, no build step.** Inline CSS and JS (plus the local assets the template ships), no frameworks or CDN scripts beyond what the template already uses.

## Output contract

```
design/<slug>/
├── index.html          ← the deck
├── assets/…            ← scripts, styles and images it links, referenced relatively
└── directions/         ← only when directions were explored
```

Publish with `preview_static` (`dir` = `design/<slug>`), then one short reply. Nothing after.
