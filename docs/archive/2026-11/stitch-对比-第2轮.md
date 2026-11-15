# Stitch × 共工原型编辑器 对比评审（第 2 轮）

日期：2026-10-30。范围：第 1 轮全部条目复查，加上 R5（原型编辑器、导出、分享、二维码），重点在真实环境里验证。

证据：
- Stitch：`/tmp/stitch/*.png`（沿用第 1 轮截图，本轮没有补拍）。
- 共工真实环境：e2e 起的 server + web(vite) + daemon + mock agent，群里 1 个 Bot，产物用 app-screens 示例加 9 个克隆屏，共 12 屏，带 DESIGN.md。截图在 `/tmp/compare/r2/real/`（`light-*` / `dark-*`，1440×900，左侧带群聊栏；`light-30` 是 1280×760）。驱动脚本 `/tmp/compare/scripts/real.mjs`、`probe*.mjs`，日志 `/tmp/compare/r2/real-{light,dark}.log`、`server.log`。
- 约束同第 1 轮：视觉用共工设计系统；信息架构、布局、交互路径、反馈状态对齐 Stitch。

状态：一致 / 交互不一致 / 缺失 / 共工更好。优先级：P0 真实环境 bug（与 mock 不一致、接口报错、控制台报错）或明显不可用；P1 交互不一致；P2 视觉细节或可延后。

## 第 1 轮 P0/P1 复查（真实环境）

| 编号 | 结论 | 证据 |
|---|---|---|
| C06 工具条被面板遮挡 | 已修 | `light-30-narrow-ds`：1280 宽打开设计系统面板，工具条在剩余空间居中，只显示图标 |
| T02 激活按钮悬停图标消失 | 已修 | `light-08-design-system`：调色板按钮激活且悬停，图标可见 |
| T03 提示位置 | 已修 | `light-07`、`light-08`：提示在按钮左侧 |
| T07 浮层出视口 | 未在真实环境复测 | mock 已覆盖 |
| D04 种子色即时生效 | 已修 | `light-08`：没有「应用种子色」，并提示「手动改过的颜色保持不变」 |
| E01 详情缩略图 | 已修 | `light-19-details`、`dark-19`：显示这一屏的缩略图，设计系统一栏显示名称 |
| K03 Tab 聚焦错位 | 未在真实环境复测 | — |
| S01 侧栏透底 | 已修 | `dark-19`、`dark-05-props`：面板为不透明底 |
| S02 右下控件压侧栏 | 已修 | `light-07`：面板底部在缩放条上方结束 |
| A02 选中后不 @ 不触发 Bot | 已修 | `light-02-selected`：提示「发给 @原型师」；`light-17-running`：不带 @ 的消息标「发给 @原型师」，Bot 开始运行 |

## 总览（本轮新发现与 R5）

| 编号 | 模块 | 状态 | 优先级 | 一句话差距 |
|---|---|---|---|---|
| R01 | 真实·控制台 | 交互不一致 | **P0** | 每次打开画布或切换工具，都会刷出 12 条以上 `postMessage` origin 不匹配警告（mock 同源，所以看不到） |
| R02 | 真实·首次适应画布 | 交互不一致 | **P0** | 首次进入时适应画布没有算进原型节点和右侧工具栏，最右边的节点被工具栏盖住；按 ⇧1 后才正常 |
| R03 | 真实·Esc 关菜单顺带取消选中 | 交互不一致 | **P1** | 浮动工具条或右键菜单打开时按 Esc，菜单关了，选中也被清掉，工具条随之消失 |
| R04 | 真实·Bot 离线时无提示 | 缺失 | **P1** | Bot 离线时，菜单仍然可点，提示「已交给 @原型师」、「发给 @原型师」；消息只在群聊里排队「离线等待」，画布上没有任何状态 |
| R05 | 真实·新版本后批注「消失」 | 交互不一致 | **P1** | 批注按版本隔离。出了新版本（包括 daemon 自动上传的「本机改动」）后，批注面板显示「还没有批注」，看不出 v1 上还有 2 条未处理 |
| R06 | 真实·12 屏低缩放 | 交互不一致 | **P1** | 12 屏横排一行，适应画布后只有 11–13%，节点标题互相压字（即第 1 轮的 C02，真实数据下影响变大） |
| R07 | 真实·性能 | 一致 | — | 12 屏、12 个 iframe、约 1.2k 个 DOM 节点；平移、缩放 60fps，最差帧 17ms（只有第一次缩放出现过一帧 67ms）；从点「打开」到首屏 iframe 就绪约 1.1s |
| R08 | 真实·运行中只读 | 一致 | — | 顶部「AI 正在修改 · 完成前画布只读」；更多›删除、直接编辑、设计系统面板都置灰，并说明原因 |
| R09 | 真实·版本切换一致性 | 一致 | — | 查看 v1 时，画布内容、设计系统面板（只读）、顶部条都跟着 v1；「回到当前版本」后恢复为 v2 |
| R10 | 真实·Bot 离线打开 | 一致 | — | 机器离线时画布照常打开（服务端托管） |
| R11 | 真实·本机改动版本没有缩略图 | 交互不一致 | P2 | v2（本机改动）的群聊卡片只显示格子占位图 |
| R12 | 真实·⇧P 新标签页 | 交互不一致 | P2 | 打开的是裸屏幕文件，按 1280 宽铺满，没有设备框；原型编辑器里的「新标签页打开」走的是外壳 `#play:` |
| R13 | 真实·预览尺寸文案 | 交互不一致 | P2 | 小程序设备宽 375，预览菜单仍写「手机 390×884」 |
| R14 | 真实·画布焦点框 | 交互不一致 | P2 | 画布获得焦点后，聊天栏和画布交界处出现一条蓝色竖线（焦点框只露出左边） |
| R15 | 真实·分享页 | 共工更好 | P2 | 分享链接打开后有「画布 / 演示」两种视图，`#play:event` 能直接进入；控制台有 1 条 404（没定位，疑似 favicon） |
| P01 | 原型·编辑器布局 | 一致 | — | 返回、预览/编辑切换、左侧屏幕列表、中间设备框、右侧工具条、首次引导，对应 Stitch `70`、`79` |
| P02 | 原型·预览跳转 | 一致 | — | 真实环境点「活动卡」后跳到 event（`light-12b`） |
| P03 | 原型·已连接标记 | 共工更好 | — | 除了「已连接」，返回按钮还标「返回」（`light-13`） |
| P04 | 原型·元素浮层 | 一致 | — | 连到屏幕、编辑文字、用 AI 修改、构想新屏，和 Stitch 一样（`light-14`） |
| P05 | 原型·连接面板 | 交互不一致 | P2 | 没有「Connect on state / + Add State」；按 Esc 关不掉面板（`light-15`，日志 `connect panel after Esc visible true`） |
| P06 | 原型·添加屏幕 | 交互不一致（取舍） | P2 | Stitch 是「Add existing screen / Create with AI」，共工是「用 AI 新建屏 / 复制当前屏」。所有屏都已在原型里，可以接受 |
| P07 | 原型·铅笔改整屏 | 交互不一致 | P2 | 输入条压在设备框底部，右侧还被连接面板盖住一截（`light-16`）；Stitch 会把设备框上移让位（`78`） |
| P08 | 原型·右侧工具条 | 一致 | P2 | 设备、重载、热点、二维码、新标签页都有；没有 Stitch 的 •• Agent 入口（共工的对话在左侧，属于取舍） |
| X01 | 导出·面板 | 交互不一致 / 共工更好 | P2 | 4 种格式（.zip、复制代码、项目简报、分享链接），Stitch 有 8 种；没选屏幕时导出整个产物（比 Stitch 的空态好）。真实环境下 zip 下载 200，41KB。选中 1 屏时顶部写「所选的 1 个屏幕」，但 .zip 仍然导出整个版本，容易误解 |
| X02 | 分享·弹窗 | 一致 | — | 开关、说明、复制链接对应 Stitch `66`；真实环境开、关都正常（`light-31`） |
| X03 | 二维码 | 一致 | — | 第 1 轮 E03 置灰的问题已修；真实环境能出码，显示到期日（`light-32`） |

第 1 轮的 P2 遗留，本轮核对后仍未做：C02（并入 R06）、C03（并入 R02）、C04 DESIGN.md 节点、C07 复制为›、C08 框选、T04 上传、T05 区域标记、T08 引线、D05 配色方案、D06 色板分组、A03 Tip、A04 / 命令、A05 3x 开关、A06 流式生成、K02、K04、K05 项目菜单与重命名、S03 预览失败重试与单屏加载失败态。这些保持 P2，不进本轮。

统计：P0 2 项（R01、R02），P1 4 项（R03、R04、R05、R06），其余是 P2、一致或共工更好。

---

## 详述

### R01 postMessage origin 警告：P0
- 证据：`real-light.log` 有 89 条，`real-dark.log` 有 38 条：`Failed to execute 'postMessage' on 'DOMWindow': The target origin provided ('http://127.0.0.1:41055') does not match the recipient window's origin ('http://127.0.0.1:5198')`。打开画布时集中出现，切换工具时也会出现。
- 原因：`Canvas.tsx` 挂载或切换工具时，把 `mode`、`highlight` 广播给所有 iframe（`postToScreen`，约第 344、361 行）。这时 iframe 还是 about:blank，origin 和父页面相同，不是预览 origin，浏览器就报警告，消息也被丢掉。之后靠 `ready` 消息（第 326 行）补发 mode，所以功能没坏，但控制台很吵。mock 环境同源，所以没出现。
- 改法：`bridge.ts` 或 `Canvas.tsx` 记录已经发过 `ready` 的文件集合，`postToScreen` 只发给 ready 过的 frame；没 ready 的等 `ready` 时再补发（第 326 行已经这样做）。`PrototypeEditor.tsx` 同样处理。补一个单测：iframe 没 ready 时不调用 `postMessage`。

### R02 首次适应画布漏掉节点：P0
- 证据：`light-01-canvas`、`dark-01`：最右边的原型节点在工具栏下面露出一截黑条（`elementsFromPoint(1436,500)` 命中 `.art-node--prototype`）；按 ⇧1 后的 `light-01b` 正常。
- 原因：`Canvas.tsx` 的「Fit once the plane has a size」在 `room` 第一次有值时就执行，只执行一次。这时 tokens（设计系统节点高度）和各屏内容高度还没回来，之后布局变宽、变高，不会再适应。`fitView` 也没有扣掉右侧工具栏（约 60px）。
- 改法：
  - `fitted` 改成「用户还没手动平移缩放」：在 `nodes` 的整体外接框变化时重新 fit；用户一旦平移、缩放或选中节点，就不再自动 fit。这样第 1 轮的 C03（生成后定位到新节点）也一起解决了。
  - `fitView` 的可用宽度减去工具栏宽度，打开面板时再减去 `side`。
  - 单测：先给不含原型节点的布局，再追加节点，期望视图重新 fit；用户手动缩放后再追加，视图保持不动。

### R03 Esc 关菜单顺带取消选中：P1
- 证据：日志 `float after Esc on open menu 0`：点开「生成」菜单后按 Esc，`.art-float` 消失；`probe4` 复现。Stitch 的 Esc 只关菜单。
- 原因：鼠标打开菜单时，焦点留在触发按钮上，按钮在画布 DOM 内。keydown 先冒泡到 `Canvas.tsx` 的 `keyDown`，执行了 `setSelected([])`；菜单的 `useEscape` 是 document 监听，也把菜单关了。
- 改法：`Canvas.tsx` 的 `keyDown` 在处理 Escape 前，先检查有没有打开的浮层（`ui/overlay` 导出 `hasOpenOverlay()`，读 `escapeStack.length`），有就直接 return。共享 UI 只新增一个只读导出。右键菜单、元素浮层同样受益。补 Canvas 单测。

### R04 Bot 离线时没有提示：P1
- 证据：`light-25-offline-generate`：机器离线时生成菜单全部可点；`light-17-running` 那一轮 Bot 离线，消息在群聊里显示「离线等待 · 上线后自动执行」，画布没有横幅，输入框仍写「发给 @原型师」。`actions.ts` 的 `sendCommand` 总是提示「已交给 @{name}」。
- 改法：
  - `actions.ts` 的 `useArtifactBot` 同时返回 `online`（Bot 所在机器是否在线，取法和群成员列表的在线点一致）。
  - `ContextChips.tsx` 的「发给 @{bot}」在离线时改成「@{bot} 离线，上线后执行」（灰色加离线点）；`menus.ts` 的 generate/variation 项离线时不禁用（排队是合理行为），但加 `title`「Bot 离线，上线后执行」；`sendCommand` 离线时提示「已排队，@{name} 上线后执行」。
  - `ArtifactTab.tsx`：产物 Bot 有排队中的运行时，顶部显示「已排队，等 @{bot} 上线」（复用 `art-running` 样式，不加只读）。服务端 `ArtifactDto.running` 只代表运行中，如果需要「排队」状态，就加一个 `queued`。这一项要改协议，先确认。

### R05 新版本后批注「消失」：P1
- 证据：`light-06-annotation` 在 v1 上加了 2 条批注（`/api/artifacts/:id/annotations` 返回 2 条，`versionId` 都是 v1）；daemon 自动上传了「本机改动」v2 之后，`light-07-annotations` 显示「还没有批注」。
- 背景：`插件体系-方案.md` 规定批注按版本隔离、不迁移，这一点不改。问题在于用户看不出批注去哪了，而本机改动版本可能在用户没操作时出现。
- 改法：`AnnotationsPanel.tsx` 在当前版本没有批注时，再请求一次不带 `version` 的列表（服务端已经支持），按版本统计未处理的数量，显示「v1 上有 2 条未处理批注 · 查看」，点了切到那个版本（复用 `ArtifactTab` 的 `setViewing`）。批注工具按钮上的徽标也按这个总数算。

### R06 12 屏低缩放：P1（原 C02）
- 证据：`light-01`、`light-02`：12 屏适应后 11–13%，标题「活动详情 [图标] 活动详情」互相叠压，几乎没法点中标题。
- 改法：沿用第 1 轮的 C02 方案（`Canvas.tsx`）：标题 `maxWidth` 改成节点宽度，`z < 0.15` 时只显示图标，悬停时用 tooltip 显示全名；点阵在 `z < 0.5` 时加大间距。多行排布（像 Stitch 那样按批次分行）放到 P2。

### R07–R10 一致项
- 性能：见总览。12 屏下没有卡顿，不需要虚拟化；屏幕数到 30 以上时再评估（例如屏外 iframe 卸载）。
- 运行中只读：`light-17`、`light-17b`、`light-21`。
- 版本切换：`light-21`、`light-22`、`light-23`；切回 v1 时主页标题为「麓湖本周重磅事件」，回到当前版本后为「…（第二版）」。
- 离线打开：`light-24`、`light-26`。

### R11–R15、P05–P08、X01：P2
- R11：daemon 只在一轮结束后截图，本机改动版本是在一轮开始时上传的。卡片可以回退到最近一个有缩略图的版本，并标「旧缩略图」。
- R12：`Canvas.tsx` 的 `CMD.newTab` 改成打开外壳 `index.html#play:<id>`，和原型编辑器一致。
- R13：`menus.ts` 的 `PRESET_LABEL.mobile` 按 `device` 取宽度（小程序 375）。
- R14：`.art-canvas:focus-visible` 改成内描边，或者只在键盘聚焦时显示。
- R15：定位分享页的 404 资源；如果是 favicon，在分享外壳里加 `<link rel="icon" href="data:,">`。
- P05：`PrototypeEditor.tsx` 的 `ConnectPanel` 加上 Esc 关闭；「状态」等原型支持多状态之后再做。
- P07：ChangeBar 打开时，`.proto-stage` 底部留出输入条的高度，设备框按剩余高度缩放；连接面板打开时 ChangeBar 让开右侧。
- X01：`ExportPanel.tsx` 选中屏幕时，.zip 的说明写明「导出整个版本（与选中无关）」，或者只在复制代码格式下显示选中范围。

---

## 本轮必须修的 P0/P1（按文件分组）

### A. `apps/web/src/features/artifacts/bridge.ts` + `Canvas.tsx` + `PrototypeEditor.tsx`
- [ ] R01：只向已 `ready` 的 frame 发 `mode`、`highlight`、`select-clear`、`scroll-to`，没 ready 的等 ready 时补发。单测：未 ready 时不调用 `postMessage`。

### B. `apps/web/src/features/artifacts/Canvas.tsx` + `geometry.ts`
- [ ] R02：布局外接框变化且用户没动过视图时重新 fit；`fitView` 扣掉工具栏和面板宽度（同时完成 C03）。
- [ ] R06：标题宽度不超过节点宽度，`z < 0.15` 时只显示图标；低缩放时点阵加大间距。
- 测试：geometry/Canvas 单测覆盖「追加节点后重新 fit」「手动缩放后不再 fit」「低缩放标题宽度」。

### C. `apps/web/src/ui/overlay.ts`（只新增导出）+ `Canvas.tsx`
- [ ] R03：`hasOpenOverlay()`；Canvas 在有浮层打开时忽略 Escape。改的是共享 UI，desktop 不受影响（只新增导出）。

### D. `apps/web/src/features/artifacts/actions.ts` + `ContextChips.tsx` + `menus.ts` + `ArtifactTab.tsx`（可能涉及 `packages/protocol`）
- [ ] R04：`useArtifactBot` 返回在线状态；芯片、菜单、toast 区分离线排队；画布显示「已排队」横幅。如果需要 `ArtifactDto.queued`，按协议约定先改 `packages/protocol`，推送前确认。

### E. `apps/web/src/features/artifacts/AnnotationsPanel.tsx`（+ `actions.ts`）
- [ ] R05：当前版本没有批注时，显示其他版本未处理批注的数量和跳转入口；不改按版本隔离的规则。

---

## 没来得及验证的项

- 直接编辑「编辑文字」保存后生成新版本：`probe6` 的脚本没点中「保存」，没有得出结论；真实环境随后因后台时限被关闭。属性面板保存、上传换图同样没测。
- 「保存并让 AI 统一」、项目简报、变体、即时原型生成后自动进入编辑器、用 AI 修改元素、构想新屏：都需要 Bot 真正改文件，mock agent 只跑固定脚本，本轮没有覆盖。另外，mock 的 `mock:sh` 会把消息末尾的画布上下文当成 shell 命令执行而报错，这是 mock 的限制，不是产品问题。
- T07（浮层出视口隐藏）、K03（Tab 聚焦）在真实环境里没有复测。
- 分享页那条 404 资源没有定位。
- `?` 快捷键：真实环境的脚本里没打开快捷键弹窗（当时导出面板开着，焦点状态不确定），是否是 bug 没有确认。
- 多 Bot 群、非管理员成员（不能开分享）、演示模式、desktop 端都没有测。
- Stitch 没有补拍，R5 对比用的是第 1 轮的截图（`62`–`80`）。
