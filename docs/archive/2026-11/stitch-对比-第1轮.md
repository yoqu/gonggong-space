# Stitch × 共工原型编辑器 对比评审（第 1 轮）

日期：2026-10-30。范围：能力清单 §3 画布、§4 工具栏、§5 设计系统面板、§6 单屏编辑、§8 AI 输入/上下文、§9 快捷键/顶栏，外加深色、空态/加载/错误、键盘、缩放下浮层、面板遮挡专项。R5（原型编辑器、导出、分享）不在本轮。

证据：
- Stitch：`/tmp/stitch/*.png`（下文写文件名）。
- 共工：开发者 mock 截图 `/tmp/art-shots/`（r2-*、r3-*、r4-*）；本轮补拍 `/tmp/compare/r1/`（1440×900 和 1280×760，左侧带 380px 群聊栏，light/dark 各一套）。补拍脚本在 `/tmp/compare/scripts/`（`shoot.mjs`、`probe.mjs`）。
- 约束：视觉只用共工设计系统，不追 Stitch 的配色和字体；信息架构、布局位置、交互路径、反馈状态要对齐。

状态：一致 / 交互不一致 / 缺失 / 共工更好。优先级：P0 能力缺失或明显不可用，P1 交互不一致，P2 视觉细节或可延后的缺口。

## 总览

| 编号 | 模块 | 状态 | 优先级 | 一句话差距 |
|---|---|---|---|---|
| C01 | 画布·平移缩放 | 一致 | P2 | 滚轮平移、⌘/捏合缩放、Space、H 都有；只差按住 Z 缩放 |
| C02 | 画布·低缩放显示 | 交互不一致 | P2 | 缩到 9% 时点阵糊成灰色，节点标题互相压字 |
| C03 | 画布·生成后定位 | 缺失 | P2 | 只在首次进入时适应画布，新一版加了屏也不会自动缩放到新节点 |
| C04 | 画布·节点类型 | 缺失 | P2 | 没有 DESIGN.md 节点（Stitch 有 📄 DESIGN.md 节点） |
| C05 | 画布·选中屏幕 | 一致 / 共工更好 | — | 描边、四角手柄、尺寸徽标、浮动四菜单一致；多 Bot 时多一个 @Bot 选择 |
| C06 | 画布·浮动工具条被面板遮挡 | 交互不一致 | **P0** | 窄窗口打开任一右侧面板后，「预览」「更多」被面板盖住，点不到 |
| C07 | 画布·右键菜单 | 一致 | P2 | 分组和快捷键一致；缺「复制为 ›」（代码/PNG/链接） |
| C08 | 画布·多选 | 交互不一致 | P2 | 只有 ⇧ 点选和 ⌘A，没有框选 |
| C09 | 画布·移动节点 | 交互不一致 | P2 | 抓手柄只能横向重排顺序，不能自由摆放（manifest 驱动，可接受） |
| T01 | 工具栏·组成与快捷键 | 一致 / 共工更好 | — | V/M/E/H/上传/设计系统/收藏一致，另加「批注」入口 |
| T02 | 工具栏·激活按钮悬停时图标消失 | 交互不一致 | **P1** | 打开面板后鼠标停在按钮上，浅色下图标变成白底白图标，看起来像被面板盖住 |
| T03 | 工具栏·提示位置 | 交互不一致 | **P1** | 竖向工具栏的提示弹在上方，盖住上一个按钮；Stitch 弹在左侧 |
| T04 | 工具栏·上传到画布 | 缺失 | P2 | 按钮置灰「即将支持」 |
| T05 | 工具栏·Mark | 交互不一致 / 共工更好 | P2 | Stitch 框选区域，共工点选元素；共工多了批注列表、状态和发给 AI |
| T06 | Direct Edit 浮层·动作 | 共工更好 | — | 除了改字、用 AI 修改、删除，还有连到新屏和属性 |
| T07 | Direct Edit 浮层·缩放平移后定位 | 交互不一致 | **P1** | 元素移出视口后浮层仍钉在画布顶部，盖住浮动工具条 |
| T08 | Direct Edit 浮层·引线 | 缺失 | P2 | Stitch 从元素框拉一条线到浮层，共工没有 |
| T09 | Direct Edit 浮层·透底 | 交互不一致 | P2 | 玻璃底透出下面卡片的颜色（橙色色块晕进标题区） |
| D01 | 设计系统·入口 | 一致 | P2 | 工具栏、修改›设计系统、双击设计系统节点、详情都能进；输入框里没有设计系统按钮（见 A05） |
| D02 | 设计系统·面板头 | 一致 | — | 名称输入加预设；一个产物只有一个设计系统，不需要 ‹ 返回列表 |
| D03 | 设计系统·模式 | 共工更好 | — | 浅色/深色切换，并标出「推导」 |
| D04 | 设计系统·种子色 | 交互不一致 | **P1** | 改了种子色还要再点「应用种子色」才生效；Stitch 选色即生效 |
| D05 | 设计系统·配色方案 | 缺失 | P2 | 没有 Fidelity/Tonal Spot/Vibrant… 这类方案选择 |
| D06 | 设计系统·色板 | 交互不一致 | P2 | 16 个以上令牌平铺，很长；Stitch 按 Primary/Secondary/Tertiary/Neutral 四个角色组织 |
| D07 | 设计系统·字体 | 共工更好 | — | 字体族之外还能调每档的字号、字重、行高 |
| D08 | 设计系统·保存 | 一致 | — | 「保存」对应 Save，「保存并让 AI 统一」对应 Save & Apply |
| D09 | 设计系统·DESIGN.md 标签页 | 一致 | — | 可以编辑原文 |
| E01 | 单屏·查看详情 | 交互不一致 | **P1** | 缩略图用的是整个版本的缩略图，不是这一屏的（没有版本缩略图时只显示手机图标）；「设计系统」一栏显示 tokens.css 而不是设计系统名 |
| E02 | 单屏·查看代码 | 一致 | — | 弹窗加复制 |
| E03 | 单屏·预览/尺寸 | 一致 | P2 | 手机/平板/桌面/全高、新标签页一致；二维码置灰 |
| E04 | 单屏·变体 | 一致 | — | 按维度的子菜单加「自定义…」弹窗 |
| E05 | 单屏·重命名/副本/收藏/下载/重载 | 一致 | — | |
| E06 | 单屏·元素属性面板 | 共工更好 | P2 | Stitch 没有这个面板；共工的面板底部有一截空玻璃（底栏没贴底） |
| A01 | AI·选中即上下文 | 一致 | — | 选中屏幕或元素后，输入框上方出现可移除的芯片，⌘L 固定 |
| A02 | AI·带上下文发消息不触发 Bot | 交互不一致 | **P0** | 选中屏幕后直接输入「标题再大点」，因为没 @，Bot 不会响应；Stitch 的核心回路就是选中→输入→AI 改 |
| A03 | AI·输入框位置 | 交互不一致（取舍） | P2 | 共工复用左侧群聊输入框，不在画布底部；没有 Stitch 那样的 Tip 轮播 |
| A04 | AI·/ 命令产物类型 | 缺失 | P2 | 群聊里的 / 是群命令，没有 Image/Logo/Diagram 这些产物类型（Generate 菜单里已有大部分） |
| A05 | AI·输入框 3x 变体开关和设计系统选择 | 缺失 | P2 | 只能从菜单进变体 |
| A06 | AI·生成中反馈 | 交互不一致 | P2 | 共工整张画布只读，顶部一条「AI 正在修改」；Stitch 节点流式出现，输入框有流光 |
| K01 | 快捷键·列表 | 一致 | P2 | 分组一致；⌘S、按住 Z、微移、对齐、⌘⇧F、复制为 PNG 标为即将支持 |
| K02 | 快捷键·方向键语义 | 交互不一致 | P2 | Stitch 方向键微移所选；共工方向键平移视图（没有自由坐标，可接受，但快捷键表要写清） |
| K03 | 键盘·Tab 聚焦让画布错位 | 交互不一致 | **P1** | Tab 到屏外节点的标题时，浏览器把 `.art-plane` 横向滚了 491px，之后适应画布、缩放的计算都偏了 |
| K04 | 键盘·屏幕内元素 | 缺失 | P2 | iframe 是 `tabIndex=-1`，直接编辑和标记只能用鼠标 |
| K05 | 顶栏·项目菜单 | 缺失 | P2 | Stitch 左上汉堡菜单（返回、复制、下载、删除、帮助、⌘K）；共工左上的格子图标不能点，产物标题也不能重命名 |
| K06 | 顶栏·右下 ? | 交互不一致 | P2 | Stitch 的 ? 是帮助菜单（文档、快捷键、外观），共工直接打开快捷键；可以接受 |
| K07 | 右下·撤销/重做/缩放菜单 | 一致 | — | 菜单项和快捷键一致 |
| S01 | 专项·深色下侧栏透底 | 交互不一致 | **P1** | 详情、收藏、批注面板是玻璃底，压在白色屏幕上时变成发灰的糊块，文字对比度下降 |
| S02 | 专项·右下角控件压在侧栏上 | 交互不一致 | **P1** | 只有设计系统面板留了底部空间；详情、收藏、批注、元素面板的底部都被撤销/缩放条盖住 |
| S03 | 专项·空态/加载/错误 | 一致 | P2 | 生成前有骨架屏、没设计系统和没收藏有空态；预览失败的空态没有「重试」，单屏 iframe 加载失败没有错误态 |

统计：P0 2 项（C06、A02），P1 8 项（T02、T03、T07、D04、E01、K03、S01、S02），其余是 P2、一致或共工更好。

---

## 详述

### §3 画布

**C01 平移缩放：一致（P2）**
- 证据：Stitch `81-zoom-menu.png`；共工 `/tmp/compare/r1/light-01-default.png`，代码 `Canvas.tsx` 的 wheel/keyDown。
- 差距：没有按住 Z 缩放（快捷键表里已标「即将支持」）。可以放到后面做。

**C02 低缩放显示：交互不一致（P2）**
- 证据：`/tmp/compare/r1/light-10-edit-pop-zoomed-out.png`（9%）：点阵变成灰色网纹，「书籍详情」和「原型 · 阅…」两个标题叠在一起。
- 改法：`Canvas.tsx` 的 plane `backgroundSize` 在 `z < 0.5` 时间距乘 2（或乘 4），保持点的密度；标题 `maxWidth` 从 `Math.max(r.width, 80)` 改成 `r.width`，`z < 0.15` 时只显示图标。

**C03 生成后定位：缺失（P2）**
- 证据：Stitch 能力清单 §3「生成完成后自动缩放到能看到新节点」；共工 `fitted` 只置一次。
- 改法：`Canvas.tsx` 在 `versionKey` 变化时，把新出现的节点 id 拿出来做 `fitTo(newIds)`；用户在这期间手动平移缩放过就不动视图。

**C04 DESIGN.md 节点：缺失（P2）**
- 证据：Stitch `94-designmd-list.png`、能力清单 §3 节点类型。
- 改法：产物里有 DESIGN.md 时，`geometry.layoutNodes` 在设计系统节点后加一个 doc 节点，渲染成只读 markdown，双击打开设计系统面板的 DESIGN.md 标签页。

**C05 选中屏幕：一致 / 共工更好**
- 证据：Stitch `55-screen-selected.png`；共工 `/tmp/art-shots/r2-light.png`、`/tmp/compare/r1/light-02-selected.png`。

**C06 浮动工具条被右侧面板遮挡：P0**
- 证据：`/tmp/compare/r1/light-07-narrow-ds-panel.png`（1280 宽、带聊天栏）：设计系统面板盖住了「预览」后半和「更多」；`dark-08-narrow-annotations.png` 同样。Stitch `89-tool-designmd.png`：工具条在顶栏这一行居中，面板从工具条下方开始，两者不重叠。
- 原因：`.art-float` 以整个画布宽度的 50% 居中，`.art-panel` 和它同为 `z-index: 2`，DOM 顺序在后，所以面板盖在上面。
- 改法：
  1. `Canvas.tsx`：有面板时给根节点设 CSS 变量 `--art-side`（普通面板 300+60，`--wide` 360+60，否则 0）。
  2. `artifacts.css`：`.art-float { left: calc((100% - var(--art-side, 0px)) / 2); max-width: calc(100% - var(--art-side, 0px) - 24px); }`。
  3. 空间不够时（ResizeObserver 量 room），FloatMenu 只显示图标，文字放进 tooltip。

**C07 右键菜单：一致（P2）**
- 证据：Stitch `83-context-menu.png`、`84-ctx-copy-as.png`；共工 `/tmp/art-shots/r2-light-context.png`、`/tmp/compare/r1/dark-03-context.png`。
- 差距：缺「复制为 ›」（复制代码、复制为 PNG ⌘⇧C、复制选区链接）。「复制代码」可以直接复用 `readFile`，先做这一项，PNG 等导出（R5）时再做。

**C08 框选：P2**。在空白处拖动时如果按着 ⇧（或者用 Select 工具从空白处拖），画一个框选矩形，选中和它相交的节点；现在空白处拖动是平移。

**C09 移动节点：P2，可接受**。共工的屏幕顺序由 manifest 决定，所以只能横向重排。不改。

### §4 工具栏

**T01 组成：一致 / 共工更好**
- 证据：Stitch `crop/tools.png`；共工 `/tmp/art-shots/r4-light.png` 右侧。

**T02 激活按钮悬停时图标消失：P1**
- 证据：`/tmp/compare/r1/r4-light-tools-crop.png`（从 `/tmp/art-shots/r4-light.png` 裁出）：设计系统面板打开时，调色板按钮成了浅灰底、白图标，几乎看不见；`light-07-narrow-ds-panel.png` 同样。这很可能就是「R4 面板盖住工具栏」的观感来源：在默认布局下，面板（`right: 60px`）和工具栏（`right: 12px`，宽 38px）在几何上并不重叠。
- 原因：`artifacts.css` 里 `.art-tools__btn:hover:not(:disabled)`（特异性 0,3,0）压过了 `.art-tools__btn[aria-pressed="true"]`（0,2,0），背景变成 `--selection-fill`，图标颜色仍是 `--on-accent`（白色）。
- 改法：hover 规则改成 `.art-tools__btn:hover:not(:disabled):not([aria-pressed="true"])`；激活态的 hover 用稍深一点的 accent。

**T03 提示位置：P1**
- 证据：Stitch `crop/tools.png`：「Select - V」显示在按钮左侧。共工 `light-07`（「设计系统」提示盖住了上传按钮）、`dark-05-favourites-empty.png`（「收藏」提示盖住了上一个按钮）。
- 改法：`ui/Tooltip.tsx` 的 `placement` 增加 `'left'`（`ui-tip--left`，属于共享组件新增选项，不影响已有调用方）；`Canvas.tsx` 的 `ToolButton` 改用 `placement="left"`。

**T04 上传到画布：缺失（P2）**。后续切片再做。

**T05 Mark：交互不一致 / 共工更好（P2）**
- 证据：Stitch `91-tool-mark.png`（框选图标、区域标记）；共工 `/tmp/art-shots/r3-mark-light.png`（点选元素，加编号气泡和批注列表）。
- 建议：保留点选元素；补一个在屏幕上拖框的方式，生成不带 ggId、只带 rect 的批注。协议里 `rect` 已经有了。

**T06 Direct Edit 动作：共工更好**
- 证据：Stitch `88-direct-edit-element.png`（3 个动作）；共工 `/tmp/art-shots/r3-edit-light.png`（5 个动作）。

**T07 浮层在缩放平移后的定位：P1**
- 证据：`/tmp/compare/r1/light-11-edit-pop-panned-away.png`：元素已经平移到视口外，「编辑元素」浮层仍钉在画布顶部，盖住浮动工具条（`.art-pop` 是 `z-index: 3`）。`light-10`（9%）里浮层很大，被选元素却很小，可以接受。
- 改法：
  - `ElementPopover.tsx` 的 `besideBox`：元素 box 和 room 不相交时返回 null，`Floating` 不渲染（元素回到视口内再出现）。
  - 上边界不小于浮动工具条底部（约 56px）。
  - 右边避让量从固定的 `TOOLS = 64` 改成「工具栏 + 当前面板宽度」（由 Canvas 传入，和 C06 用同一个值）。

**T08 引线：P2**。在 `.art-overlay` 里画一条 1px 的 accent 线，从元素框右边中点连到浮层左上。

**T09 浮层透底：P2**
- 证据：`/tmp/compare/r1/light-09-edit-pop.png`：浮层标题区透出下面设计系统卡的橙色。
- 改法：`.art-pop` 的背景改成 `var(--content-bg)`，和 `.art-dsp` 一样（理由同 S01）。

### §5 设计系统面板

**D01–D03、D07–D09：一致 / 共工更好**
- 证据：Stitch `89-tool-designmd.png`、`92-theme-color-theme.png`；共工 `/tmp/art-shots/r4-light.png`、`r4-dark.png`、`r4-*-designmd.png`。深色模式下可读性良好（这个面板已经是不透明底）。

**D04 种子色要再点一次才生效：P1**
- 证据：共工 `r4-light.png`：种子色输入框 + 「应用种子色」按钮；Stitch `89`：Seed Color 下拉选色后，色板立即更新。
- 改法：`DesignSystemPanel.tsx` 取色器 onChange 或 hex 输入合法时，立即推导 primary 系列和中性色，写进草稿；删掉「应用种子色」按钮。如果已经手动改过某个令牌，需要提示它会被覆盖，可以在推导后给一个「撤销推导」的 toast，或者只覆盖仍等于上一次推导值的令牌。

**D05 配色方案：缺失（P2）**。在种子色下面放一个分段控件或下拉：忠实、柔和、鲜艳、表现力，用于切换推导算法（`palette.ts`）。

**D06 色板太长：P2**
- 证据：`r4-light.png` 右侧平铺了 16 行以上令牌；Stitch 是 4 个角色。
- 改法：按角色分组（主色、辅助、中性、功能/其他），每组默认只展开主令牌，组标题显示「+n」可以展开；数据结构不变。

### §6 单屏编辑

**E01 查看详情：P1**
- 证据：Stitch `60-view-details.png`（这一屏的缩略图、DESIGN.md 显示名称、Design Prompt）；共工 `/tmp/compare/r1/dark-06-details.png`：缩略图区只有一个手机图标，「设计系统」显示 tokens.css。
- 原因：`ArtifactTab` 传入的 `thumbnailUrl` 是 `current?.thumbnailUrl`，也就是整个版本的缩略图，所以每一屏的详情都显示同一张图，或者什么都不显示。
- 改法：`SidePanel.tsx` 的 `DetailsPanel` 缩略图换成这一屏的缩小 iframe（复用 `src(n)`，`pointer-events: none`，按宽度缩放，只显示首屏），不再接收版本的 thumbnailUrl；「设计系统」一栏显示 `tokens?.name ?? t('设计系统')`。

**E02–E05：一致**。证据：Stitch `57/58/59-sel-*.png`、`61-view-code.png`、`86-ctx-variations.png`；共工 `r2-light-context.png`。

**E06 元素属性面板：共工更好（P2）**
- 证据：`/tmp/art-shots/r3-props-dark.png`：表单和保存栏下面还有一大截空玻璃。
- 改法：`.art-panel__body` 用 flex，保存栏 `margin-top: auto` 贴底；或者面板高度跟着内容走，加 `max-height`。和 S01 一起改。

### §8 AI 输入与上下文

**A01 选中即上下文：一致**
- 证据：Stitch `55-screen-selected.png` 底部芯片；共工 `r3-chips-*.png`、`light-02-selected.png` 左下芯片。

**A02 带上下文发消息不触发 Bot：P0**
- 证据：共工所有带芯片的截图，输入框底部都提示「未 @ 的消息不会触发 Bot」；服务端 `apps/server/src/modules/messages/routes.ts` 里 `mentions` 只取显式 @（私聊里只有一个 Bot 的情况除外）；`artifactContext` 只会被附加成 note。Stitch 选中后直接输入，AI 就会改选中的内容。
- 改法：
  - 服务端 `messages/routes.ts`：有 `canvas`、没有显式 @、也不是命令或追加时，`mentions = [产物默认 Bot]`。`canvasContext()` 顺带返回 botId，取法和 web 的 `useArtifactBot` 一致：最近一次 run 的 Bot，没有就用群里唯一的 Bot；有多个 Bot 又不能确定时，维持现状。
  - web `MessageComposer.tsx`：有画布芯片时，把底部提示换成「发给 @{bot}」（可点击换 Bot，复用 `useArtifactBot` 的 pick），让用户在发送前看到会交给谁。
  - 测试：服务端集成测试覆盖「带 artifactContext、没有 @ → 触发产物 Bot」；web 测试覆盖提示文案。

**A03 输入框位置：取舍，P2**。不搬输入框。在画布的空态和第一次选中时，在左下角显示一行提示：「双击屏幕放大，选中后在左侧对话里描述修改」。

**A04、A05：P2**。变体的「3x」可以做成输入框芯片区的开关（有画布上下文时才显示），发送时带 `variations: 3`。

**A06 生成中反馈：P2**。现在 AI 运行时整张画布只读、顶部一条横幅（见 `ArtifactTab.tsx` 的 `art-running`）。后续可以让新屏边生成边显示（R5 之后再说）。

### §9 快捷键与顶栏

**K01 快捷键列表：一致（P2）**
- 证据：Stitch `12-shortcut-keys.png`；共工 `/tmp/compare/r1/dark-04b-shortcuts.png`，`menus.ts` 的 `SHORTCUTS`。

**K02 方向键语义：P2**。快捷键表里把「移动视图」写清楚，避免以为是微移。

**K03 Tab 聚焦让画布错位：P1**
- 证据：`/tmp/compare/r1/dark-12-tab-focus.png`（整张画布左移，设计系统卡被切掉）；`probe.mjs` 输出：Tab 到「原型 · 阅境读书会」标题时，`art-plane scrollLeft` 从 0 变成 491，之后一直不复位。
- 原因：`.art-plane` 是 `overflow: hidden`，仍然可以被程序滚动，浏览器把聚焦的元素滚进可视区。
- 改法：
  - `artifacts.css`：`.art-plane`、`.art-canvas` 改成 `overflow: clip`。
  - `Canvas.tsx`：`art-title__name` 按钮 `onFocus` 时，如果节点不在视口内，就把视图平移到这个节点（不改缩放）。键盘用户用 Tab 走屏时，画布跟着走，等于补上了键盘可达。

**K04 屏幕内元素键盘不可达：P2**。选中屏幕后按 Enter，向 iframe 发送 `mode: edit` 并聚焦第一个可编辑元素，桥里用 Tab/方向键在元素间移动，Enter 打开浮层。需要改 bridge 协议，放后面。

**K05 项目菜单：P2**。`ArtifactTab.tsx` 左上的格子图标改成 MenuButton：重命名产物、下载全部、快捷键、删除产物（服务端还不支持的先置灰）；标题双击可以重命名。

**K06、K07**：见总览。

### 专项

**S01 深色下侧栏透底：P1**
- 证据：`/tmp/compare/r1/dark-06-details.png`、`dark-05-favourites-empty.png`、`dark-08-narrow-annotations.png`、`/tmp/art-shots/r3-mark-light.png`（浅色下批注面板同样透出屏幕的棕色）。玻璃底压在白色屏幕上，变成灰色糊块，次要文字对比度明显下降。设计系统面板已经因为同样的原因改成了不透明（`.art-panel.art-dsp` 的注释）。
- 改法：`artifacts.css` 的 `.art-panel` 统一改成 `background: var(--content-bg)`，保留阴影，去掉 backdrop-filter；删掉 `.art-dsp` 里单独的覆盖。右键菜单 `.art-ctx` 暂时不动（P2，透底不影响阅读）。

**S02 右下角控件压在侧栏底部：P1**
- 证据：`dark-06-details.png`、`dark-05`、`dark-08`、`/tmp/art-shots/r3-props-dark.png`：「66% / 55%」那条控件压在面板右下角。
- 改法：`.art-panel` 的 `bottom` 统一改成 64px（现在只有 `--wide` 是这样）。另一个做法是面板打开时，`.art-corner` 的 `right` 加上面板宽度；前者更简单。

**S03 空态、加载、错误：一致（P2）**
- 生成前的骨架屏、没设计系统、没收藏都有空态。
- 缺：`ArtifactTab.tsx` 预览失败的 `EmptyState` 没有「重试」按钮（对照「产物已删除」的空态是有的）；单屏 iframe 加载 404 时显示浏览器自带的错误页，应该在节点上显示「这屏打不开 · 重新加载」（用 bridge 的 `ready` 超时判断）。

---

## 本轮必须修的 P0/P1 清单（按改动文件分组）

### A. `apps/web/src/features/artifacts/artifacts.css`（单个开发者，纯样式）
- [ ] T02：`.art-tools__btn` 的 hover 规则排除 `[aria-pressed="true"]`；激活态 hover 用 accent 的加深色。
- [ ] S01：`.art-panel` 背景改成不透明的 `--content-bg`，去掉 backdrop-filter，删掉 `.art-dsp` 的单独覆盖；顺带让 `.art-panel__body` 用 flex，底栏贴底（E06）。
- [ ] S02：`.art-panel` 的 `bottom` 统一为 64px。
- [ ] K03：`.art-plane`、`.art-canvas` 改成 `overflow: clip`。
- [ ] C06（样式部分）：`.art-float` 按 `--art-side` 居中并限制 max-width。

### B. `apps/web/src/features/artifacts/Canvas.tsx` + `ElementPopover.tsx` + `apps/web/src/ui/Tooltip.tsx`
- [ ] C06：按当前面板设置 `--art-side`（0 / 360 / 420），空间不够时 FloatMenu 只显示图标。
- [ ] T03：`Tooltip` 增加 `placement: 'left'`（共享组件，只新增选项；检查 desktop 的用法不受影响）；`ToolButton` 改用 left。
- [ ] T07：`besideBox` 在元素出视口时返回 null，上边界避开浮动工具条，右边避让量 = 工具栏宽度 + `--art-side`（由 Canvas 传入）。
- [ ] K03：标题按钮 `onFocus` 时把视图平移到这个节点。
- 测试：Canvas 单测补「打开面板后浮动工具条的 left 偏移」「元素出视口时浮层不渲染」「标题聚焦时视图平移到该节点」。

### C. `apps/web/src/features/artifacts/SidePanel.tsx`（+ `Canvas.tsx` 传参）
- [ ] E01：详情缩略图改成这一屏的缩小 iframe，不再用版本的 thumbnailUrl；「设计系统」一栏显示设计系统名。

### D. `apps/web/src/features/artifacts/DesignSystemPanel.tsx`（+ `palette.ts`）
- [ ] D04：种子色改了就推导，删掉「应用种子色」；手动改过的令牌不被覆盖，或者推导后给撤销 toast。补单测。

### E. 跨端：`apps/server/src/modules/messages/routes.ts`（+ `artifacts/commands.ts`）与 `apps/web/src/features/chat/MessageComposer.tsx`
- [ ] A02：带 `artifactContext`、没有显式 @ 时，默认提及产物 Bot（取法和 `useArtifactBot` 一致，有歧义时维持现状）；输入框提示改成「发给 @{bot}」，可以切换 Bot。
- 先写服务端集成测试（`createTestDb` + 种子助手），再改 web。不涉及数据库迁移。改的是群聊发消息的路由，推送前按约定确认。

P2 不进本轮，留给第 2 轮：C02、C03、C04、C07、C08、T04、T05、T08、T09、D05、D06、E03 二维码、A03–A06、K02、K04、K05、S03。
