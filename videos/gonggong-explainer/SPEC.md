# 讲解片 · 章节制作规格（给章节 worker）

项目根：`videos/gonggong-explainer/`（HyperFrames，1920×1080，30fps）。整片「新同事入职 · 八关通关」：共字君当导游，解说讲功能，铁码（毒舌）/反推（悲观）穿插吐槽。视觉是浅色 Pane 风格（macOS + 飞书 IM），强调蓝 `#0a7cff`，朱红 `#d23b2a` 只用于圈注/印章。

## 你要做什么

只改分配给你的 `compositions/<cid>.html`（现在是只有关卡卡的占位文件）。**不要改** `index.html`、`assets/shared.*`、`timeline.json`、其他章节、音频。

**必读样板**：`compositions/c1.html`（第 1 关，已定稿）——结构、类名、动作调用方式全部照它来。`assets/shared.css`（全局组件类）和 `assets/shared.js`（`window.GG` 动作库）由 index 统一加载，章节里直接用。

## 硬性约定

- 子合成格式：`<template>` 内放 `<style>`、根 div、`<script>`。根 `id="<cid>-root" data-composition-id="<cid>" data-width="1920" data-height="1080"`；时间轴 `window.__timelines['<cid>'] = tl`。
- 所有 id 以 `<cid>-` 开头；章节 CSS 全部写在 `#<cid>-root …` 或 `#<cid>-xxx` 选择器下，不写裸类名规则（会污染全局）。
- 时间全部是**章节本地时间**（0 = 本章开始）。台词本地起止见下表。
- 0–1.95s 是关卡卡（保留占位文件里的 `.lv` 结构，放在根的**最后**以盖在最上层，`GG.level(tl, '#<cid>-lv')`）。正文元素从 ~1.8s 起进场。
- 版式：右栏 `.col`（x 1250–1860）放 `.kick`「第 N 关」+ `.ttl` 标题 + `.kps` 知识点（2–4 条）；左侧舞台 x 80–1200、y 140–940 放演示。y 960 以下留给字幕，HUD 在左上 y 40–90，别压。
- 音效约定（已合成好，你的动画要对齐）：每条**解说(N)**台词开始前 0.15s 有「嗖」→ 演示内容此刻进场；台词开始 +0.6s 有「叮」→ 对应知识点 `GG.kp(tl, sel, t)` 此刻弹出。角色台词(G/T/F)开始前 0.2s 有「啵嘤」→ 角色此刻用 `GG.cameo` 冒出。
- 动画只用 GSAP `fromTo`/`to`/`set`，确定性；禁止 `repeat: -1`、`Math.random`、`Date`。不要对带 `class="clip"` 的元素动 visibility（章节内也别加 clip 类）。
- 字体只用 `system-ui, -apple-system, sans-serif` 和 `ui-monospace, Menlo, monospace`。渲染时字体度量比 snapshot 略宽：单行标题/标签留 ≥10% 余量，或 `white-space: nowrap` 并控制宽度。
- 文案用中文，术语与产品一致：Bot、机器、群、Bot 主人、群管理员；只读 / 工作区写入 / 完全访问。不出现名人出处。功能描述严格按本文件，不要自行发挥新功能。

## GG 动作库（assets/shared.js）

- `GG.level(tl, sel)` 关卡卡。`GG.head(tl, '#<cid>-col')` 右栏标题进场（默认 1.75s）。`GG.kp(tl, sel, t)` 知识点弹出。
- `GG.enter(tl, sel, t, from='right'|'left'|'up'|'down')` / `GG.leave(tl, sel, t)` 卡片进出。
- 截图卡：`.screen > .bar(i,i,i,span) + .vp > .zoomer > img + svg.ring…`。img 用显示尺寸写死 width/height（= 原图尺寸 × S），`.vp` 高度 = 原图高 × S。`GG.ring(sel, S, [x,y,w,h], pad)` 用**原图像素**圈区域；`GG.draw(tl, ringSel, t, dur)` 画圈；`GG.focus(tl, zoomerSel, S, [x,y,w,h], vpW, vpH, t)` 推近到区域，`GG.unfocus` 拉回。`.note` 朱红小标签做圈注说明。
- `GG.cameo(tl, sel, tIn, tOut)` 角色从下方冒出说话（`.cameo > img + .say` 或 `.say.l` 气泡朝左）。cameo 的 `top` 设在 640–720，让它从舞台底边冒出。
- 组件类：`.panel`（白色圆角面板做模拟界面）、`.msg/.av/.who/.bb/.me/.at`（聊天气泡）、`.chip(.g/.r/.y/.k)`、`.mono`、`.note`。

## 素材

- 截图 `assets/shots/*.webp`（原尺寸）：composer-mention 2188×922、append 2196×944、run-card 2148×372、approval 2148×752、question 2148×1200、context-meter 2188×396、gitbar 2180×98、new-bot 2880×1800、bind-machine 2880×1800、diff-pane 2880×1800、file-viewer 2880×1800、preview-workbench 2880×1800、workbench-miniprogram 2880×1800、preview-share 2880×1800、admin-usage 2880×1800、interface 2880×1800、workbench-mobile 1170×2532（手机竖屏）。要圈注前先用 Read 工具看图，按显示比例换算回原图像素。
- 角色 `assets/cast/<key>-<action>.svg`：key ∈ gong(共字君) hammock(慢想) braces(铁码) focus(闭关) steps(小步) blank(留白) no(说不) abacus(算盘) invert(反推) sentry(哨兵) spring(抗摔) compass(灰度) loop(复盘)；action ∈ idle wave think ask raise wait type carry run done error sleep。各动作含义见 `assets/cast/cast.json`。
- Logo `assets/logo.svg`。

## 各章内容（台词本地时间 → 画面）

### c2 认识你的 Bot 同事（本章可用 26.0s）
- c2a[N] 1.9–12.29「每个 Bot 归属一位成员，固定跑在他的一台机器上，用本机已登录的 Claude Code 或 Codex」→ 动画关系链：成员「王磊」头像 → 机器「wanglei-mbp · macOS」→ Agent 两个芯片「Claude Code ✓」「Codex ✓」→ Bot「前端小助手」卡片；箭头依次点亮，最后 Bot 卡片显示「在线空闲」。
- c2b[N] 12.69–21.69「写提示词、设好谁能 @ 它；形象除了共字君还有十二种性格」→ new-bot 截图（新建 Bot 弹窗，推近到「角色」网格并圈注；可圈「系统提示词」「触发范围」字段，若截图里没有触发范围就用 chip 补充「触发范围：任何群成员 / 指定名单 / 仅本人」）；随后 13 个角色头像一排/一圈依次弹出（性格名可来自 cast.json 的 name）。
- c2c[T] 22.09–24.79 铁码 `braces-wave`（敷衍挥手）冒出：「别看脸，看活儿。」
- 知识点：①归属一位成员，跑在他的机器上 ②用本机已登录的 Claude Code / Codex ③提示词 · 触发范围 · 13 种形象

### c3 机器与工作区（本章可用 27.0s）
- c3a[N] 1.9–11.7「运行 gg 命令行或打开桌面端，用接入链接一绑，机器就归你」→ 左上终端面板打字：`$ gg login --server https://gg.team.dev --code 7K2Q-9XWD` → `✓ 已绑定到 王磊` → `$ gg run` → `● 已连接 · Claude Code 2.1 · Codex 0.4`；旁边或之后 bind-machine 截图（绑定新机器弹窗）圈注接入链接。「或桌面端」可用一个 macOS 菜单栏小图标/应用卡片示意。
- c3b[N] 12.1–22.0「每个 Bot 在每个群里都有独立工作区；克隆用本机 git 凭据，服务器不保管」→ 机器框里文件夹树 `~/.gonggong/workspaces/` 下三个隔离工作区卡片：「todo-app × 前端小助手」「todo-app × 后端助手」「官网改版 × 前端小助手」，逐个落下；右侧服务器云朵 + 划掉的钥匙「不保管仓库凭据」，机器里钥匙「本机 git 凭据」发光。
- c3c[G] 22.4–25.9 共字君 `gong-carry` 冒出：「工位各是各的，钥匙在你兜里。」
- 知识点：①gg 命令行或桌面端，接入链接一绑 ②每个「群 × Bot」一个独立工作区 ③用本机 git 凭据，服务器不保管

### c4 过程全透明（本章可用 30.0s）
- c4a[N] 1.9–11.7「每次 @ 生成运行卡片：在想什么、读了哪些文件、跑了什么命令，实时推到群里」→ run-card 截图进场并圈注；随后模拟「过程」面板逐条出现（各带图标/状态）：思考「先看看筛选逻辑」→ 已读取 `public/app.js` → 命令 `npm test`（耗时 3.2s）→ 编辑 `public/app.js +18 −4` → MCP「向群成员提问」。
- c4b[N] 12.1–20.2「改了几个文件、用了多久、花了多少 token，一眼就知道；/stop 就停」→ 三个大统计数字卡 count-up：「改动 4 个文件」「00:37」「216.8k tokens」；然后聊天输入框打出 `/stop @前端小助手`，运行卡状态变「已中断」。
- c4c[G] 20.6–28.9「搬砖=干活，敲键盘=回复，举手=等你批」→ 三张大卡片并排：`gong-carry`「正在工作」、`gong-type`「正在回复」、`gong-raise`「等待审批」，随台词依次高亮（约 22.5 / 24.3 / 26.3）。共字君自己就是主角，本条不另加 cameo。
- 知识点：①思考 · 读取 · 命令 · 编辑，实时推到群 ②改动数 · 耗时 · token 一眼可见 ③/stop 随时停

### c5 权限与审批（本章可用 27.0s）
- c5a[F] 1.9–5.3 反推 `invert-error`（或 invert-ask）大号出现在舞台中央偏左，抖动，气泡「万一……它把整个目录删了呢？」，背景可闪一个 `rm -rf ./` 警告条。
- c5b[N] 5.7–12.2「三档权限：只读、工作区写入、完全访问」→ 三档阶梯/滑杆，依次点亮（绿/黄/红），每档一行说明：只读「写文件、有副作用的命令都要审批」、工作区写入「可改工作区文件，执行命令等要审批」、完全访问「全部自动允许」。
- c5c[N] 12.6–21.2「超出档位弹审批卡片，只有 Bot 主人能批，群管理员也不行；30 分钟没人处理就当拒绝」→ approval 截图，圈注「批准 / 拒绝」按钮；群管理员头像试图点击被挡「群管理员 ✗」、Bot 主人「✓」；一个 30:00 倒计时快速走完 → 红章「超时 = 拒绝」。
- c5d[G] 21.6–25.91 共字君 `gong-ask` 冒出「拿不准？出道选择题」，同时 question 截图从右侧进场。
- 知识点：①三档权限：只读 / 工作区写入 / 完全访问 ②越权 → 只有 Bot 主人能批 ③30 分钟没人处理 = 拒绝 ④拿不准就向群成员提问

### c6 改动可审（本章可用 24.5s）
- c6a[T] 1.9–3.26 铁码 `braces-ask` 冒出（舞台左下）：「代码呢？」；c6b[G] 3.4–4.4 共字君 `gong-raise` 从右侧冒出：「在这儿！」——两人同框对话后都下去（约 4.6）。
- c6c[N] 4.8–17.0「本轮改动、未提交、对比主分支三种范围随手切；群头 Git 条显示每个 Bot 的分支与同步状态」→ diff-pane 截图，推近并圈注右侧「本轮 / 未提交 / 对比主分支」三个标签（依次高亮），diff 绿红行可推近一下；然后 gitbar 截图条带进场，圈注 Bot 分支与同步状态。
- c6d[N] 17.4–23.2「Markdown、图片、视频、PDF，文件都能直接打开看」→ file-viewer 截图 + 四个文件类型 chip 依次弹出。
- 知识点：①本轮 · 未提交 · 对比主分支 ②Git 条看每个 Bot 的分支与同步 ③Markdown / 图片 / 视频 / PDF 直接看

### c7 结果一键预览（本章可用 25.5s）
- c7a[N] 1.9–10.8「网页和服务，甚至桌面应用、小程序的实时画面，都能在群里直接打开」→ preview-workbench 截图进场，然后 workbench-miniprogram 截图叠上来；四个类型 chip：网页 / 服务 / 桌面应用 / 小程序。
- c7b[N] 11.2–20.0「预览工作台切五种视口尺寸；生成有期限的公开链接，谁访问过都有记录」→ 模拟一个页面框按「自适应 → 1440 → 1024 → 768 → 390」依次缩放宽度（标签同步高亮）；然后 preview-share 截图推近到公开链接弹窗并圈注；一个「访问记录」小列表弹出 2–3 行。
- c7c[G] 20.4–24.3 共字君 `gong-done` 冒出：「再也不用问：发我看看！」——可做一个被划掉的老板气泡「做好了吗？发我看看」。
- 知识点：①网页 · 服务 · 桌面应用 · 小程序 ②五种视口一键切 ③有期限的公开链接 + 访问记录

### c8 接力与多端（本章可用 23.0s，结束于本地 23.0 → outro 开始）
- c8a[N] 1.9–12.2「前端 Bot 改完可以把任务交给后端 Bot 接着做，卡片显示接力进度；接力链多长由群设置说了算」→ 三个 Bot 卡片横排：前端小助手（steps-type）→ 后端助手（braces-type）→ 测试助手（sentry-done），一张「任务卡」像接力棒在它们之间传递，顶部运行卡标题「接力 1/3 → 2/3 → 3/3」；最后出现群设置开关「接力链长度上限：3」。
- c8b[N] 12.6–20.1「网页、桌面端、手机同一个群；管理员还有用量统计和审计记录」→ interface 截图（桌面窗口）+ workbench-mobile（手机竖屏，圆角手机框）+ admin-usage 小卡片，三端同框依次进场；chip「用量统计」「审计记录」。
- c8c[T] 20.5–21.8 铁码 `braces-done` 冒出：「……还行。」（冷淡认可，可加一个小小的 👍）
- 知识点：①Bot 之间接力，卡片显示进度 ②接力链长度群设置可控 ③网页 · 桌面 · 手机 + 用量与审计

### outro（本章可用 14.0s，没有关卡卡）
- o1[G] 0.6–4.8「恭喜通关！你已经是共工空间的老员工啦！」→ 0.0 起：13 个角色（gong + 12）在下方一排跳上来（`*-done` 或 `*-wave`），彩带纸屑（用固定数组生成位置，确定性）；1.2 中间弹出「入职通关证书」卡片：标题「入职通关证书」、正文「兹证明 你 已通关共工空间八大关卡」、8 个小勾徽章（八关名称）；**3.4 朱红印章「通关」砸下**（此刻已合成重低音音效）。
- o2[N] 5.2–11.6「共工空间。开源，自托管。让 AI 同事，在群里接力干活。」→ 5.0 证书上移淡出，结尾卡：logo、「共工空间」大标题、「让 AI 同事在群里接力干活」、chips「开源」「自托管」「接入 Claude Code / Codex」「网页 · 桌面 · 手机」、`github.com/yoqu/gonggong-space`；角色排保留在底部轻轻跳。保持到 14.0。

## 验证（完成前必做）

1. `npx hyperframes lint` 无 error。
2. `npx hyperframes snapshot --at <全局时间…> --no-end -o snapshots/<cid>`，全局时间 = 章节起点 + 本地时间（起点：c2 39.0、c3 65.0、c4 92.0、c5 122.0、c6 149.0、c7 173.5、c8 199.0、outro 222.0）。每条台词至少取 2 帧，用 Read 看 contact sheet，修掉：文字溢出/折行孤字、元素互相遮挡、空白过多、圈注没对准、进场太晚或太早。
3. 回报：改了哪个文件、每条台词对应的画面、你看过的快照时间点、遗留问题。
