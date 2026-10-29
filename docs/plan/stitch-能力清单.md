# Google Stitch 能力清单（一比一复刻用）

调研日期：2026-10-29。环境：ego-browser 登录用户 Google 账号，Stitch BETA（界面英文）。
截图目录：`/tmp/stitch/`（下文"截图"列只写文件名）。
实测项目：新建「共工对标测试」（id 1330606944882872742），提示词「一个读书俱乐部小程序（手机 App）的首页和书籍详情页」。用户原项目只做只读观察。

## 总览

| 编号 | 模块 | 能力 | 交互要点 | 截图 |
|---|---|---|---|---|
| 1 | 首页 | 项目侧栏 | My Projects / Shared with me 切换、搜索、按 Recent / Last 30 days / Last Year / Examples 分组 | 20-home |
| 2 | 首页 | 新建输入框 | App/Web 切换（换占位文案和示例）、+ 菜单、DESIGN.md 选择、模型档位、Live Mode、发送 | 20-home, 29-home-web |
| 3 | 首页 | Start with your design | 粘贴/上传 DESIGN.md、上传代码图片字体 logo、.fig、GitHub 仓库、网站 URL、补充说明 → Continue | 26-home-start-with-design |
| 4 | 首页 | 示例与灵感 | 3 个提示词芯片（点即填入）、Need inspiration? 横向卡片轮播 | 20-home |
| 5 | 首页/全局 | 顶栏 | Docs、Discord、X、What's New（礼盒）、⋮ 菜单、账号菜单、右下 Appearance | 24/25/27/28 |
| 6 | 设置 | Settings 页 | 每日额度 21/400、训练开关、邮件偏好、API key | 11-settings |
| 7 | 画布 | 无限画布 | 点阵背景、滚轮/拖动、缩放菜单、Zoom to Fit 等快捷键 | 00-project, 81-zoom-menu |
| 8 | 画布 | 节点类型 | 屏幕（devices 图标）、设计系统（palette 图标）、DESIGN.md（article 图标）、Prototype（play 图标，Double click to open） | 49-generated, 80-canvas-after-proto |
| 9 | 画布 | 选中屏幕 | 紫色描边 + 四角手柄 + 尺寸徽标 390 x 2091；顶部浮动工具条 Generate/Modify/Preview/More；输入框出现上下文芯片 | 55-screen-selected |
| 10 | 画布 | 右键菜单 | Add to Chat、Copy、Copy as、Cut、Duplicate、Focus、Favourite、Rename、Delete + Generate/Edit/Preview 分组 + Show Connections 等 | 83-context-menu |
| 11 | 工具栏 | 右侧竖向工具栏 | Select(V)、Mark(M)、Direct Edit(E)、Hand(H)、Upload files to canvas、DESIGN.md、Favourites | 91-tool-mark, 89/90 |
| 12 | 编辑 | Direct Edit | 点元素弹 Edit Element：Edit Text / Edit With AI / Delete | 88-direct-edit-element |
| 13 | 编辑 | View Details | 右侧面板：缩略图、Type、Size、DESIGN.md、Source(View Code)、Design Prompt | 60-view-details |
| 14 | 编辑 | View Code | 全屏代码弹窗，语法高亮 + 颜色色块，Copy code | 61-view-code |
| 15 | AI | Variations | 输入框开关（3x）、右键 Variations 子菜单（Layout/Color Scheme/Images/Text Font/Text Content/Custom...） | 46, 86-ctx-variations |
| 16 | AI | Generate 菜单 | Instant Prototype、Variations、Regenerate、Predictive Heatmap、Desktop Web Version、Missing States、Animate、App Store Assets、Web Assets、Marketing Kit、Accessibility Audit | 56-sel-generate |
| 17 | 主题 | DESIGN.md / Theme 面板 | Mode 明暗、Seed Color、Color theme（Custom/Fidelity/Tonal Spot/Vibrant/Expressive/Content）、Color Palette 四色、Font 三档、Save / Save & Apply；第二 Tab 为 DESIGN.md 原文 | 89-tool-designmd, 92 |
| 18 | 原型 | Play / Instant Prototype | 自动连线生成原型 → 原型编辑器（Preview/Edit），热点 Connected 标记，Connect Element 面板（目标屏、状态、转场） | 67/68/70/71/72 |
| 19 | 原型 | 原型编辑器工具 | 设备切换、重载、热点高亮开关、二维码、新标签打开、底部铅笔「描述如何改这屏」、Add Screen / Imagine a new screen | 69-*, 75, 78 |
| 20 | AI 输入 | 底部输入框 | + 菜单（Upload Files / Website URL / Variations）、/ 命令 8 个、Variations 开关、DESIGN.md 选择、模型档位、Live 语音、发送；上方提示 Tip 轮播 | 40-46 |
| 21 | Agent | 左侧 Agent 面板 | 用户消息卡（可展开、复制）+ Markdown 计划/总结 + 进度阶段（Building the design system / app skeleton）；•• 按钮折叠 | 48-*, 50, 52 |
| 22 | Agent | Agent log | 左下运行列表（每次提交一条，转圈→对勾），点击回看该轮对话并聚焦 | 51, 53 |
| 23 | 顶栏 | 项目菜单 | Go to all projects、Share、Download Project、Duplicate Project、Edit›、Help›、Settings、Delete Project、Command menu ⌘K、Send Feedback | 10-project-menu* |
| 24 | 顶栏 | Export | 选中屏幕后右侧面板 9 种格式；未选中显示 No screens selected | 62/63/65 |
| 25 | 顶栏 | Share | Enable sharing & remixing 开关 + Copy link | 66-share |
| 26 | 全局 | 快捷键 | 完整列表见 §9 | 12-shortcut-keys |
| 27 | 全局 | MCP / API | Export→MCP→Setup MCP：选客户端生成配置命令（含 API Key） | 64-setup-mcp* |

---

## 1. 首页（`/`）

**布局**：左侧圆角浮动侧栏（项目列表），中间大标题 "Welcome to Stitch.."，右侧两个胶囊按钮，下方大输入框，再下方示例芯片，最底 "Need inspiration?" 横向卡片带左右翻页箭头。顶栏左 "Stitch BETA" 徽标，右侧 Docs / Discord / X / What's New（礼盒，带紫点未读）/ ⋮ / 头像。右下角 Appearance 按钮。

**项目侧栏**
- 分段切换：`My Projects`（我的项目）/ `Shared with me`（共享给我）。
- `Search projects` 搜索框。
- 分组：`Recent`、`Last 30 days`、`Last Year`、`Examples`（官方示例，带 `Shared` 标记）。每项：缩略图 + 标题（两行截断）+ 设备图标（手机/桌面）+ 日期。

**新建输入框**
- 占位：App 模式 "What native mobile app shall we design?"；Web 模式 "What responsive web experience shall we design?"。
- 左下：`+`；`App` / `Web` 单选（带手机/显示器图标）。
- 右下：调色板图标（DESIGN.md 选择）、`Balanced ⌄`（模型档位）、麦克风+星（`Start Live Mode (Preview)`）、↑ `Generate designs`。
- `+` 菜单：`Upload Files`（上传文件/图片）、`Website URL`（输入框内出现 "Paste URL..." 行 + 取消 ×）、分隔线、`Enhance prompt`（AI 改写提示词）。
- 调色板菜单：标题 `DESIGN.md`，说明 "Stitch will auto-select based on your prompt unless a specific Design System is picked."（不指定时按提示词自动选）；`+ Start with your design`；`Stitch Presets`：Alexandria、Bauhaus、Glacier、Carbon、Neon Tokyo（每项带四分色圆形色块）。
- 模型菜单：`Speed` — Gemini 3.5 Flash-Lite（快速协作，质量仍不错）；`Balanced` — Gemini 3.8 Flash（速度与质量平衡，默认，打勾）。只有这两档。
- 示例芯片（App）：skiing in the Alps / California activities / bird watching ecommerce；Web 模式换成 sourdough dashboard / stargazing retreat / pizza class 三条。点芯片填入输入框。
- `Live Mode`：点后立即新建一个 "New Project" 并跳进画布，输入框右侧按钮变转圈（等待麦克风授权/连接）；本次未授予麦克风，未进入语音对话。

**Start with your design 弹窗**（全屏模态）
- `Paste existing DESIGN.md`：说明 "DESIGN.md is an open-source standard document that describes the desired look and feel of your product. Learn more"，多行文本框 "Paste a DESIGN.md file here…"。
- `Drag and drop files`：三个虚线上传卡 `Upload a DESIGN.md file` / `Upload code, images, fonts and logos` / `Upload a .fig file`（带 ⓘ）。
- `Public GitHub repository` [PREVIEW]：说明 "Or get instructions to generate a DESIGN.md from your private repo with your coding agent"，输入 `https://github.com/owner/repo`。
- `Add website`：输入 `https://example.com`（从 URL 提取设计系统）。
- `Additional instructions`：文本框，占位 "e.g., Favor dark mode examples from the design files…"。
- 底部 `✦ Continue`（未填时禁用）。

**全局菜单**
- ⋮：FAQ、Forum、Prompt Guide、Send Feedback、Privacy Notice。
- 头像：姓名邮箱、`Stitch Settings`、`Manage Account`、`Switch Account`、`Sign out`、`Terms & Privacy`、`Third Party Notices`。
- What's new 弹窗：按日期列更新（Google I/O 5 Major Upgrades：Streaming、start with your existing design、in-place AI edits、motion on canvas、more export options；Meet the new Stitch：AI-native canvas、smarter design agent、voice、instant prototypes、design systems、DESIGN.md；Gemini 3.1；Direct Edits；Figma Export）。
- Appearance：Light / System（默认）/ Dark。

## 2. 设置页（`/settings`）

← Settings 标题；卡片：
- `Usage Today` — `Daily Credits 21 / 400` + 进度条（每日额度制）。
- `Allow AI model training` 开关说明。
- `Email Preferences` 三个复选框 + `Save changes`。
- `API key` + `Create key`；`Abuse auto-detection on`（公开泄露的 key 自动禁用）。

## 3. 项目画布

**整体布局**（深色点阵背景）
- 左上：汉堡菜单 + 项目名（点击或铅笔 `Rename Project` 进入行内输入，回车保存）。
- 左侧：Agent 面板（浮动圆角卡，顶部 `••` 头像按钮可折叠）；左下 `Agent log` 折叠条。
- 顶部中间：选中节点后出现浮动工具条。
- 右上：▷ `Connect and Preview with Instant Prototypes`、`Export`、`Share`、头像。（空项目时没有 ▷）
- 右侧中部：竖向工具栏。
- 底部中间：AI 输入框，上方一行灰色 Tip。
- 右下：Undo / Redo、缩放百分比、`?` Helpful Links。

**平移缩放**：滚轮/触控板平移与缩放，Space 按住临时平移，H 抓手，Z 按住缩放；缩放菜单 `Zoom in ⌘+`、`Zoom out ⌘-`、`Zoom to 100% ⇧0`、`Zoom to Fit ⇧1`、`Zoom to Selection ⇧2`。生成完成后自动缩放到能看到新节点（实测 75%→25%/27%/32%）。

**节点类型与排列**
- 设计系统节点：标题 `🎨 Warm Editorial Sanctuary`，内容是一张卡：Primary/Secondary/Tertiary/Neutral 四色及色阶条、Headline/Body/Label 字体 "Aa" 样张、按钮（Primary/Secondary/Inverted/Outlined）、搜索框、进度条、底部导航、图标按钮。
- 屏幕节点：标题 `📱 阅境读书会 - 首页`，节点内是真实渲染的 HTML（iframe），按内容全高展示（390 x 2091）。
- DESIGN.md 节点：标题 `📄 DESIGN.md`，内容是渲染后的 markdown 文本（用户原项目可见）。
- Prototype 节点：黑色设备框，中间 "Prototype / Double click to open"，标题 `▶ Prototype : Reading Club Flow`。
- 排列：同一次生成的节点从左到右横排、顶部对齐（设计系统 → 屏幕1 → 屏幕2 → 原型）；多轮生成在画布上按批次分组（用户原项目可见多行多列）。
- 每个节点标题在节点左上方，悬停/选中时标题前的图标变成拖拽柄 `⠿`。

**选中屏幕**
- 紫色描边 + 四角方形手柄 + 底部尺寸徽标 `390 x 2091`。
- 顶部浮动工具条：`✦ Generate ⌄`、`✎ Modify ⌄`、`◉ Preview ⌄`、`⋮ More`（Generate、More 带紫点表示有新功能）。
- 底部输入框上方出现上下文芯片 `📱 阅境读书会 - 首页 ×`，输入框里的调色板按钮变为当前设计系统色块。
- Generate 菜单：`Instant Prototype` NEW、`Variations ⇧V`、`Regenerate ⇧R`、`Predictive Heatmap`、`Desktop Web Version`、`Missing States` NEW、`Animate` NEW、`App Store Assets` NEW、`Web Assets` NEW、`Marketing Kit` NEW、`Accessibility Audit` NEW。
- Modify 菜单：`Edit E`、`DESIGN.md`。
- Preview 菜单：`New Tab ⇧P`、`Show QR Code`、`Mobile 390x884`、`Tablet 768x1024`、`Desktop 1280x1024`、`Full Height`。
- More 菜单：`View Details I`、`View Code ⇧C`、`Copy to Figma`、`Export` NEW `⌘⇧E`、`Download ⇧D`、`Reload ⌘R`、`Delete ⌫`（红色）。

**右键菜单**（屏幕节点）
`Add to Chat ⌘L`、`Copy ⌘C`、`Copy as ›`（Copy as Code / Copy to Figma / Copy as PNG ⌘⇧C / Copy link to selection）、`Cut ⌘X`、`Duplicate ⌘D`、`Focus F`、`Favourite ⇧F`、—、`Rename`、`Delete ⌫`、— Generate 组：`Generate ›`（同工具条 Generate 列表）、`Variations ›`（Layout / Color Scheme / Images / Text Font / Text Content / Custom... ⇧V）、`Regenerate ⇧R`；— Edit 组：`Edit E`、`DESIGN.md`；— Preview 组：`New Tab`、`Show QR Code`、Mobile/Tablet/Desktop/Full Height；`Show Connections X`、`View Details I`、`View Code ⇧C`、`Export ⌘⇧E`、`Download ⇧D`、`Reload ⌘R`。

**多选/框选**：`⌘A` 全选；`Mark - M` 工具为框选标记（见 §4）；Export 面板提示 "Select screens on the canvas to see export options… Select All Press ⌘ + A"。

## 4. 右侧竖向工具栏

从上到下（悬停有 tooltip）：
1. `Select - V`：默认选择。
2. `Mark - M`：虚线框图标，在屏幕上圈选区域作为对 AI 的标记（Annotate）。本次只点亮工具，未完成圈画→提交流程。
3. `Direct Edit - E`：进入直接编辑模式，点屏幕内元素：元素蓝框 + 连线到浮层 `Edit Element`（×关闭）：`Edit Text`、`Edit With AI`、`Delete`（红）。
4. Hand（抓手，H）。
5. `Upload files to canvas`：上传图片/文件为画布节点。
6. 分隔线。
7. `DESIGN.md`（调色板图标）：打开右侧设计系统面板（§5）。
8. Favourites（星）：右侧面板 `Favourites`，空态 "No favourites yet / Star your best screens to collect them here."，QUICK TIPS：Toggle favourite Press ⇧F on a selected screen。

## 5. 主题 / 设计系统（DESIGN.md 面板）

- 入口：工具栏调色板、Modify › DESIGN.md、输入框调色板按钮、View Details 里的 DESIGN.md 字段。
- 面板头：`‹`（Back to DESIGN.md list，返回项目内设计系统列表）、名称输入（占位 "Untitled Design System"）、铅笔 `Edit name`。
- Tab：`Theme` / `DESIGN.md`（原文 markdown，可编辑）。
- Theme 字段：
  - `Mode`：Light / Dark 分段。
  - `Seed Color`：色块 + hex（#8C5835）下拉取色。
  - `Color theme`：Custom / Fidelity / Tonal Spot / Vibrant / Expressive / Content（Material You 动态配色方案，每项四分色预览）。
  - `Color Palette`：Primary / Secondary / Tertiary / Neutral 各自下拉。
  - `Font`：Headline / Body / Label 三个字体下拉（显示字体名 + 用途，例 Literata / Plus Jakarta Sans）。
  - 底部 `Save`（只保存）/ `Save & Apply`（保存并重新应用到所有使用该设计系统的屏幕）。
- 生成代码中的体现：Tailwind config 内联 Material 3 全套色 token（surface、on-surface、primary-container…）、borderRadius、spacing、fontFamily、fontSize 预设。
- DESIGN.md 文件格式（用户原项目可见）：YAML 头 `version / name / description`，正文按"品牌色 / 功能色 / 文字 / 背景"等分节列 token。
- 首页与输入框可选 `Stitch Presets`（5 套）或 `Create new` / `Start with your design`。

## 6. 单屏编辑

- **双击屏幕**：Tip 提示 "Double-click a screen to zoom in and edit"。
- **Direct Edit**：见 §4；Edit Text 原地改字，Edit With AI 对单元素写指令，Delete 删除元素。
- **View Details（I）**：右侧可拖宽面板：标题 + 缩略图；Properties：`Type: Design Screen`、`Size 390 × 2091`、`DESIGN.md: Warm Editorial Sanctuary`、`Source: </> View Code`；`Design Prompt`：该屏由 Agent 写给生成器的英文详细提示词（分节描述每块内容和真实中文文案）。
- **View Code（⇧C）**：大模态，加载转圈后显示带行号、语法高亮、颜色值前带色块的 HTML；右上 `Copy code`、关闭。代码特征：单文件 HTML、Tailwind CDN + 内联 tailwind.config、Google Fonts、Material Symbols、图片托管在 lh3.googleusercontent.com（AI 生成图）、`lang="zh-CN"`、safe-area 处理、`body{min-height:max(884px,100dvh)}`。
- **设备/尺寸**：Preview 菜单 Mobile/Tablet/Desktop/Full Height；Generate › Desktop Web Version 生成桌面版。
- **新标签预览**：Preview › New Tab ⇧P；Show QR Code 手机扫码。
- **Variations**：输入框 Variations 开关（打开显示 `3x`，下一条提示生成 3 个方向）；右键 Variations 子菜单按维度变体。本次未提交变体生成。
- **Regenerate ⇧R / Reload ⌘R / Download ⇧D / Duplicate ⌘D / Favourite ⇧F / Rename**。

## 7. 原型

- 入口：右上 ▷（tooltip "Connect and Preview with Instant Prototypes"）或 Generate › Instant Prototype。
- 流程：点 ▷ → 输入框上方 `Generate Prototype` + 底部 "Creating prototype…"（约 20~40s）→ 自动进入原型编辑器全屏，同时画布新增 Prototype 节点，Agent 面板显示 "Prototype created"。之后双击 Prototype 节点打开。
- 原型编辑器布局：
  - 左上 `← 项目名` 返回画布。
  - 顶部中间 `▷ Preview` / `✎ Edit` 分段。
  - 左侧 `Screens in prototype` 面板（可折叠 —）：屏幕缩略图列表（当前屏紫框）、`+ Add Screen`（Add existing screen / Create with AI）、`✦ Imagine a new screen`（虚线按钮）。
  - 中间设备框渲染当前屏，可点击交互。
  - 右侧竖条：`••` Agent、设备切换（手机↔平板/桌面）、重载（显示 Preparing）、热点高亮开关（准星图标，开启时可点元素虚线框）、二维码（"Scan QR Code"）、新标签打开。
  - 首次进入有引导卡 "Welcome to the prototype editor! … Let's go!"。
- Preview 模式：点热点按连线跳转（实测首页「加入本周共读」→ 书籍详情；详情页返回按钮也已连回）。
- Edit 模式：已连线元素上方蓝色 `Connected` 标签 + 虚线框；点元素出现 `Selected` 标签 + 浮层：`Connect to screen`、`Edit text`、`Change with AI`、`Imagine new screen`。
- `Connect Element` 右侧面板：`Connect to Screen`（目标屏）、`Connect on state` + `+ Add State`（下拉 default）、`Transition`：None (Instant) / Push (Slide Left) / Push Back (Slide Right) / Slide Up；底部 `Apply Connection`。
- 设备框底部铅笔按钮：弹出输入框 "Describe how to change this screen…"（Esc to close），对当前屏发 AI 修改。
- 画布上 `Show Connections`（X，X-Ray）显示选中屏的进出连线。

## 8. 底部 AI 输入框与 Agent

**输入框**
- 占位 "What would you like to change or create?"；上方 Tip 轮播（"You can ask 'make the next screen when you click on X'"、"Double-click a screen to zoom in and edit"）。
- 左下：`+`（Upload Files / Website URL / — / Variations）、`/`。
- `/` 命令全集：`Image`、`Logo`、`Diagram`、`Animate`、`App Store Assets`、`Web Assets`、`Marketing Kit`、`Accessibility Audit`（选中后作为命令标签插入）。
- 右下：Variations 开关（`3x`）、DESIGN.md 选择（`Start with your design`、`Create new`、Stitch Presets）、`Balanced ⌄`、Live 语音（麦克风+星）、↑ 发送。
- 选中屏幕时自动带上下文芯片，可 × 移除；右键 `Add to Chat ⌘L` 也可加入。
- 生成中输入框边框有流光渐变；右下语音按钮位置在生成中变为转圈。

**Agent 面板**
- 顶部 `••`（Agent 头像，点击折叠/展开面板）。
- 用户消息卡：头像 + 截断提示词 + 复制 + 展开（展开显示全文）。
- Agent 回复：先一句进度描述（"正在为读书俱乐部小程序（移动端）规划设计规范，制定温暖精致的阅读美学风格..."），下方斜体阶段 + 转圈：`Building the design system` → `Building the app skeleton` →（生成各屏）；完成后输出 Markdown 总结（每屏要点列表、导航架构），最后常以一个"是否继续…"的问题收尾，并在输入框上方给出编号建议芯片（用户原项目：「继续重构第2批页面… 1」「调整第一批页面的某些细节样式 2」「查看…」）。
- Agent 回复语言跟随用户提示语言（中文）。屏幕内文案也是中文。
- 生成顺序：先设计系统节点（约 20s 内出现），再逐屏流式出现，总耗时约 1~2 分钟（2 屏）。

**Agent log**
- 左下折叠条 `🚀 Agent log ⌃`；展开为运行列表，每次提交一条（截断提示词，运行中转圈，完成为 ✓ 圈）。
- 点某条：Agent 面板切到该轮对话并缩放画布到相关节点。
- 未见单独的 "Agent manager / 多方向并行" 入口；多方向能力以 Variations（3x）形式提供。

## 9. 顶栏与全局

**项目菜单（汉堡）**：`‹ Go to all projects`、`Share`、`Download Project`、`Duplicate Project`、—、`Edit ›`（Undo ⌘Z、Redo ⌘⇧Z、Copy ⌘C、Paste ⌘V）、`Help ›`（Docs、FAQ、Shortcut Keys、Forum↗、Discord↗、X↗、Privacy Notice）、`Settings`（跳 /settings）、—、`Delete Project`（红）、`Command menu ⌘K`、`Send Feedback`。

**Export 面板**（右侧面板，需选中屏幕，`Format` 单选）：
| 选项 | 说明 / 按钮 |
|---|---|
| AI Studio [PREVIEW] | "AI studio will open and html and image files will download in the background…"；`Description` 文本框（默认 "Make this real."）；条款声明；`Build with AI Studio` |
| Figma | HTML 发送到 code.to.design 转换；`Convert` |
| MCP | "Need to connect your client?" `Setup MCP`；`Copy Prompt` |
| Netlify [PREVIEW] | "Deploy a single screen as a live website on Netlify. After deploying, claim the URL…"；`Deploy` |
| Lovable [PREVIEW] | 打开 Lovable 构建完整应用；`Build with Lovable` |
| Bolt [PREVIEW] | 同上；`Build with Bolt` |
| .zip | `Export` |
| Code to Clipboard | `Copy` |
| Project Brief | "Generate a product requirements document for your project."；`Project Brief` |

Setup MCP 子页：`← Back`，"Connect your IDE or CLI to Stitch via the Model Context Protocol (MCP)."，`Client` 下拉（Cursor、Antigravity、VS Code、Claude Code、Gemini CLI、Codex、OpenCode…），`API Key`（尾号掩码 + Copy key），`Configuration` 命令（如 `claude mcp add stitch --transport http --header "X-Goog-Api-Key: …" https://stitch.googleapis.com/mcp`）+ Copy；链接 Stitch MCP docs。

**Share 弹窗**：`Share Project`；`Enable sharing & remixing` 开关（默认关，"Only you can access this project"）；说明：公开后任何拿到链接的人可查看并 remix 设计和代码，可随时撤销但不影响已 remix 的副本；`🔗 Copy link`（开关关闭时禁用）。

**Helpful Links（右下 ?）**：Docs、FAQ、Shortcut Keys ?、Forum↗、Discord↗、X↗、Privacy Notice、—、Light / System / Dark、—、What's new、Send Feedback、— 底注 "Stitch can make mistakes. Please check its work."

**快捷键全集（Shortcut Keys 弹窗，? 打开）**
- GENERAL：Save ⌘S；Shortcut Keys ?
- EDIT：Undo ⌘Z；Redo ⌘⇧Z；Cut ⌘X；Copy ⌘C；Paste ⌘V；Duplicate ⌘D；Download selected ⇧D；Select All ⌘A；Delete；Nudge selected ↑↓←→；Align selected ⇧+↑↓←→；Format ⌘⇧F
- TOOLS：Select Tool V；Pan Tool H；Zoom Tool (hold) Z；Pan (hold) Space；X-Ray（see connections to and from your selected canvas item）X
- VIEW：Zoom In ⌘+；Zoom Out ⌘-；Zoom to 100% ⇧0；Zoom to Fit ⇧1；Zoom to Selection ⇧2
- NAVIGATION：Focus on Selection F；Next Screen ⌘→；Previous Screen ⌘←；Screen Above ⌘↑；Screen Below ⌘↓
- 菜单中另见：Mark M、Direct Edit E、View Details I、View Code ⇧C、Preview New Tab ⇧P、Variations ⇧V、Regenerate ⇧R、Favourite ⇧F、Add to Chat ⌘L、Export ⌘⇧E、Copy as PNG ⌘⇧C、Reload ⌘R、Command menu ⌘K。

## 10. 其他发现

- 计费：每日 credits（400/天），设置页可见当日用量。
- 生成物结构：每屏 = 独立 HTML 文件 + 存档的 Design Prompt + 关联 DESIGN.md；设计系统是一等节点，屏幕引用它。
- Remix：公开分享的项目可被他人 remix（用户原项目名 "Remix of Duplicate of …" 即来源）。
- Duplicate Project / Download Project 在项目菜单。
- 节点标题、尺寸徽标、工具条全部是画布外层 DOM，屏幕内容是独立 iframe（不同源）。

---

## 对复刻最关键的 15 个细节

1. **设计系统先行**：每次新生成先产出设计系统节点（色板 + 字体 + 组件样张），再逐屏流式落到画布；屏幕都引用同一个 DESIGN.md。
2. **屏幕 = 单文件 HTML + Tailwind CDN + 内联 M3 token 的 tailwind.config**，字体用 Google Fonts，图标用 Material Symbols，图片为 AI 生成并托管；按内容全高渲染（390 宽，高度自适应）。
3. **每屏保存 Agent 写的 Design Prompt**（View Details 可见），后续 Regenerate/Variations 都基于它。
4. **选中即上下文**：选中屏幕后输入框自动出现上下文芯片，所有 AI 指令默认作用于选中项；右键 Add to Chat ⌘L 追加。
5. **顶部浮动工具条四组菜单**（Generate / Modify / Preview / More）与右键菜单内容一致，并都标注快捷键。
6. **Agent 面板的阶段文案**（Building the design system → Building the app skeleton → 各屏），完成后 Markdown 总结 + 结尾追问 + 编号建议芯片。
7. **Agent log 运行列表**：每次提交一条，转圈/对勾状态，点击回放对应对话并聚焦画布。
8. **Theme 面板基于 Material You**：Mode、Seed Color、Color theme 六种方案、四色 Palette、三档字体，`Save` 与 `Save & Apply` 区分（后者批量重刷所有屏）。
9. **DESIGN.md 是开放格式**（YAML 头 + 分节 token），可粘贴、上传、从 GitHub 仓库或网站 URL 提取，还有 5 套官方 Preset。
10. **Instant Prototype 一键自动连线**：AI 识别按钮/卡片并连到对应屏，生成 Prototype 节点；编辑器里蓝色 `Connected` 标签、Connect Element 面板（目标屏、状态、4 种转场）。
11. **原型编辑器内也能 AI 改屏与造新屏**：元素浮层 Change with AI / Imagine new screen，设备框底部铅笔输入框。
12. **Direct Edit 三动作**：Edit Text（原地改字）、Edit With AI（元素级指令）、Delete；同一套在原型 Edit 模式中复用。
13. **Variations 两种入口**：输入框 3x 开关（下一条提示出多方向）和按维度变体（Layout / Color Scheme / Images / Text Font / Text Content / Custom）。
14. **Export 统一右侧面板、单选格式**，每种格式一段说明 + 一个主按钮；未选中时显示空态和 ⌘A 提示。复刻时至少要有 .zip、Code to Clipboard、Project Brief（生成 PRD）、MCP。
15. **/ 斜杠命令是"产物类型"**（Image、Logo、Diagram、Animate、App Store Assets、Web Assets、Marketing Kit、Accessibility Audit），与 Generate 菜单的 NEW 项一一对应，是从"屏幕设计"扩展到"营销物料/审计"的统一入口。

---

## 未体验到的能力及原因

- **Live Mode 语音对话**：需要浏览器麦克风授权（浏览器自有弹窗，需用户处理），只看到点击后新建项目并进入连接中状态。
- **Mark（圈画批注）提交给 AI 的完整流程**：只点亮了工具，未完成圈画和提交。
- **Variations / Regenerate / Desktop Web Version / Missing States / Predictive Heatmap / Animate / 各类 Assets / Accessibility Audit 的实际产出**：时间所限未提交（每次消耗额度且耗时 1~2 分钟）。
- **Edit Text / Edit With AI 的实际编辑与换图、属性面板**：只看到 Edit Element 浮层三个入口，未改内容；未见独立的属性（颜色/间距）面板。
- **Theme 改动后 Save & Apply 的全屏重刷效果**：未提交；DESIGN.md Tab 原文编辑与设计系统列表页因面板被关闭未截到。
- **Upload files to canvas、+ Upload Files 图片输入、Website URL 提取**：未上传文件、未提交 URL。
- **Export 各格式的实际执行**（AI Studio、Figma、Netlify、Lovable、Bolt 按约束不授权；.zip / Clipboard / Project Brief 未点执行）。
- **Share 开关、Copy link、Download Project、Duplicate Project、Delete Project**：按安全边界不提交。
- **多选/框选、拖拽移动节点、Command menu ⌘K 内容、Show Connections X-Ray 视图、Copy as PNG**：时间所限未逐项实测。
- **"Agent manager"（多方向并行管理）**：界面上未发现该入口，可能已并入 Variations 或尚未对该账号开放。

## 副作用说明

- 新建了项目「共工对标测试」（含 1 个设计系统、2 屏、1 个原型），消耗了少量每日 credits。
- 打开 Export › MCP › Setup MCP 后，面板显示了一个 Stitch API Key（Settings 页此前显示无 key，疑似自动创建）。建议到 Settings › API key 检查，不需要的话删除。本文与截图均未保存完整 key。
