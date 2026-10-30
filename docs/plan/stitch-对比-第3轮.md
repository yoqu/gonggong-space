# Stitch × 共工原型编辑器 对比评审（第 3 轮：能力完整性）

日期：2026-10-30。前两轮查的是已做功能的交互和 bug，这一轮对照 `stitch-能力清单.md` 逐条核对能力是否齐全，找出缺失或做得浅的能力，并给出可以直接开发的方案。

证据：
- Stitch：沿用 `/tmp/stitch/*.png`；本轮补拍的原型编辑器、Export、画布快捷键截图在 `/tmp/stitch/r3/`（见文末「Stitch 补拍记录」）。
- 共工：R5 截图 `/tmp/art-shots/r5-*`；本轮在 mock 入口（`/tmp/mock-fix1-web` 复制到 `apps/web/mock-r3`，端口 5392，用完已删）逐个按键实测，脚本 `/tmp/compare/scripts/r3-keys.mjs`、`r3-keys2.mjs`，截图 `/tmp/compare/r3/`。
- 代码：`apps/web/src/features/artifacts/`（`menus.ts` 菜单与快捷键表、`Canvas.tsx` 键盘与指针、`geometry.ts` 节点类型）、`apps/server/src/modules/artifacts/`（`commands.ts` 指令模板、`routes.ts`）、`packages/protocol/src/artifacts.ts`、群输入框 `features/chat/MessageComposer.tsx`、创作入口 `features/plugins/CreationSheet.tsx` 与 `apps/server/plugins/official/web-prototype/gonggong-plugin.json`。

结论取值：**已有**（能力和入口都在）/ **部分**（有能力但入口缺失、语义不全或只覆盖一部分）/ **缺失** / **不做**（开发计划 B2 列明，或是平台取舍，不计入缺失）。

---

## 1. 核对表

### 1.1 选中屏幕的浮动工具条（Generate / Modify / Preview / More）

| Stitch 项 | 共工 | 结论 | 说明 |
|---|---|---|---|
| Generate › Instant Prototype | 生成 › 即时原型 | 已有 | |
| Generate › Variations ⇧V | 生成 › 变体；⇧V 打开自定义变体 | 已有 | |
| Generate › Regenerate ⇧R | 生成 › 重新生成 ⇧R | 已有 | 实测 ⇧R 发出指令（Bot 离线时提示「已排队」） |
| Generate › Predictive Heatmap | — | 不做 | B2 |
| Generate › Desktop Web Version | 桌面网页版 | 已有 | |
| Generate › Missing States | 补全状态 | 已有 | |
| Generate › Animate | 动效 | 已有 | |
| Generate › App Store Assets / Web Assets / Marketing Kit / Accessibility Audit | 应用商店素材 / 网页素材 / 营销物料 / 无障碍检查 | 已有 | |
| Modify › Edit E | 修改 › 编辑 E | 已有 | |
| Modify › DESIGN.md | 修改 › 设计系统 | 已有 | |
| Preview › New Tab ⇧P | 新标签页打开 ⇧P | 已有 | 实测打开新标签（外壳 `#play:`） |
| Preview › Show QR Code | 显示二维码 | 已有 | |
| Preview › Mobile / Tablet / Desktop / Full Height | 手机 390×884 / 平板 / 桌面 / 全高 | 已有 | |
| More › View Details I | 查看详情 I | 已有 | |
| More › View Code ⇧C | 查看代码 ⇧C | 已有 | |
| More › Copy to Figma | — | 不做 | B2 第三方导出 |
| More › Export ⌘⇧E | 导出 ⌘⇧E | 已有 | |
| More › Download ⇧D | 下载 ⇧D | 已有 | 下载 HTML |
| More › Reload ⌘R | 重新加载 ⌘R | 已有 | |
| More › Delete ⌫ | 删除 ⌫ | 已有 | 实测 Delete、Backspace 都弹确认 |

### 1.2 右键菜单（屏幕节点）

| Stitch 项 | 共工 | 结论 | 说明 |
|---|---|---|---|
| Add to Chat ⌘L | 添加到对话 ⌘L | 已有 | |
| Copy ⌘C | 复制 ⌘C | 部分 | 只进画布内部剪贴板（配合粘贴 = 复制屏），系统剪贴板是空的（实测 `navigator.clipboard.readText()` 为空） |
| Copy as › Copy as Code | — | **缺失** | G01 |
| Copy as › Copy to Figma | — | 不做 | B2 |
| Copy as › Copy as PNG ⌘⇧C | — | **缺失** | G01；实测 ⌘⇧C 无反应，快捷键表也没列 |
| Copy as › Copy link to selection | — | **缺失** | G01；共工没有指向产物/屏幕的深链 |
| Cut ⌘X / Duplicate ⌘D / Focus F / Favourite ⇧F / Rename / Delete | 剪切、创建副本、聚焦、收藏、重命名、删除 | 已有 | |
| Generate › / Variations › Layout·Color Scheme·Images·Text Font·Text Content·Custom… / Regenerate | 生成 › / 变体 › 布局·配色·图片·字体·文案·自定义… / 重新生成 | 已有 | |
| Edit 组、Preview 组 | 同工具条 | 已有 | |
| Show Connections X | 显示连线 X | 已有 | 共工：选中屏幕时始终显示它的进出连线，X 切换显示全部 |
| View Details / View Code / Export / Download / Reload | 同 | 已有 | |
| 右键屏幕**标题** | 弹出的是空白画布菜单（粘贴 / 全选 / 显示连线 / 适应画布 / 设计系统） | **部分** | G02：实测右键标题拿不到屏幕菜单，只有右键屏幕本体才行（`Canvas.tsx` 用 `closest('.art-node--screen')` 判断，标题不在节点内） |

### 1.3 快捷键（§9 全集逐键实测，mock 1440×900）

| 键 | Stitch | 共工实测 | 结论 |
|---|---|---|---|
| ? | 快捷键 | 打开「快捷键」弹窗 | 已有 |
| ⌘S | Save | 无反应（表中标「即将支持」） | 不做（共工所有修改即时成版本，没有未保存态；表里删掉这一行，G15） |
| ⌘Z / ⌘⇧Z | Undo / Redo | 版本后退 / 前进（`POST …/versions/v1/restore`） | 已有 |
| ⌘X / ⌘C / ⌘V / ⌘D | 剪切 / 复制 / 粘贴 / 副本 | 都生效（复制只到内部剪贴板） | 已有（⌘C 见 1.2） |
| ⇧D | Download selected | 下载 HTML | 已有 |
| ⌘A | Select All | 选中全部 5 个节点（含设计系统、原型节点） | 已有 |
| Delete / ⌫ | Delete | 弹确认 | 已有 |
| ↑↓←→ | Nudge selected | 平移视图 40px | 部分（取舍：屏幕位置由 manifest 决定，见 G10） |
| ⇧+↑↓←→ | Align selected | 平移视图 400px | 部分（同上） |
| ⌘⇧F | Format | 无反应，表里没列 | 缺失（G15，低优先：语义是「整理排版」） |
| V / H / M / E | 选择 / 抓手 / 标记 / 直接编辑 | 都切换工具 | 已有 |
| 按住 Z | Zoom Tool | 无反应（表中「即将支持」） | **缺失**（G15） |
| 按住 Space | Pan | 生效 | 已有 |
| X | X-Ray | 切换全部连线 | 已有 |
| ⌘+ / ⌘- / ⇧0 / ⇧1 / ⇧2 | 缩放 | 都生效 | 已有 |
| F | Focus on Selection | 缩放到所选 | 已有 |
| ⌘→ ⌘← ⌘↑ ⌘↓ | 下一屏 / 上一屏 / 上方 / 下方 | 切换选中并聚焦 | 已有 |
| I / ⇧C / ⇧P / ⇧V / ⇧R / ⇧F / ⌘L / ⌘⇧E / ⌘R | 菜单里的快捷键 | 都生效 | 已有 |
| ⌘⇧C | Copy as PNG | 无反应 | **缺失**（G01） |
| ⌘K | Command menu | 画布里无反应；在完整应用里会被 `AppShell` 的全局 ⌘K 拿去打开搜索 | **缺失**（G03） |
| Enter（选中屏幕） | — | 无反应 | 第 1 轮 K04（键盘进入屏幕内元素），保持 P2 |

### 1.4 右侧工具栏（7 个工具）

| Stitch | 共工 | 结论 | 说明 |
|---|---|---|---|
| Select V | 选择 V | 已有 | |
| Mark M（框选区域标记给 AI） | 标记 M：点选元素 + 批注列表 + 发给 AI | 部分 | 不能拖框圈一块区域（第 1 轮 T05），G08 |
| Direct Edit E | 直接编辑 E | 已有 | 共工多「连到新屏」「属性」 |
| Hand H | 抓手 H | 已有 | |
| Upload files to canvas | 上传到画布：按钮置灰「即将支持」 | **缺失** | G04：上传的图片/文件成为画布节点，并能作为 AI 上下文 |
| DESIGN.md | 设计系统 | 已有 | |
| Favourites | 收藏 | 已有 | |
| — | 批注 | 共工更好 | |

### 1.5 画布交互

| Stitch | 共工 | 结论 | 说明 |
|---|---|---|---|
| 框选多选（空白处拖框） | 空白处拖动 = 平移；⇧拖动也是平移；只有 ⇧点选和 ⌘A | **缺失** | G05 |
| Nudge / Align（自由摆放节点） | 只能拖标题手柄横向重排 | 不做（取舍） | 屏幕顺序由 gg-artifact.json 决定；G10 给出方向键的替代语义 |
| 节点：设计系统 | 设计系统节点 | 已有 | |
| 节点：屏幕 | 屏幕节点 | 已有 | |
| 节点：Prototype | 原型节点（双击打开） | 已有 | |
| 节点：DESIGN.md（📄，渲染后的 markdown） | — | **缺失** | G06（第 1 轮 C04） |
| 节点：上传的图片 / 文件 | — | **缺失** | G04 |
| 生成后自动定位到新节点 | 第 2 轮 R02 已改为布局变化且用户没动视图时重新适应 | 已有 | |
| 生成中节点流式出现 | 整张画布只读 + 顶部「AI 正在修改」 | 部分 | 第 1 轮 A06，本轮不列入（依赖 daemon 中途上传） |
| 输入框上方 Tip 轮播（「双击屏幕放大编辑」等） | — | 缺失 | G14（第 1 轮 A03），S |

### 1.6 群输入框（对应 Stitch 底部 AI 输入框）

| Stitch | 共工 | 结论 | 说明 |
|---|---|---|---|
| 选中即上下文芯片、× 移除、⌘L | ContextChips + 「发给 @Bot」+ 换 Bot | 已有 | |
| Variations 开关（3x） | 只能从菜单进变体 | **缺失** | G07（第 1 轮 A05） |
| `/` Image | 服务端有 `image` 指令模板，web 无入口 | **部分** | G07 |
| `/` Logo | 服务端有 `logo`，web 无入口 | **部分** | G07 |
| `/` Diagram | 服务端有 `diagram`，web 无入口 | **部分** | G07 |
| `/` Animate / App Store Assets / Web Assets / Marketing Kit / Accessibility Audit | 只在生成菜单里（必须先选屏） | **部分** | G07：群输入框的 `/` 只列群命令和 Agent 命令 |
| + › Upload Files | 附件、图片按钮 | 已有 | |
| + › Website URL | 只能把网址当普通文字发 | **部分** | G09：没有「网址」芯片，也没有提示 Agent 去抓取并提取风格 |
| + › Enhance prompt（首页） | — | 缺失 | 低优先，不列入本轮 |
| DESIGN.md 选择 | 只能从工具栏开设计系统面板 | 部分 | G14 顺带：芯片区加「设计系统」入口 |
| 模型档位 Speed / Balanced | RunConfigChips（模型 + 思考强度，可设为本群默认），带画布上下文时也显示 | 已有 | 共工更细 |
| Live 语音 | — | 不做 | B2 |
| 生成中流光 | 群聊运行卡片 | 已有（取舍） | |

### 1.7 创作入口（Stitch「Start with your design」+ Presets）

| Stitch | 共工 | 结论 | 说明 |
|---|---|---|---|
| Paste existing DESIGN.md | — | **缺失** | G09 |
| Upload a DESIGN.md file | 「参考资料」可附任意文件，但没告诉 Agent 把它当设计系统 | 部分 | G09 |
| Upload code, images, fonts and logos | 「参考资料」附件 | 已有 | |
| Upload a .fig file | — | 不做 | 第三方格式 |
| Public GitHub repository | 群 Bot 本身在工作区里，能读仓库；创作单没有这个字段 | 部分 | G09（加「参考仓库」可选输入，S） |
| Add website（从 URL 提取设计系统） | — | **缺失** | G09 |
| Additional instructions | 「内容要点」「目标受众」等插件输入 | 已有 | |
| Stitch Presets（5 套） | 插件设计系统 1 套（麓客+），设计系统面板也只能套用这 1 套 | **部分** | G13 |
| App / Web 切换 | 模板只有「多屏应用原型」，设备由 Agent 按主题定 | 部分 | G13 顺带：加 `device` 选择输入（小程序 / App / 桌面网页） |
| 示例芯片 / Need inspiration | 模板预览图 | 不做 | B2 首页 |

### 1.8 Agent 面板与 Agent log（共工 = 群聊消息 + 运行卡片）

| Stitch | 共工 | 结论 | 说明 |
|---|---|---|---|
| 用户消息卡（截断 + 展开 + 复制） | 群聊消息气泡 | 已有 | |
| 用户消息带所选上下文 | 气泡只显示正文和「发给 @Bot」，看不出当时选了哪屏/哪个元素（`MessageDto` 不带画布上下文） | **缺失** | G11 |
| 菜单指令的用户消息 | 气泡里是整段指令模板 + 选中内容清单 + 规则（`commands.ts` 把它们都写进 body），很长 | **部分** | G11：正文应只显示「生成变体 · 首页」这类短句，长指令放进只给 Agent 的 note |
| 阶段文案（Building the design system → app skeleton → 各屏） | 运行卡片显示工具调用步骤；插件 SKILL 没要求 Agent 汇报阶段 | 部分 | G12：SKILL 要求用 `progress_card` 报阶段 |
| 完成后 Markdown 总结 + 编号建议芯片 | Bot 回复 Markdown；没有建议芯片 | 部分 | 不列入本轮（需要通用「快捷回复」能力，跨产物） |
| Agent log：每次提交一条、转圈 → 对勾 | 运行卡片状态 | 已有 | |
| 点 log 条目 → 回看该轮并**聚焦画布** | 运行卡片和产物没有关联：看不到这轮出了哪个版本、改了哪几屏，也没有「在画布中查看」 | **缺失** | G11 |
| •• 折叠 Agent 面板 | 群聊栏本身可收起 | 已有（取舍） | |

### 1.9 View Details 字段

| Stitch | 共工 | 结论 |
|---|---|---|
| 标题 + 缩略图 | 有（这一屏的缩小 iframe） | 已有 |
| Type: Design Screen | 类型：设计屏幕 | 已有 |
| Size 390 × 2091 | 尺寸 | 已有 |
| DESIGN.md: 名称（可点） | 设计系统：名称（可点开面板） | 已有 |
| Source: View Code | 源码：查看代码 | 已有 |
| Design Prompt | 设计说明（manifest `prompt`，或 brief.md） | 已有 |
| — | 文件、来源版本 | 共工更好 |
| 面板可拖宽 | 固定宽 | 部分（P2，不列入） |

### 1.10 Theme 面板字段

| Stitch | 共工 | 结论 | 说明 |
|---|---|---|---|
| ‹ 返回设计系统列表 | 一个产物一个设计系统 | 不做（取舍） | 第 1 轮 D02 |
| 名称 + Edit name | 名称输入 | 已有 | |
| Theme / DESIGN.md 两个 Tab | 主题 / DESIGN.md（可编辑原文） | 已有 | |
| Mode Light / Dark | 模式（带「推导」） | 已有 | |
| Seed Color | 种子色（即时推导） | 已有 | |
| Color theme 六种方案 | — | 不做 | B2 |
| Color Palette：Primary / Secondary / Tertiary / Neutral 四个角色 | 色板：全部令牌平铺（16 行以上） | 部分 | 第 1 轮 D06，G13 顺带按角色分组 |
| Font：Headline / Body / Label | 字体（按 tokens 里的 `--font-*`）+ 每档字号/字重/行高 | 已有（共工更好） | |
| — | 圆角、间距 | 共工更好 | |
| Save / Save & Apply | 保存 / 保存并让 AI 统一 | 已有 | |
| Presets（Create new / Start with your design / 5 套） | 预设：插件的设计系统（1 套）、让 AI 生成 | 部分 | G13 |

### 1.11 原型编辑器全部按钮（Stitch 截图 `70`–`79` + 本轮补拍 vs 共工 `r5-proto-*`）

| Stitch | 共工 | 结论 | 说明 |
|---|---|---|---|
| ← 项目名（返回画布） | ← 产物名（返回画布） | 已有 | |
| Preview / Edit 分段 | 预览 / 编辑 | 已有 | |
| Share（右上） | 分享 | 已有 | |
| Screens in prototype（可折叠 —） | 原型中的屏幕（收起） | 已有 | |
| + Add Screen › Add existing screen / Create with AI | 添加屏幕 › 用 AI 新建屏 / 复制当前屏 | 已有（取舍） | 共工所有屏都在原型里，没有「现有屏」可加 |
| ✦ Imagine a new screen | 构想新屏 | 已有 | |
| 右侧 •• Agent | — | 不做（取舍） | 对话在左侧群聊 |
| 设备切换 | 设备（手机 / 平板 / 桌面） | 已有 | |
| 重载（Preparing） | 重新加载 | 已有 | |
| 热点高亮开关 | 高亮热点 | 已有 | |
| 二维码 Scan QR Code | 扫码查看 | 已有 | |
| 新标签打开 | 新标签页打开 | 已有 | |
| 首次引导 Welcome … Let's go! | 原型编辑器引导「开始体验」 | 已有 | |
| Edit：Connected 标签 + 虚线框 | 已连接 / 返回 标签 | 已有（共工更好） | |
| 元素浮层：Connect to screen / Edit text / Change with AI / Imagine new screen | 连到屏幕 / 编辑文字 / 用 AI 修改 / 构想新屏 | 已有 | |
| Connect Element：Connect to Screen | 连到屏幕（选择屏幕） | 已有 | |
| Connect on state + Add State | — | **缺失** | G16（第 2 轮 P05），需要原型支持多状态，本轮只做设计不实现 |
| Transition：None / Push / Push Back / Slide Up | 无转场 / 推入 / 推回 / 上滑 / 淡入 | 已有（共工多淡入） | |
| Apply Connection | 应用连接；另有断开连接 | 已有 | |
| 底部铅笔「Describe how to change this screen…」Esc 关闭 | 用 AI 修改这屏（Esc 关闭） | 已有 | |

### 1.12 Export / Share

| Stitch | 共工 | 结论 | 说明 |
|---|---|---|---|
| 未选中空态「No screens selected … ⌘A」 | 未选中导出整个产物 | 已有（共工更好） | |
| AI Studio / Figma / Netlify / Lovable / Bolt | — | 不做 | B2 |
| MCP（Setup MCP + Copy Prompt） | — | **部分** | G17：共工的 Bot 本身就在工作区，不需要 MCP；但缺「复制给编码 Agent 的提示词」（把产物路径、屏幕、DESIGN.md 要点拼成一段可粘贴的实现提示） |
| .zip | .zip（整版 + 原型外壳） | 已有 | |
| Code to Clipboard | 复制代码（所选或全部屏） | 已有 | |
| Project Brief | 项目简报（Bot 写 brief.md） | 已有 | |
| — | 分享链接 | 共工更好 | |
| Share 弹窗：开关 + 说明 + Copy link | 分享弹窗（开关、到期日、复制链接） | 已有 | |
| Remix（他人复制公开项目） | — | 不做 | 共工产物属于群，跨群复制见 G18 的「复制产物」 |

### 1.13 顶栏项目菜单与 Undo/Redo

| Stitch | 共工 | 结论 | 说明 |
|---|---|---|---|
| Go to all projects | 群聊左栏即产物所在 | 不做 | B2 首页 |
| Share | 顶栏「分享」 | 已有 | |
| Download Project | 顶栏「导出」› .zip | 已有 | |
| Duplicate Project | — | **缺失** | G18 |
| Edit › Undo / Redo / Copy / Paste | 右下撤销/重做 + 快捷键 | 已有 | |
| Help › Docs / FAQ / Shortcut Keys / … | 右下 ? 直接开快捷键 | 部分（取舍） | 第 1 轮 K06 |
| Settings | 群设置 | 已有（取舍） | |
| Delete Project | 服务端有 `POST /archive`，web 无入口 | **部分** | G18 |
| Rename Project（点标题行内改） | 标题不可改；服务端无改名接口 | **缺失** | G18 |
| Command menu ⌘K | — | **缺失** | G03 |
| Undo/Redo 语义 | 按版本前进后退（每次 AI 运行、每次手动编辑 = 一步），运行中只读 | 已有 | Stitch 粒度相同（一次生成 = 一步）；收藏、预览尺寸不进撤销栈，可接受 |

### 1.14 统计

- **缺失**：14 项 —— Copy as Code / PNG / link（3）、⌘K 命令菜单、上传到画布、上传图片节点、框选多选、DESIGN.md 节点、Variations 3x 开关、按住 Z 缩放、粘贴 DESIGN.md / 网站 URL 提取设计系统（2）、运行卡片的产物上下文与聚焦画布、用户消息不显示所选上下文、复制产物、重命名产物、Connect on state、Tip 轮播（按 G 编号合并后见下表）。
- **部分**：13 项 —— ⌘C 不进系统剪贴板、右键标题拿不到屏幕菜单、Mark 只能点选不能框区域、/ 命令（Image/Logo/Diagram 等）无 web 入口、Website URL 芯片、上传 DESIGN.md 未被当作设计系统、GitHub 仓库输入、Presets 只有 1 套、App/Web 设备选择、色板未按角色分组、菜单指令消息正文过长、阶段文案、导出缺「复制实现提示词」、删除产物无入口。
- 不计入：B2 不做项（第三方导出、Live 语音、热力图、六种配色方案、首页项目列表）与平台取舍项（Agent 面板复用群聊、一个产物一个设计系统、自由摆放节点）。

---

## 2. 缺失 / 部分项开发方案

工作量：S ≤ 半天，M 1–2 天，L 3 天以上。「协议」指 `packages/protocol` 的改动；「迁移」指数据库迁移。

### G01 复制为 ›（代码 / PNG / 选区链接）+ ⌘C 写系统剪贴板 —— M，web + 协议（bridge 消息）
- 入口：右键菜单「复制」下面加子菜单「复制为 ›」：复制代码、复制为 PNG ⌘⇧C、复制选区链接；快捷键表加 ⌘⇧C；更多菜单不变。
- 复制代码：`readFile(n.file)` 拼接（同 ExportPanel 的 `copyCode`，抽成 `actions.ts` 的 `copyScreensCode(picked, readFile)` 复用）。S。
- ⌘C：保留内部剪贴板（粘贴 = 复制屏），同时把所选屏幕的代码写进系统剪贴板，这样粘到别处是 HTML。
- 复制为 PNG：屏幕在跨源 iframe 里，父页面拿不到像素。由桥接脚本在 iframe 内自拍：
  - 协议 `BridgeToShell` 加 `{ type: 'snapshot', id }`，`BridgeFromShell` 加 `{ type: 'snapshot', id, png: string /* data URL */ } | { type: 'snapshot-error', id, message }`；同步 fixture 不涉及 daemon。
  - `apps/server/src/modules/artifacts/bridge.js`：把当前文档克隆后内联计算样式，序列化进 SVG `<foreignObject>`，画到 canvas 导出 PNG（只用同源资源；外链图片按约定本来就不允许）。按设备宽、全高，`devicePixelRatio` 取 2。
  - web：`navigator.clipboard.write([new ClipboardItem({ 'image/png': promise })])`（Chrome 允许传 Promise，保住用户手势）；失败时退回下载 PNG。
- 复制选区链接：见 G03 的深链 `?artifact=<id>&screens=<a,b>`，复制 `location.origin + /g/<groupId>?…`。
- 测试：menus 单测（子菜单项与快捷键）；Canvas 单测（⌘⇧C 发出 snapshot、⌘C 调用 copyText）；bridge 单测（jsdom 下生成 data URL 的路径用桩）。

### G02 右键屏幕标题给屏幕菜单 —— S，web
- `Canvas.tsx` 的 `onContextMenu` 判断改成 `closest('.art-node--screen, .art-title')`，标题所属节点不在选中时先选中它（与右键本体一致）。
- 测试：Canvas 单测「右键标题 → 菜单含『添加到对话』」。

### G03 ⌘K 命令菜单 + 产物深链 —— M，web
- 入口：画布获得焦点时 ⌘K（`Canvas.tsx` keyDown 里 `e.stopPropagation()`，不让 `AppShell` 的全局搜索拿走；画布外 ⌘K 仍是全局搜索）；项目菜单（G18）里也放「命令菜单 ⌘K」。
- 交互：居中弹窗 + 搜索框 + 分组列表（选择 / 生成 / 修改 / 预览 / 视图 / 工具 / 面板），每项带快捷键，↑↓ 选、Enter 执行、Esc 关；不适用的项（没选屏时的单屏命令）置灰并写原因。数据直接由 `menus.ts` 的 `generateItems / modifyItems / previewItems / moreItems / zoomItems` 和工具列表展平得到，执行走现有 `command()` / `zoom()` / `setTool()`，不新增命令实现。
- 文件：新建 `features/artifacts/CommandMenu.tsx`（用 `ui` 的 Dialog + Input + 列表，参考 `ComposerCandidates` 的键盘处理）；`menus.ts` 加 `commandMenuItems(...)`；快捷键表「通用」加 ⌘K。
- 深链（给 G01 复制链接、G11 聚焦画布共用）：`app/ChatPage.tsx` 读 `?artifact=<id>&screens=<ids>&version=<vid>`，调用 `openArtifact` 并写入 `store.ts` 新增的 `pendingFocus`；`Canvas.tsx` 拿到后选中并 `fitTo`。
- 测试：CommandMenu 单测（过滤、Enter 执行、置灰原因）；Canvas 单测（⌘K 打开且不冒泡）；ChatPage 深链单测。

### G04 上传到画布（图片 / 文件节点，可作为 AI 上下文）—— L，web + server + 协议，无迁移
- 存储：上传的参考文件进产物版本的 `refs/` 目录（随版本走、能撤销、Agent 检出后直接能读）。不进 gg-artifact.json（那是 Agent 的契约），画布按版本文件列表里 `refs/*` 生成节点。
- 协议：
  - `ARTIFACT_UPLOAD_TYPES` 增加 `application/pdf`、`text/markdown`、`text/plain`（参考文件；仍拒 SVG），上限沿用 5 MB。
  - `ArtifactEditOp` 加 `{ kind: 'ref', uploadId, name }`（写到 `refs/<安全文件名>`，重名加序号）和 `{ kind: 'ref-delete', path }`（只允许 `refs/` 下）。
  - `ArtifactContext` 加 `refs: string[]`（`refs/…` 路径，最多 20）。
- 服务端：`edits.ts` 实现两个 op（复用 `asset` op 的上传读取与配额）；`commands.ts` 的 `contextLines` 对 refs 输出「参考文件：design/<slug>/refs/x.png（图片，请查看后按要求处理）」；`messages/routes.ts` 透传。
- web：
  - 工具栏「上传到画布」启用：点开文件选择；画布支持拖放文件、⌘V 粘贴剪贴板里的图片（`paste` 事件里有 image 时走上传，否则走现有屏幕粘贴）。
  - `geometry.ts` 加节点类型 `ref`：放在屏幕行下方单独一行；图片按原比例缩到宽 360，文件显示图标卡（名称、大小）。图片地址走现有产物文件路由（`readArtifactFile` 的 blob URL）。
  - 选中 ref 节点 → 上下文芯片「参考图 · x.png」；右键：添加到对话、下载、删除；双击图片用 `ui/lightbox` 打开。
  - 运行中只读规则同屏幕。
- 测试：协议单测（新 op 校验、路径限制）；服务端集成（上传 → ref op → 新版本含 refs/、上下文 note 含路径）；web geometry/Canvas 单测（ref 节点布局、芯片）。e2e 补一条「拖图到画布 → 选中 → 发消息，Agent 收到路径」。

### G05 框选多选 —— M，web
- 交互（对齐 Stitch / Figma）：选择工具下，在空白处按下拖动 = 画框选矩形，选中与之相交的节点（⇧ 时追加）；平移改为 Space 拖、抓手工具、中键拖、双指滚动（已有）。为了不破坏老用户习惯，第一版用「⇧ + 拖动 = 框选」，同时在快捷键表写明；之后看反馈再切默认。（以 Stitch 补拍结论为准，见文末。）
- 文件：`Canvas.tsx` 的 `pointerDown/Move/Up` 增加 `marquee` 状态，`.art-overlay` 里画矩形；`geometry.ts` 加 `nodesInRect(nodes, rect)`。
- 测试：geometry 单测（相交判定）；Canvas 单测（⇧拖框选中两屏、普通拖动仍平移）。

### G06 DESIGN.md 节点 —— S/M，web
- `geometry.ts` 加节点类型 `doc`：版本里有 `DESIGN.md` 时排在设计系统节点之后，宽 560，高按内容（量出来，和设计系统卡一样）。
- 渲染：读 `DESIGN.md`（`readFile`），去掉 YAML 头后用 chat 的 `Markdown` 组件只读渲染，长文截断并渐隐，标题「📄 DESIGN.md」。
- 双击或「打开」→ 设计系统面板切到 DESIGN.md 标签（`DesignSystemPanel` 支持传入初始 tab）。⌘A、适应画布都包括它。
- 测试：geometry 单测（有/无 DESIGN.md 的布局）；Canvas 单测（双击打开 md 标签）。

### G07 输入框 Variations 3x 开关 + `/` 产物命令 —— M，web（服务端指令已有，无协议改动）
- 3x 开关：`ContextChips.tsx` 在有画布上下文时显示「变体 ×3」切换（可改 1–5，默认关，发送后自动关）。打开时发送不走普通消息，改调 `POST /artifacts/:id/commands`：`{ command: 'variations', count, text: 草稿, screenIds }`（草稿为空时不允许发送）。`MessageComposer.tsx` 的 `send` 里分支。
- `/` 产物命令：画布有上下文（或当前标签是产物）时，`ComposerCandidates` 的 `/` 候选最前面加「产物」分组：图片、Logo、图表、动效、应用商店素材、网页素材、营销物料、无障碍检查。选中后在输入框前插入一个命令标签（不可编辑的 token，`/Logo `），发送时识别并调 commands：`{ command, text: 其余文字, screenIds }`。动效、无障碍检查需要选中屏幕，没选时候选项置灰写「先在画布上选屏」。
- 文件：`features/artifacts/actions.ts`（`ARTIFACT_SLASH` 列表与 `sendCommand` 复用）、`features/chat/ComposerCandidates.tsx`、`MessageComposer.tsx`、`ContextChips.tsx`、`chips.css`、各 `en.ts`。
- 测试：ComposerCandidates 单测（有画布上下文时出现产物分组）；MessageComposer 单测（开 3x 后发送调用 commands 而非 messages；`/Logo xxx` 同理）。

### G08 Mark 框选区域 —— M，web + bridge（协议已有 `rect`）
- 标记工具下，在屏幕内按下拖动画矩形（桥接里画虚线框），松开后弹出批注输入；批注不带 `ggId`，只带 `rect`（文档坐标）和框内命中的元素文字摘要作为 `snippet`。点选元素的现有行为保留（单击 = 点选，拖动 = 框选）。
- 协议：`BridgeFromShell` 加 `{ type: 'mark-rect', rect, snippet }`（或复用 `select` 加可选 `rect` 并允许无 ggId，二选一，推荐新消息）；`CreateAnnotationReq.ggId` 已是 `nullable`、`rect` 已必填，批注接口不用改。
- 服务端 `commands.ts` 的批注行对无 ggId 的写「区域 (x,y,w,h) 内：snippet」。
- 测试：bridge 单测、AnnotationsPanel 显示区域批注、服务端 sendAnnotations 文案。

### G09 「从你的设计开始」：粘贴/上传 DESIGN.md、网站 URL 提取、参考仓库 —— S（插件）+ S（web 输入框网址芯片）
- 插件（无代码改动，`gonggong-plugin.json` + SKILL.md）：模板 inputs 增加
  - `design_md`（text，「粘贴 DESIGN.md」，占位「粘贴现成的 DESIGN.md，留空则用所选设计系统」）；
  - `reference_url`（string，「参考网站」，占位「https://…，AI 会抓取页面并提取配色、字体和组件风格」）；
  - `reference_repo`（string，「参考仓库」，可选）。
  - SKILL.md 第 3 步「Design system」补规则：有 `design_md` 时以它为准写 DESIGN.md 并按 front matter 生成 tokens.css；参考资料里有名为 `DESIGN.md` 的附件同样处理；有 `reference_url` 时先抓取（WebFetch / 浏览器）提取色板、字体、圆角、组件样式写成 DESIGN.md 与 tokens.css，回复里说明提取结果；三者都没有才用所选预设。
  - 创作单的「设计系统」步骤：当 `design_md` 或 `reference_url` 填了时，侧栏「将交给 AI 的内容」显示「设计系统：来自粘贴的 DESIGN.md / 来自网站」，预设选择置灰说明。需要 `CreationSheet.tsx` 识别这两个输入 id —— 改为插件 manifest 声明 `designSource: true` 的输入（协议 `PluginInput` 加可选布尔），避免写死 id。这一步是协议改动，S。
- 群输入框「网址」：`MessageComposer` 的工具里加「网址」按钮，插入一行「参考网站：」芯片输入；发送时如果带画布上下文，note 里加一句「请先抓取参考网站，提取风格后再修改」。web 端 S，无协议改动（拼进正文即可）。
- 测试：插件 manifest 校验单测；CreationSheet 单测（填了 DESIGN.md 后预设置灰）；服务端 creations 生成的提示里包含粘贴内容。

### G10 方向键 / ⇧方向键的语义 —— S，web（取舍下的替代）
- 屏幕位置由 manifest 顺序决定，不做自由坐标。选中屏幕时：←/→ 把它与左右邻屏换位（manifest `reorder`，生成新版本），↑↓ 仍平移视图；没选中时方向键平移视图（现状）。⇧方向键维持大步平移。快捷键表把「微移所选」改成「左右移动所选屏幕」。
- 风险：误触会产生版本。折中：换位 300ms 防抖合并成一次编辑。
- 若不认可这个替代，保持现状并在表中写「移动视图」即可（第 1 轮 K02 已写）。

### G11 运行卡片与产物打通（Agent log 聚焦画布、消息显示上下文、指令消息精简）—— M，server + web + 协议，无迁移
- 协议：
  - `MessageDto` 加 `canvas?: { artifactId, title, screens: { id, title }[], elements: { file, ggId, label }[] }`（来自 `meta`，发送时服务端已经算出这些信息）。
  - `RunDto`（运行卡片的数据）加 `artifacts?: { artifactId, title, versionId, n, changedScreens: { id, title }[] }[]`：由 `artifact_versions.run_id = run.id` 查出，`changedScreens` 按与父版本的文件 hash 对比得出（`screens/<id>.html` 变了或新增）。
- 服务端：
  - `messages/routes.ts` 发送时把 `canvasContext` 的结构化结果存进 `meta.canvas`；`messageDto` 输出。
  - `commands.ts` 的 `postAsMember`：正文改成短句「@bot 生成变体（布局）」「@bot 重新生成」+ 选中内容的一行摘要；完整指令、清单、RULES 放进 `meta.artifactNote`（已有字段，只给 Agent）。注意 `sendAnnotations` 同样处理。
  - 运行 DTO 组装处 join `artifact_versions`。
- web：
  - `TimelineItems.tsx` 用户气泡下方显示上下文芯片（屏 / 屏 › 元素），点击 → 打开产物并选中聚焦（G03 的 `pendingFocus`）。
  - 运行卡片底部加「产物 · v3 · 改了 首页、详情 · 在画布中查看」，点击打开产物标签、切到该版本（不是当前版本时进入只读查看）、选中并聚焦 changedScreens。
- 测试：服务端集成（带 artifactContext 发消息 → MessageDto.canvas；命令消息 body 为短句、note 含完整指令；run 完成后 RunDto.artifacts 含版本和改动屏）；web 单测（气泡芯片、运行卡片按钮调用 openArtifact + pendingFocus）。

### G12 阶段文案 —— S，插件 SKILL.md
- SKILL.md 工作流各步要求调用 `progress_card`（已有 MCP 工具）更新阶段：「搭建设计系统」→「搭建应用骨架」→「生成 首页（1/4）」…→「自检与连线」。运行卡片里即可看到与 Stitch 一致的阶段。无代码改动。

### G13 预设与设备、色板分组 —— M，插件内容 + web
- 预设：插件新增 4 套设计系统（与 Stitch 5 套对应的风格方向，自写内容，不搬运 Stitch 的名称与数值）：例如「暖调阅读（衬线、米色）」「包豪斯（高对比、几何）」「冰川（冷蓝、玻璃）」「霓虹夜（深色、荧光）」。每套 = `DESIGN.md` + `tokens.css` + manifest 里的 swatches。设计系统面板的「预设」与创作单自动列出，无代码改动。M（内容工作量）。
- 设备：模板 inputs 加 `device`（select：小程序 / App / 桌面网页，默认小程序），SKILL.md 按它写 manifest `device`。S。
- 色板分组（第 1 轮 D06）：`DesignSystemPanel.tsx` 色板按角色分组（主色 primary*、辅助 secondary*/tertiary*、中性 背景/表面/文字/描边、功能 success/warning/danger/其他），每组默认只展开主令牌，组头「+n」展开。S。

### G14 Tip 与输入框里的设计系统入口 —— S，web
- `Canvas.tsx` 左下角（避开右下控件）显示一行可关闭的 Tip，轮播 3 条：「双击屏幕放大」「选中屏幕后在左侧对话里描述修改，不用 @」「可以说『点 X 时打开下一屏』」；关闭后存 `localStorage['gg.art.tips']`。
- `ContextChips.tsx` 末尾加「设计系统」小按钮（带当前主色色点），点开画布的设计系统面板（经 `useCanvasContext` 的 `focus` 通道发事件）。

### G15 快捷键表补齐 —— S，web
- 按住 Z：按住时画布点击放大、⌥点击缩小（`Canvas.tsx` 记 `zoomHold`，光标 zoom-in/out）。
- 删掉「保存 ⌘S」（共工没有未保存态）；⌘⇧F 不做，不列。
- 表里加 ⌘K、⌘⇧C；「微移所选」按 G10 的结论改名。

### G16 Connect on state（多状态）—— 设计，暂不实现
- 现有原型一屏一状态。要支持就要在 manifest 屏幕下加 `states`（每个状态一份 HTML 或同文件内 `data-gg-state` 片段），连线加 `state`。涉及 L1 契约、kit 外壳、bridge、Agent 约定，L。建议先由「补全状态」生成的 `-empty / -loading / -error` 屏覆盖需求，等有真实诉求再立项。

### G17 导出「复制实现提示词」—— S，web
- ExportPanel 加格式「实现提示词」：拼一段给编码 Agent 的提示（产物目录 `design/<slug>/`、屏幕列表与 id、入口屏、跳转关系、DESIGN.md 要点（front matter 的颜色和字体）、「按这个原型在 <技术栈> 中实现」占位），按钮「复制」。对应 Stitch Export › MCP 的 Copy Prompt；共工的 Bot 已在工作区，不需要 MCP 配置。

### G18 项目菜单：重命名 / 复制 / 删除产物 —— M，server + web + 协议，无迁移
- 协议：`PATCH /api/artifacts/:id` `{ title }`（`ArtifactPatchReq`）；`POST /api/artifacts/:id/duplicate` → 新 ArtifactDto（复制 head 版本的文件引用为新产物 v1，`dir` 取 `design/<slug>-copy[-n]`，同群）。删除复用已有 `POST /archive`。
- 服务端：`routes.ts` 两个路由 + `service.ts`；复制要同时登记产物卡片消息（「已复制产物 …」群事件）；改名同步卡片标题。权限：群成员。
- web：`ArtifactTab.tsx` 左上格子图标改成 MenuButton：重命名（标题变行内输入，也支持双击标题）、创建副本、下载（.zip）、命令菜单 ⌘K、快捷键、删除产物（确认弹窗，说明「从群里移除，文件保留可恢复」）。
- 测试：服务端集成（改名、复制后新产物文件与 head 一致、archive 后列表不再出现）；web 单测（菜单项、行内改名提交）。

---

## 3. 建议本轮实现清单

按收益排序，P1 = 本轮做，P2 = 下一轮。★ = 需要协议改动（先改 `packages/protocol`，推送前确认）。都不需要数据库迁移。

### web（`apps/web`）
| 优先 | 项 | 工作量 |
|---|---|---|
| P1 | G02 右键标题给屏幕菜单 | S |
| P1 | G03 ⌘K 命令菜单 + 产物深链 | M |
| P1 | G06 DESIGN.md 节点 | S/M |
| P1 | G05 框选多选（⇧拖动） | M |
| P1 | G07 输入框 3x 变体开关 + `/` 产物命令（复用已有 commands） | M |
| P1 | G01 复制为代码、⌘C 写系统剪贴板、复制选区链接（不含 PNG） | S |
| P1 | G15 快捷键表补齐（按住 Z、删 ⌘S、加 ⌘K） | S |
| P1 | G13 色板按角色分组 | S |
| P1 | G17 导出「实现提示词」 | S |
| P2 | G14 Tip、输入框设计系统入口 | S |
| P2 | G10 方向键换位（待确认取舍） | S |
| P2 | G09 输入框「网址」芯片 | S |

### server + 插件（`apps/server`）
| 优先 | 项 | 工作量 |
|---|---|---|
| P1 | G11 指令消息正文精简（完整指令进 `artifactNote`，无协议改动部分） | S |
| P1 | G09 插件输入：粘贴 DESIGN.md、参考网站、参考仓库 + SKILL.md 规则 | S |
| P1 | G12 SKILL.md 要求用 progress_card 报阶段 | S |
| P1 | G13 设备输入 + 4 套新预设设计系统 | M |

### 跨端（★ 协议改动）
| 优先 | 项 | 工作量 |
|---|---|---|
| P1 ★ | G11 `MessageDto.canvas` + `RunDto.artifacts`：气泡显示上下文、运行卡片「在画布中查看」 | M |
| P1 ★ | G18 重命名 / 复制 / 删除产物（`PATCH /artifacts/:id`、`POST /duplicate`） | M |
| P2 ★ | G04 上传到画布（`ref` / `ref-delete` op、`ArtifactContext.refs`、上传类型扩展） | L |
| P2 ★ | G01 复制为 PNG（bridge `snapshot` 消息） | M |
| P2 ★ | G08 Mark 框选区域（bridge `mark-rect`） | M |
| P2 ★ | G09 `PluginInput.designSource`（创作单识别设计来源输入） | S |
| 暂缓 | G16 Connect on state | L |

建议拆分：web 一个子 agent（G02/G03/G05/G06/G07/G01 部分/G13 分组/G15/G17），server+插件一个子 agent（G11 精简、G09、G12、G13 预设与设备），协议项 G11/G18 由集成者先改协议再分给两边；G04 单独一轮。
