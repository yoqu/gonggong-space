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
**战略咨询**
- `html-ppt-weekly-report` 商务蓝数据周报 — 浅灰白底单一钴蓝强调，八格指标、已交付清单、八周柱图与下周负责人表，结论即标题。
- `html-ppt-zhangzara-blue-professional` 米纸钴蓝季度业务汇报 — 米黄纸底配单一电光钴蓝、现代无衬线排版，适合季度复盘、咨询交付、B2B 方案汇报。
- `html-ppt-zhangzara-cobalt-grid` 钴蓝网格纸商业论证 — 米色方格纸底、钴蓝斜体衬线与像素阶梯装饰，严格双色，适合续约方案、研究简报、年刊。
- `html-ppt-zhangzara-mat` 鼠尾草绿中古咨询诊断 — 深鼠尾草绿底配骨白卡片与焦橙点缀，中古木质质感，适合咨询诊断、利润改善、董事会汇报。
- `html-ppt-zhangzara-monochrome` 象牙纸黑白学术简报 — 象牙纸底纯墨黑字、零彩色，细衬线大标题配 Jost 正文与等宽注记；适合研究报告、白皮书与基金评审。
- `html-ppt-zhangzara-signal` 深蓝金线战略备忘 — 深海军蓝底配骨白纸页，单一暗金强调，衬线标题沉稳克制；适合战略决策、董事会与咨询交付。
- `html-ppt-zhangzara-soft-editorial` 暖纸柔色杂志咨询 — 暖纸底配粉、柠檬、鼠尾草柔色块，优雅衬线大标题，留白从容；适合咨询路线图与品牌长文。
- `simple-deck` 简洁明暗节奏汇报 — 明暗页交替节奏，单一强调色，随设计系统或品牌色换肤；适合经营复盘、产品介绍与短路演。
- `kami-deck` 羊皮纸墨蓝印刷风 — 暖羊皮纸底单一墨蓝强调，统一字重衬线、无斜体，印刷质感；适合学术组会、研究汇报与白皮书。

**营销销售**
- `html-ppt-product-launch` 暗场橙光产品发布 — 深色主视觉配暖橙渐变光球，功能卡、步骤、价格档与客户证言收尾，适合发布会与上线公告。
- `html-ppt-zhangzara-broadside` 黑底火橙大报头条发布 — 近黑底配火焰橙、超粗小写大字与等宽说明，中英双语友好，适合发布会传播与品牌宣言。
- `html-ppt-zhangzara-coral` 珊瑚撞色增长汇报 — 奶油、珊瑚红与近黑交替，Bebas 窄体大写标题配锯齿纹，适合增长计划、品牌营销汇报。
- `guizang-ppt` 杂志墨感流体发布会 — 电子杂志加电子墨水风，衬线大标题与流体动态背景，横向翻页；适合发布会、行业分享与营销规划。

**融资财务**
- `html-ppt-pitch-deck` 白底渐变融资路演 — 白底配蓝紫渐变、超大标题与巨型数字，十页经典结构：问题、方案、市场、牵引、融资额。
- `html-ppt-zhangzara-bold-poster` 红黑巨字海报宣言 — 白底黑字配消防红单色点缀、超大复古手写体堆叠标题，适合品牌宣言、愿景路演、融资故事。
- `html-ppt-zhangzara-long-table` 奶油铁锈红财务预读 — 奶油纸底配铁锈红单色，粗体大写标题与斜体衬线、描边胶囊，适合财务模型预读、品牌活动。
- `ib-pitch-book` 投行路演资料册 — 机密标识与页眉，可比公司表、估值足球场、DCF 敏感性矩阵；适合并购顾问与战略选项讨论。

**产品技术**
- `html-ppt` HTML 演示工作室 — 36 套主题、31 种版式、15 套整稿起点，键盘翻页与演讲者模式；按场景选主题与模板，通用各类演示。
- `html-ppt-tech-sharing` 暗色代码技术分享 — 代码编辑器暗底、等宽提示符小标题、薄荷到天蓝渐变标题与终端代码块，适合工程师内部分享。
- `html-ppt-graphify-dark-graph` 暗夜图谱产品论证 — 深夜渐变底漂浮光晕、封面力导向关系图、彩虹渐变标题与玻璃卡片，适合开发工具与数据产品。
- `html-ppt-knowledge-arch-blueprint` 奶油蓝图架构复盘 — 奶油纸底蓝图网格、唯一铁锈红强调、黑框硬卡与突出一步的流程，适合架构图与事故复盘。
- `html-ppt-hermes-cyber-terminal` 暗终端工具评测 — 近黑底网格扫描线、窗口按钮栏、命令提示符标题与薄荷荧光等宽字，适合工具选型与评测。
- `html-ppt-obsidian-claude-gradient` 暗紫渐变开发教程 — 代码托管风暗底配紫蓝光晕网格、居中排版、紫胶囊徽章与三色渐变词，适合开发流程教程。
- `html-ppt-taste-brutalist` CRT 战术遥测简报 — 炭黑底荧白等宽字、唯一警示红、扫描线与发丝线网格、零圆角，适合事故复盘与安全评审。
- `weekly-update` 团队周报指标站会 — 一页一个头条数字，已交付、进行中、受阻清单带负责人与指标图；适合团队周报与运营站会。

**教育培训**
- `html-ppt-course-module` 暖纸衬线课程模块 — 暖米纸面配衬线大标题，左侧常驻学习目标栏，概念框、例题、练习与选择题自测。
- `html-ppt-presenter-mode-reveal` 深色演讲者逐字稿 — 深色主题可切换，每页附 150–300 字逐字稿，按 S 打开演讲者视图看当前、下页与计时。
- `html-ppt-zhangzara-cartesian` 暖灰衬线学术答辩 — 暖灰石色底、无彩色，Playfair 衬线标题配细线圆环，适合论文答辩、白皮书、研究报告。
- `html-ppt-zhangzara-daisy-days` 雏菊粉彩培训课件 — 奶油底配粉彩圆角卡片、手绘雏菊星星彩虹与粗描边，适合培训工作坊、课堂、社区活动。
- `html-ppt-zhangzara-pin-and-paper` 黄纸别针手记课堂汇报 — 黄色纸纹配别针插画与墨蓝手写字，便签式排版；适合课程作业、毕业答辩与工作坊复盘。
- `html-ppt-zhangzara-playful` 蜜桃暖色轻松培训 — 蜜桃暖底墨黑字，宽体粗标题配手绘圆圈线条，亲切轻松；适合技能培训、小团队发布与社群分享。
- `html-ppt-zhangzara-retro-windows` 复古视窗课堂课件 — 九十年代灰色视窗外框、像素字体与凸起按钮，怀旧好玩；适合安全意识培训与趣味课件。
- `html-ppt-zhangzara-scatterbrain` 便利贴白板创意提案 — 软木与纸面底上的彩色便利贴，花体标题配手写字，像设计白板；适合毕设答辩、头脑风暴与工作坊。
- `html-ppt-zhangzara-vellum` 深蓝暖黄学术讲座 — 深蓝底暖黄斜体衬线，单一灰青点缀，低密度安静；适合人文讲座、学术研究与政策简报。

**设计创意**
- `html-ppt-taste-editorial` 米白衬线极简杂志 — 暖米白底衬线标题配无衬线正文与等宽注记、发丝线分隔、单一低饱和强调色，适合投资人更新。
- `html-ppt-zhangzara-biennale-yellow` 暖纸日光黄展览策展 — 羊皮纸底配日光黄色块与靛蓝衬线大字、柔光晕染，适合展览、艺术机构、策展提案。
- `html-ppt-zhangzara-block-frame` 粗框撞色新野兽派提案 — 米白底配粉蓝绿黄色块、4px黑粗框与硬投影，适合品牌改版、创意提案、独立产品发布。
- `html-ppt-zhangzara-creative-mode` 米纸多彩品牌审查 — 米纸底配绿粉橙黄撞色块、超粗黑体与等宽页眉，适合品牌识别审查、创意机构提案。
- `html-ppt-zhangzara-editorial-tri-tone` 粉芥酒红三色杂志 — 粉、芥黄、酒红三色满版，粗黑体配斜体衬线，像时装杂志跨页，适合编辑提案、品牌改版。
- `html-ppt-zhangzara-raw-grid` 粗边框新粗野案例 — 粗黑描边卡片加硬投影，粉色与鼠尾草绿底，网格直给；适合设计案例、路演演示与品牌提案。
- `html-ppt-zhangzara-studio` 黑底电光黄工作室 — 炭黑底电光黄大字，整页黄底作节奏断点，等宽注记；适合工作室作品集、报价与创意提案。

**公共政策**
- `html-ppt-testing-safety-alert` 红黑警示合规简报 — 暖白底红黑警示斜纹、删除线否定标题、红黄绿分级卡与检查清单，适合风险合规与复盘。
- `html-ppt-zhangzara-grove` 森林绿衬线政策简报 — 墨绿底配骨白衬线与铁锈红点缀，明暗页交替、侧栏标注，中英双语友好，适合政策与议会简报。
- `html-ppt-zhangzara-peoples-platform` 蓝橙撞色海报倡议 — 奶油底蓝橙红三色海报撞色，粗板衬线口号配手写笔刷；适合公共政策宣讲、社区倡议与动员。
- `html-ppt-zhangzara-stencil-tablet` 镂空字土色合规审查 — 骨白底镂空刻字标题配六色大地色块，像档案手册；适合合规审查、监管通报与文博机构。

**个人社媒**
- `html-ppt-xhs-white-editorial` 白底杂志重点长图 — 纯白底彩虹顶条、黑色粗标题配渐变词与黑底重点胶囊、马卡龙软卡片，适合干货与晋升材料。
- `html-ppt-xhs-pastel-card` 马卡龙衬线心得 — 奶油底柔光色斑、衬线大标题配一个斜体强调词、圆角马卡龙色卡与环形图，适合个人故事分享。
- `html-ppt-zhangzara-8-bit-orbit` 像素霓虹街机故事分享 — 深蓝星空底配粉青黄霓虹、像素描边大字与扫描线，适合游戏、黑客松、极客爱好分享。
- `html-ppt-zhangzara-capsule` 胶囊彩块年终述职 — 骨白底配多彩糖果色胶囊标签、Didone 衬线大名，适合个人述职、作品集、生活方式品牌。
- `html-ppt-zhangzara-neo-grid-bold` 荧光黄粗网格作品集 — 灰白底粗黑网格分栏，单一荧光黄色块，大写粗体标题；适合作品集述职、个人品牌与设计提案。
- `html-ppt-zhangzara-pink-script` 黑底玫粉夜色故事 — 黑底热粉强调与珍珠奶白，大号衬线斜体标题，低密度留白；适合纪念回顾、生活方式与品牌故事。
- `html-ppt-zhangzara-retro-zine` 米色孔版小志专题 — 米色纸底孔版绿套印，窄体大标题配手写批注与拼贴；适合社区故事、独立刊物与文化活动。
- `html-ppt-zhangzara-sakura-chroma` 复古磁带彩虹画册 — 奶油纸底斜向彩虹色带，窄体粗字与规格勾选框，像老磁带包装；适合旅行影像与产品画册。
<!-- /TEMPLATE-INDEX -->

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
- **Inject the presenting toolkit.** Copy `toolkit/deck-toolkit.js` to `design/<slug>/assets/deck-toolkit.js` and load it as the last element of `<head>`: `<script src="./assets/deck-toolkit.js"></script>` (examples and seeds already carry the tag with a path into the skill — rewrite it). It must sit in `<head>` so its keys win over the template's. It adds `?` help, O overview, S presenter window, L laser, D pen, B/W black/white screen and digits + Enter jump to whatever paging the template has; never remove the template's own paging script. The toolkit drives the deck through `window.deck = { slides, index, go(i) }` when the template script sets it (keep that line when you edit the script) and falls back to ← → key presses otherwise.

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
