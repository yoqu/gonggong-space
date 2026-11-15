# Stitch × 共工原型编辑器 对比评审（第 4 轮：全流程走查 + 视觉细节）

日期：2026-10-30。分支 `feat/artifacts`（第 4 轮已合并，`ced053d0`）。前三轮修了交互、bug 和能力缺口（`stitch-对比-第{1,2,3}轮.md`）。这一轮在真实三端环境里把 10 段流程从头走到尾，浅色和深色各走一遍并截图，再和 Stitch 同场景截图逐一比对。本轮没有改业务代码。

## 0. 环境与方法

- **三端**：临时 spec `e2e/_compare4.spec.ts` 只负责搭环境，内容是：建成员和机器（mock agent）、建 Bot 和群、启用 web-prototype 插件，然后写出 `state.json` 和登录态。之后它常驻不退出，通过控制文件停止或启动 daemon（第 9 步用）。端口为 server 8800 / web 5200，数据库 `gonggong_e2e_cmp4`，daemon 用 `CARGO_TARGET_DIR=/tmp/gg-target-e2e` 预构建。
- **走查**：由 `/tmp/compare/r4/drive.mjs`（Playwright + 本机 Chrome，1440×900，`zh-CN`）按段执行 `/tmp/compare/r4/steps.mjs` 里的 `s1`…`s11`。每段单独跑，耗时 10–115 秒。上一轮的长任务被强杀过，这次改成这样分段：三端只起一次，走查脚本出错也只需重跑那一段，不用重建环境。
- **mock 产物**：临时脚本 `e2e/fixtures/_cmp4-artifact.sh`（已删除）用插件示例拼出 6 屏产物：探索生活、活动详情、报名成功、发现体验（长列表，18 行）、我的（带头像图片）、设置。产物带 DESIGN.md，有 `data-gg-link` 和 `data-gg-transition`（push / fade / slide-up / none），屏幕底部有固定标签栏。之后各轮由 `touch <文字>` 修改「我的」页的备注，从而产生新版本。
- **证据**：截图在 `/tmp/compare/r4/shots/{light,dark}-<步骤>-*.png`，日志（控制台、网络、计时）在 `/tmp/compare/r4/log-{light,dark}.txt`，失败时的 ARIA 快照在 `/tmp/compare/r4/aria-*.yml`。Stitch 对照沿用 `/tmp/stitch/*.png` 和 `/tmp/stitch/r3/`，已有截图覆盖了本轮全部场景，所以没有补拍。
- **全程网络**：没有任何 4xx/5xx 响应，也没有请求失败。控制台只有一类错误，见 P2-02。

---

## 1. 走查结果

结果：✅ 通过 / ⚠️ 通过但有问题 / ❌ 失败。问题编号对应第 2 节。

| # | 步骤 | 结果 | 实测 | 与 Stitch 对比 | 问题 |
|---|---|---|---|---|---|
| 1 | 创作 → 卡片生成中 → v1 → 缩略图 → 打开画布 | ⚠️ | v1 用时 1.0s，缩略图 2.4–3.4s，画布首屏 iframe 1.0s。首次适应为 17%，6 屏、设计系统、DESIGN.md、原型节点全部可见 | 布局相同：设计系统在最左，屏幕顶对齐，原型节点另起一行。Stitch 设计系统卡是横向的「Aa」摘要，我们是竖长卡（取舍）。卡片缩略图是整张外壳画布，屏幕很小 | P1-05、P2-19、P2-20 |
| 2 | 选屏 → 工具条 → 预览尺寸 → 详情 → 代码 → 复制为 PNG | ⚠️ | 4 个菜单都能用。手机 / 平板 / 桌面 / 全高切换正确（375 / 768 / 1280）。⌘→ 切屏时详情跟随。查看代码和复制代码正常，剪贴板 12837 字节。右键 › 复制为 › 复制为 PNG 和 ⌘⇧C 都能写入 `image/png` | 工具条位置、菜单项与 Stitch `56`–`61`、`84` 对齐。**下拉菜单是半透明的，屏幕内容透出来，文字叠在一起**（Stitch 的玻璃菜单有模糊，可读）。直接编辑后复制为 PNG 变灰 | **P1-01、P1-02**、P2-09、P2-18 |
| 3 | 直接编辑：改字、属性（颜色令牌 + 内边距）、换图、删除、撤销 / 重做 | ⚠️ | 每次保存约 0.5s 生成新版本（v2–v7、v19–v26），iframe 内容随之刷新。撤销后元素恢复，重做后再次删除。合法 PNG 换图正常 | Edit Element 浮层与 Stitch `88` 一致（共工多了连到新屏和属性）。属性面板改了不会实时预览。**编辑版本没有缩略图，群卡片变成占位图** | **P1-01**、P2-07、P2-08、P2-15 |
| 4 | 批注：元素 + 拖框区域 → 发给 Bot → 新版本 → 状态 | ⚠️ | 两种批注都能建，徽标显示待处理数。发送后 Bot 运行，2.9s 后出 v8，批注变为「已发给 AI」 | Stitch 的 Mark 框选没有批注列表，共工更完整。但发送列表默认一条都不勾（按钮显示「（0）」）；运行后新版本上看不到这些批注的结果；同一元素上的多条批注会产生重复 key 和重复芯片 | P1-05、P2-02、P2-03、P2-04 |
| 5 | 上传参考图到画布 → 加入对话 → 不 @ 发消息 → 派给产物 Bot | ✅/⚠️ | 两个文件（png + txt）上传后成为参考节点，生成新版本。「添加到对话」后输入框出现芯片，不 @ 发送后自动派给原型师，1.3s 后出新版本，消息的 canvas 带上了 `refs` | 对应 Stitch 的 Upload（`r3/tools`）。发出的消息下只显示产物名芯片，没有显示参考文件 | P2-01 |
| 6 | 设计系统：改种子色、改字体 → 保存 → 各屏刷新 | ⚠️ | 保存约 0.6s 生成新版本，6 屏的 `--color-primary` 和字体都即时更新 | 面板字段与 Stitch `92`/`93` 对齐。保存后种子色输入框被改成推导出的 primary 值；画布缩放从 17% 跳到 9% | P2-05、P2-06 |
| 7 | 原型编辑器：预览跳转（转场）、编辑连线、断开、二维码 | ⚠️ | 跳转全部正确：fade → list、push → event、back → list、tab → profile、slide-up → settings。连线和断开各生成一个新版本。二维码在未开分享时提示先开启 | 布局与 Stitch `70`–`79` 一致。**连接元素面板盖住设备右侧**（Stitch 的设备在两栏之间）。**转场动画时屏幕画到设备外框以外**。热点标签盖住元素 | **P1-03、P1-04**、P2-21 |
| 8 | 导出 zip（解压检查离线打开）、分享开关、`#play:<id>` | ⚠️ | zip 结构完整：`DESIGN.md / README.txt / _gg / assets / refs / screens / gg-artifact.json / index.html / tokens.css`。用静态服务器打开画布能正常演示。分享开启后，匿名打开分享链接和 `#play:profile` 都正确，没有错误 | Stitch 导出的 zip 双击即可打开。我们的 zip 直接双击 `index.html` 会因 CORS 读不到 manifest（README 里写明了要起服务器）；zip 里还带着已经不用的旧图片 | P2-13、P2-14 |
| 9 | 停 daemon → 发指令 → 排队横幅 → 恢复 → 自动执行 | ✅ | 1s 内检测到离线。不 @ 发送后出现横幅「@原型师 离线，1 个指令排队中，上线后自动执行」，输入框显示「离线，上线后执行」。恢复后 1.6s（深色那次 9s）自动执行并出新版本，横幅随即消失 | Stitch 是云端执行，没有这个场景，共工独有 | P2-22 |
| 10 | ⌘K、框选、快捷键弹窗、右键菜单 | ⚠️ | 画布内 ⌘K 打开命令菜单，可搜索。⇧ 拖框能选中 3 屏，普通拖动平移视图。? 打开快捷键表。右键屏幕本体和屏幕标题都出屏幕菜单。缩放菜单、产物菜单正常 | 与 Stitch `12`、`81`–`84`、`10` 对齐。右键设计系统、DESIGN.md、原型节点时只出空白画布菜单；「N 项规范问题」标签点了没反应 | P2-10、P2-11、P2-16、P2-17 |

深色主题：10 段全部重走一遍（`dark-*`）。除 P1-02（深色菜单底色 `rgba(40,40,40,.72)`，同样透出内容）和 P2-12（原型节点）外，没有新的对比度问题。参考文本节点、DESIGN.md 节点、批注面板、排队横幅在深色下都清晰可读（`dark-11-*`）。

---

## 2. 问题清单

### P0（0 项）

10 段流程全部能走通，没有阻断问题。

### P1（5 项）

#### P1-01 直接编辑、设计系统保存、连线生成的版本永远没有缩略图：群卡片变成占位图，「复制为 PNG」一直灰着
- **证据**：`light-3-03-text-saved`、`light-5-01-uploaded`、`light-6-05-saved-0.8s`、`dark-6-02-seed`（卡片是空格子图标）。`/api/artifacts/:id/versions` 返回的所有 `source: "edit"` 版本都是 `thumbnailUrl: null, screenThumbs: [], stale: false`。直接编辑后在 s2b 里右键 › 复制为 PNG 是 `disabled`，提示「缩略图生成后才能复制为 PNG」，要等下一次 AI 运行才恢复。
- **原因**：daemon 只在 AI 运行结束后截图。服务端 `staleThumbs` 只给 `source === 'local'` 的版本回退到祖先缩略图，`edit` 版本不在其列。
- **改法**：
  1. 服务端：`service.ts:64` 的 `staleThumbs` 把 `edit`（以及 `restore` 出的版本）也纳入：回退到最近一个有缩略图的祖先，并标记 `thumbnailStale`，卡片已有「缩略图为旧版本」的角标。`screenThumbs` 也按屏回退：取祖先的同一屏，并标出这屏的文件是否改过。
  2. 要真正补上新图：编辑版本生成后，如果产物的 Bot 机器在线，服务端给 daemon 发一次「只截图」请求（复用运行后截图的同一路径），截完回填 `thumbnailHash` 和 `screenThumbs`。
  3. web：`menus.ts:210` 和 `Canvas.tsx:869` 改为「有当前或旧的屏缩略图就能复制」。旧图复制时 toast 加一句「缩略图为旧版本」。
- **涉及**：`apps/server/src/modules/artifacts/service.ts`、`routes.ts`（截图回填）、daemon 截图触发（`crates/gonggong`，同运行后截图）、`apps/web/src/features/artifacts/menus.ts`、`Canvas.tsx`、`ArtifactCard.tsx`。

#### P1-02 选中屏幕后的工具条下拉菜单是透明的，屏幕内容透出来，文字叠在一起（浅色和深色都有）
- **证据**：`light-2-03-menu-生成`、`dark-2-03-menu-生成`，「即时原型」下面叠着屏幕里的「探索生活」，「营销物料」叠着金刚区图标。DOM 实测：菜单在 `.art-float` 内，`background: rgba(255,255,255,.72)`（深色 `rgba(40,40,40,.72)`），`backdrop-filter: blur(24px)` 没有生效。对照 Stitch `56-sel-generate`，同样是玻璃菜单但背景被模糊，可读。
- **原因**：`.art-float` 自己有 `backdrop-filter`，于是成为子元素的 Backdrop Root。菜单的 `backdrop-filter` 只能模糊到工具条内部，碰不到画布，只剩 72% 的底色。
- **改法**（二选一，推荐第一种）：
  - `FloatMenu` 的 `MenuButton` 改用弹层的 `portal`（`ui/popover.tsx` 已支持 `portal` 和 `useFixedPosition`），让菜单挂到 body 下；
  - 或者把 `.art-float`、`.art-tools`、`.art-corner` 的玻璃效果移到 `::before` 伪元素上（`position:absolute; inset:0; z-index:-1`），容器本身不再带 `backdrop-filter`。
  - 同一结构的还有画布右键菜单、`.art-tools` 的提示，需要一起检查。
- **涉及**：`apps/web/src/features/artifacts/Canvas.tsx`（`FloatMenu`，约 2066 行）、`artifacts.css:399-431`。如果改共享的 `ui/menu`，要同时检查 desktop 的使用方。

#### P1-03 原型编辑器里「连接元素」面板盖住设备右侧，选中的元素被挡住
- **证据**：`light-7-12-connect-panel`、`dark-7-12-connect-panel`，设备位于 815–1140px，面板从 1080px 开始，「隐私」行右端和「已选中」框被盖住。对照 Stitch `72-proto-connect`，设备完整夹在左栏和右栏之间。
- **改法**：面板打开时给 `proto-stage` 加 `paddingRight = 面板宽 + 间距`，与现有底部铅笔栏的 `CHANGE_ROOM` 做法相同，设备的缩放计算会自动避让。左栏折叠和展开时同理。
- **涉及**：`apps/web/src/features/artifacts/PrototypeEditor.tsx`（约 342 行 `proto-stage` 的 style、`ConnectPanel`）、`prototype.css`。

#### P1-04 原型转场时新屏画到设备外框以外
- **证据**：`light-7-08-slideup-mid`。上滑过程中，「设置」屏的底部标签栏（首页 / 我的）出现在手机外框下方，还盖住了铅笔按钮。push 和 push-back 在水平方向也有同样的问题。
- **原因**：动画 `transform` 加在 `.proto-scroll` 上，而 `.proto-scroll` 自己就是 `overflow:hidden` 的裁剪框，所以整块连同裁剪框一起移出去。外层 `.proto-device` 没有裁剪。
- **改法**：在 `.proto-scroll` 外面加一层固定不动的裁剪层（`overflow:hidden; border-radius` 与屏幕一致），动画只作用于内层；或者给 `.proto-device` 加 `overflow:hidden` 再配 `clip-path: inset(10px round 36px)`。动画时长和曲线不用改。
- **涉及**：`apps/web/src/features/artifacts/prototype.css:211-300`、`PrototypeEditor.tsx`（`proto-scroll` 的结构）。

#### P1-05 群聊窄栏里的画布芯片和运行产物行被截断：芯片向左溢出看不全，「在画布中查看」被挤出可视区
- **证据**：`light-4-10-after-run`、`light-5-01-uploaded`，用户消息下的芯片「麓客+ 探索生活 · 活动详情」左侧被聊天栏切掉。`light-1-05-canvas-fit`、`light-2-01-selected` 中，运行卡下「麓客+ 探索生活 · v1 · 改了 活动详情、探索生活、发现体验、我的、…」超出栏宽，后面的「在画布中查看」看不到。这一行正是第 3 轮 G11 加的入口，画布打开时（聊天栏只有约 360px）最常用。
- **改法**：
  - `chips.css`：给 `.art-chips--sent` 加 `max-width: 100%; justify-content: flex-end`；`.art-chip` 加 `max-width: 100%; min-width: 0`；`.art-chip__text` 的 `max-width: 320px` 改为 `min(320px, 100%)`。
  - `RunArtifactsLine`：外层改为 `display:flex; max-width:100%; min-width:0`，文字 `flex:1 1 auto` 并用省略号截断，「在画布中查看」设为 `flex:none` 固定在行尾。
- **涉及**：`apps/web/src/features/artifacts/chips.css`、`CanvasRefs.tsx`、`apps/web/src/features/chat/TimelineItems.tsx`（446、720、809 行的挂载点）。

### P2（22 项）

| 编号 | 问题 | 证据 | 改法 | 涉及 |
|---|---|---|---|---|
| P2-01 | 发出的消息带了参考文件，但气泡下的芯片只显示产物名，看不到是哪个参考文件 | `light-5-06-after-run`；消息的 `canvas.refs=[竞品参考.png]`，芯片却是「麓客+ 探索生活」 | `MessageCanvasChips` 增加 `canvas.refs` 的芯片（图片或文件图标 +「参考 · 名称」），点击时聚焦到对应参考节点 | `CanvasRefs.tsx:8-28` |
| P2-02 | 同一元素上有多条批注时，发送消息里的 `canvas.elements` 有重复项。React 报 `Encountered two children with the same key el:screens/event.html#3124`，每次渲染都报；气泡下出现 3 个相同的芯片 | 两套日志 s4–s10 每段都有；`light-4-10` | 服务端 `commands.ts:102` 构建 `elements` 时按 `file#ggId` 去重；web 端 key 加上下标兜底 | `apps/server/src/modules/artifacts/commands.ts`、`CanvasRefs.tsx:21` |
| P2-03 | 批注面板的发送列表默认一条都不勾，按钮是「发给 @原型师（0）」且不可点 | `light-4-07-notes-panel` | 默认勾选当前版本的全部待处理批注，用户可以取消；或者加「全选」 | `AnnotationsPanel.tsx` |
| P2-04 | AI 按批注修改出新版本后，批注面板显示「还没有批注」和「v7 上还有 4 条未处理」，刚发出的 6 条看不到结果 | `light-4-10-after-run` | 新版本面板顶部显示「上一版已发给 AI 的 N 条」并给出「标为已解决 / 重新打开」；或者 run 完成时把这批批注带到新版本，状态设为待确认 | `AnnotationsPanel.tsx`、`apps/server/src/modules/artifacts/annotations.ts` |
| P2-05 | 设计系统保存后，种子色输入框从用户填的 `#7C3AED` 变成推导出的 primary `#5a13d2`，再打开时也是这个值 | `light-6-02-seed` 与 `light-6-05` 对比 | 把种子色存进 DESIGN.md 头部（如 `seed:`）或 tokens 注释，读取时优先使用；没有存时才退回 primary | `DesignSystemPanel.tsx:272`、`designMd.ts` |
| P2-06 | 保存设计系统后画布从 17% 自动缩到 9%（面板开着时重新适应），内容缩成一小块 | `light-6-05`、`light-6-07` | 版本变化引起的自动适应只在布局真正变化（节点增删或尺寸变化）时触发；有侧栏时适应区域扣除侧栏后不应比原来更小 | `Canvas.tsx`（自动适应逻辑，第 2 轮 R02） |
| P2-07 | 属性面板改颜色和间距时不能实时预览，保存后才看得到 | `light-3-06-props-filled`（选了 tag-highlight，按钮仍是绿色） | 通过桥接发 `preview-style` 临时设置 style，取消时还原，保存时再落成 op | `ElementPanel.tsx`、`bridge.ts`、`apps/server/src/modules/artifacts/bridge.js` |
| P2-08 | 侧栏（元素属性、批注、详情）打开后会盖住正在编辑的屏幕和元素 | `light-3-06`（「编辑资料」右端在面板下）、`light-4-07`（批注标记 1 被盖住） | 侧栏打开时，如果所选元素或屏幕落在侧栏区域，就把视图平移到剩余区域（复用 `room.right`） | `Canvas.tsx` |
| P2-09 | 选中屏幕时连线过多：长列表 18 行全部画出连到详情的线，线穿过其他屏，「首页」等标签重叠成一串 | `light-2-08-copied-png`、`light-10-05-marquee-selected` | 同一对屏幕的多条连线合并为一条并标「×18」；标签互相避让；默认只画所选屏的出线，入线淡化 | `Links.tsx`、`geometry.ts` |
| P2-10 | 右键设计系统、DESIGN.md、原型节点时，出的是空白画布菜单 | `log-*` 中 s10b 一节 | 为这几种节点加专用菜单：打开（主题 / DESIGN.md 标签 / 原型编辑器）、聚焦、复制链接；DESIGN.md 节点加「复制 Markdown」 | `Canvas.tsx`（onContextMenu）、`menus.ts` |
| P2-11 | 顶栏「3 项规范问题」标签不能点，界面里看不到具体是哪几处问题 | `light-10-13-issues-click` | 改成按钮，弹出问题列表（文件、说明），点某一条就聚焦对应屏幕；再给一个「让 AI 修复」，走 commands | `ArtifactTab.tsx`、`menus.ts` |
| P2-12 | 深色主题下原型节点是纯黑卡，放在深色画布上几乎看不见，没有边框 | `dark-1-05-canvas-fit`、`dark-9-02-queued`；Stitch `80` 有灰色描边 | `.art-proto` 加 `box-shadow: 0 0 0 1px var(--separator)`；可以再显示入口屏的缩略图 | `artifacts.css` |
| P2-13 | 导出的 zip 双击 `index.html` 打不开（file:// 读 `gg-artifact.json` 被 CORS 拦截），页面显示「读不到 gg-artifact.json」 | `light-8-03-offline-index`；用静态服务器打开正常（`light-8-03b`） | 导出时把 manifest 内联进 `index.html`（`<script type="application/json" id="gg-artifact">`），外壳先读内联数据，读不到再 fetch；README 改成「双击即可，或起服务器」 | `apps/server/src/modules/artifacts/export.ts`、插件 `kit/index.html` |
| P2-14 | 换图后旧图片仍留在版本文件和 zip 里（`assets/2f98…png` 已经没有屏幕引用） | 第 8 步的 zip 目录列表 | `edits.ts` 处理图片 op 时，如果旧 `assets/*` 已没有任何文件引用就删掉；导出时也只打包有引用的 assets | `apps/server/src/modules/artifacts/edits.ts`、`export.ts` |
| P2-15 | 上传接口接受内容损坏的图片（扩展名和 MIME 是 png，字节是坏的），保存后屏幕上图片空白，也没有任何提示 | `light-3-09-image-saved`（第一次换图用的坏 PNG） | 上传时校验文件头魔数（PNG、JPEG、GIF、WebP），不符时返回「图片无法读取」 | `apps/server/src/modules/artifacts/routes.ts:443`（`/uploads`） |
| P2-16 | 框选多屏后，输入框里每屏一个芯片、每个占一行，3 屏就占 3 行，挤掉了聊天高度 | `light-10-05-marquee-selected` | 超过 2 屏时合并成一个「3 个屏幕」芯片，悬停显示列表；或者芯片改为单行横向排列 | `ContextChips.tsx`、`chips.css` |
| P2-17 | ⌘K 菜单的分组标题（屏幕、参考文件、选择）比条目多缩进一截，左侧不对齐 | `light-10-01-cmdk` | 分组标题的 padding-left 与条目一致 | `CommandMenu.tsx` 及其样式 |
| P2-18 | 「已复制为 PNG」「已复制代码」等提示出现在聊天栏左下角，离画布上的操作位置很远 | `light-2-08-copied-png` | 画布内的操作提示在画布区域底部居中显示（toast 支持传容器），或统一放在应用底部居中 | `Canvas.tsx`、`ui` 的 toast |
| P2-19 | 群聊卡片缩略图是整张外壳画布（含工具栏），屏幕非常小，看不清 | `light-1-03-card-thumb` | daemon 截图时裁掉外壳工具栏、按内容包围盒截取；或改用入口屏加 2 屏的拼图 | daemon 截图（`crates/gonggong`）、`ArtifactCard.tsx` |
| P2-20 | 画布打开时聊天栏变窄，「创作请求 · 产品原型」卡片标题折行成「产 / 品原型」 | `light-1-05-canvas-fit` | 标题加 `white-space: nowrap; text-overflow: ellipsis`，标签「已交给 @…」可以收缩 | 插件创作卡片组件（`features/plugins`） |
| P2-21 | 原型编辑模式下「已连接」「返回」小标签盖住元素左上角，比如返回箭头 | `light-7-15-connected` | 标签放到元素框外侧上方（`translateY(-100%)`），空间不够时放到右上角 | `prototype.css`、`PrototypeEditor.tsx`（`Hot`） |
| P2-22 | 离线等待卡片的说明文字被底部「任务」条盖住半行 | `light-9-03-queued-2` | 时间线底部的留白加上任务条的高度 | `features/chat`（时间线底部 padding） |

---

## 3. 本轮修复清单（按文件分组）

### web：`apps/web/src/features/artifacts/`
- `Canvas.tsx`
  - **P1-02**：`FloatMenu` 的菜单改用 portal；
  - **P1-01**：复制为 PNG 可以用旧缩略图；
  - P2-06：自动适应只在布局变化时触发；
  - P2-08：侧栏打开时避让所选内容；
  - P2-10：节点专用右键菜单；
  - P2-18：提示显示位置。
- `artifacts.css`
  - **P1-02**：玻璃效果移到 `::before`，或者确认 portal 后去掉嵌套的 `backdrop-filter`；
  - P2-12：原型节点描边。
- `menus.ts`
  - **P1-01**：复制为 PNG 的禁用条件；
  - P2-10：节点菜单项；
  - P2-11：问题列表与「让 AI 修复」。
- `ArtifactCard.tsx`：**P1-01** 编辑版本显示「缩略图为旧版本」；P2-19。
- `PrototypeEditor.tsx`、`prototype.css`：**P1-03** 舞台避让连接面板；**P1-04** 转场裁剪层；P2-21 热点标签位置。
- `chips.css`、`CanvasRefs.tsx`：**P1-05** 芯片和运行行不溢出，「在画布中查看」固定在行尾；P2-01 参考文件芯片；P2-02 key 兜底；P2-16 多屏芯片合并。
- `AnnotationsPanel.tsx`：P2-03 默认全选；P2-04 显示上一版已发送的批注。
- `DesignSystemPanel.tsx`、`designMd.ts`：P2-05 种子色持久化。
- `ElementPanel.tsx`、`bridge.ts`：P2-07 属性实时预览。
- `Links.tsx`、`geometry.ts`：P2-09 连线合并与标签避让。
- `ArtifactTab.tsx`：P2-11 规范问题标签可以点。
- `CommandMenu.tsx`：P2-17 分组标题对齐。
- `ContextChips.tsx`：P2-16。

### web：其他目录
- `features/chat/TimelineItems.tsx`：**P1-05** 挂载点保证 `min-width:0`；P2-22 时间线底部留白。
- `features/plugins/`（创作卡片）：P2-20。
- `ui/`（toast 容器，可选）：P2-18。改共享组件时要同时检查 desktop。

### server：`apps/server/src/modules/artifacts/`
- `service.ts`：**P1-01** `staleThumbs` 纳入 `edit` 和 `restore` 版本，`screenThumbs` 按屏回退到祖先。
- `routes.ts`：**P1-01** 编辑版本生成后请求 daemon 补截图；P2-15 上传校验文件头。
- `commands.ts`：P2-02 `elements` 去重。
- `annotations.ts`：P2-04。
- `edits.ts`、`export.ts`：P2-13 内联 manifest；P2-14 清理没有引用的 assets。

### 插件与 daemon
- `apps/server/plugins/official/web-prototype/skills/web-prototype/kit/index.html`：P2-13 优先读内联 manifest。
- `crates/gonggong`（截图）：**P1-01** 支持「只截图」请求；P2-19 截图裁掉外壳工具栏。如需新的 daemon 消息，按约定先改 `packages/protocol` 并补 fixture。

### 建议的测试
- server 集成：直接编辑生成的版本 `thumbnailUrl` 回退到祖先，且 `thumbnailStale=true`；同一元素两条批注发送后，`canvas.elements` 不重复；上传坏图返回 400；导出的 `index.html` 含内联 manifest。
- web 单测：`FloatMenu` 菜单挂在 body 下；`MessageCanvasChips` 渲染 refs；批注面板默认全选；种子色保存后保持不变；连接面板打开时舞台有 paddingRight。
- e2e（扩展 `e2e/artifacts.spec.ts`）：直接编辑后卡片仍有缩略图（旧图角标），并且「复制为 PNG」可用。

---

## 4. 未完成和需要说明的地方

- **Stitch 没有补拍**：现有的 `/tmp/stitch/*.png` 和 `r3/` 已经覆盖本轮 10 段对照，所以没有再开 ego-browser。第 9 步（离线排队）Stitch 没有对应场景，⌘K 也没有 Stitch 截图，只核对了功能是否存在。
- **剪贴板**：用浏览器 `navigator.clipboard.read()` 验证了写入的类型（`image/png`）和代码文本，没有真的粘贴到外部应用验证像素。
- **深色主题**：第 1 步的「生成中」卡片在深色下只截到占位态（mock 生成太快，约 1s），没有截到转圈的中间态。
- **动效**：只截了动画中间的一帧（120–150ms），没有逐帧录屏。第 1、2 轮已评过的流畅度这轮没有重测。
- **数据状态**：走查中多次改了同一个产物（v1 → v29）。深色那一轮用新建的产物「麓客+ 暗色对照」截了第 1 步，随后归档了它，其余步骤都在主产物上做。
- **清理**：临时 spec `e2e/_compare4.spec.ts`、fixture `e2e/fixtures/_cmp4-artifact.sh`、`target` 软链都已删除；三端进程和测试静态服务器（8771）都已退出；仓库除本文档外没有其他改动。走查脚本和截图留在 `/tmp/compare/r4/`。
