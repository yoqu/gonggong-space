# 原型协作：AI 编辑可视化 + 多人光标 · 方案

> 提出：姜维川 2026-11-19。状态：已拍板方向；按共字君Codex（#17212）、gemini大师（#17219）两轮审查修订，P1 已实现（2026-11-19，见第八节），P2–P4 未开工。现状见 `docs/domains/产物与原型编辑器.md`。

## 一、现状与问题

| # | 现象 | 根因（代码） |
|---|------|------|
| 1 | AI 不知道该改哪个原型 | 自然语言 @Bot 时 `RunStart.artifacts` 最多下发 20 个产物（`runArtifacts`），模型只能猜；只有画布指令/批注/上下文芯片才带明确产物 |
| 2 | 用户看不出 AI 在改哪里 | `ArtifactDto.running` 只表示「被检出」，粒度=整个产物；跑完才上传新版本，画布才变 |
| 3 | 过程生硬 | 结束时整屏 iframe 换新版本，无过渡、无改动标记 |
| 4 | 看原型的人彼此不可见 | 无 presence；web WS 客户端消息只有 focus/visible（≤1KB），分享页访客无连接 |

已有可复用的底座：
- daemon 已从 ACP `tool_call` 的 `kind=edit|delete|move` + `locations` 收集改动文件（`turn.rs` `tool()`、`session.rs` `changes_steering`），**与 Agent 种类无关**；Codex 的 shell 改动无 locations，靠文件扫描兜底。
- 桥接已上报 `anchors`、`rect`、`covers`、滚动位置（`BridgeToShell`），屏内元素可按 `data-gg-anchor` 定位（`data-section` 目前不上报，P2 补）；父页收不到 iframe 内的 `pointermove`（P3 补）。
- 服务端内存总线 `ctx.bus` + `/ws/web`，单实例。

## 二、核心思路：AI 是一个特殊的「在场者」

人和 AI 共用一套在场（presence）模型：谁、在哪个产物、哪一屏、哪个区域、在做什么。人显示为光标，AI 显示为「正在编辑」的粒子区域 + 头像标签。只做一套渲染层和传输通道。

信号三层，从可靠到精细：

1. **事实层（被动，必做）**：daemon 把 edit 类工具调用的路径映射到 `design/<slug>/screens/<id>.html` → 产物 + 屏，发 `ArtifactActivity { runId, artifactId, screenId, phase }`（临时信号，不入库，见第五节）。以检出后的文件基线观察实际写入，`locations` 只作线索；Codex 等无 locations 的靠 mtime/size 轻扫兜底（500ms，不引新依赖）。不依赖 Agent 配合，所有 ACP Agent 都生效。
2. **意图层（主动，MCP）**：新增 gonggong 工具 `artifact_focus({ artifact, screens?, anchors?, intent })`，Agent 开改前声明「改哪个产物、哪几屏、哪些区块、要做什么」；产物不明确时返回候选列表让 Agent 反问用户，不再瞎猜。web-prototype SKILL.md 加硬规则「动手前先调 artifact_focus」。所有接入 gonggong MCP 的 Agent 可用（与 #17182「扩充非 Claude/Codex Agent」并行，互不阻塞）。
3. **内容层（区块级）**：daemon 写入屏文件后防抖推送「草稿差异」：按 `data-section` / `data-gg-anchor` 比对 head 与当前文件，只上报变了的区块 id（不传整份内容）。画布用桥接的 rect 把粒子效果精确落到这些区块上。

## 三、交互设计

### AI 编辑中
- **入口定位**：群/话题输入框显式 @Bot 时，若工作台正开着某产物，自动带上该产物的「前台」芯片（可移除，软提示，见第五节）——这是解决「改哪个原型」成本最低、收益最大的一步。
- **群聊运行卡片**：显示「正在改 · 《外卖小程序》› 登录页 › 底部按钮区」，点击打开画布并定位。
- **画布**：
  - 屏级：被改的屏边框流光 + 右上角 Bot 头像胶囊「Claude 正在改 · 调整按钮样式」；未被改的屏不动。
  - 区块级：被改区块覆盖粒子波浪（Canvas 2D 粒子沿区块轮廓流动，Bot 主题色），画在 iframe 上层的覆盖层，不进屏内 DOM。
  - 「跟随 AI」开关：视口自动平移到正在改的屏（类 Figma follow），用户手动拖动即退出跟随。
- **完成过渡**：新版本成为 head 且新屏桥接 ready 时，用旧版截图垫底，擦除（约 600ms）揭开新屏实时 iframe，改动屏描边闪 1.5s 后淡出（P2 起细到区块，屏标题旁「改了 3 处」可逐处跳转）。只在该 run 的版本成为 head 后播放。
- 性能与无障碍：画布上只用一个全视口 `<canvas>` 覆盖层（DPR≤2、≤30fps），只画视口内的屏，拖拽时暂停；`prefers-reduced-motion` 改为静态虚线框 + 文字。

### 多人光标
- **范围**：画布、原型预览、分享页（访客）。
- **身份**：登录用户用昵称 + 头像色；访客随机名（「匿名的水獭」这类形容词+动物），存 localStorage，同一浏览器保持不变；颜色按 id 哈希。
- **坐标**：画布用世界坐标；屏内用「屏 id + 最近锚点/元素 + 元素内相对位置」，各自缩放、滚动、设备宽度不同也能落在同一元素上；找不到元素时退回屏内百分比。
- **呈现**：独立 `CursorLayer` 组件，DOM + `translate3d`（不并进 `Canvas.tsx`/`PrototypeEditor.tsx`）；箭头 + 名字胶囊，30s 无动作淡出；顶栏头像堆「3 人在看」，点头像跟随此人视口；原型预览的屏幕列表上挂小头像点表示谁在哪一屏；对方选中的元素用其颜色描边。
- **传输**：`/ws/web` 增加 `presence` 客户端消息（10–12Hz，服务端 50–80ms 批量推送，接收端插值）；服务端按产物分房间内存转发，不落库。分享页走预览域同源 `/__gg/presence`（见第五节 P4），访客只能发自己的光标。房间内最多显示 30 个光标。
- **设置**：「隐藏我的光标」开关；私有档产物（`private`）不广播。

## 四、分期

| 期 | 内容 | 端 | 迁移 |
|---|---|---|---|
| P1 | 编辑目标绑定（芯片 + 服务端校验）；daemon `ArtifactActivity`（事实层，内存旁路）；运行卡片与画布屏级「正在改」+ 完成过渡 + 跟随 AI | web + server + daemon + protocol fixture | 无 |
| P2 | MCP `artifact_focus`（意图层）+ SKILL 规则；区块差异上报；区块级粒子动效；「改了 N 处」逐处跳转 | server + daemon + web + 插件 | 无 |
| P3 | 成员多人光标（画布 + 原型预览），头像堆、跟随、选中描边 | web + server | 无 |
| P4 | 分享页访客光标与随机名、「对访客隐藏成员名」开关 | web + server | 轻量迁移（`preview_shares.hide_member_names`） |

P1–P3 不需数据库迁移，P4 需一列（在场信息与活动都是临时的，走内存）。P1/P2 改 daemon 协议，需要发新版客户端（按约定交共字君codex 发版）；旧 daemon 退回现在的产物级 `running`。

## 五、各期规则（审查后补，P1 开工以此为准）

### P1 编辑目标
- **两种目标**：
  - **显式强目标**：选区、批注、画布指令、「正在编辑」、消息引用产物（`MessageComposer` 现有逻辑）。服务端只接受强目标的新版本，其余拒绝并在运行卡片提示；拒收后 daemon 把非目标产物目录回滚到 head，否则下轮 `prepare` 会把残留当 `source=local` 上传（`artifacts.rs` 353 行）。
  - **前台软芯片**：没有任何显式目标、且用户**显式 @Bot** 时，自动带上工作台前台产物的芯片，只作提示（排在首位、提示词注明「用户正看着它」），不硬锁——开着 A 时让 Bot 改 B 或修后端照常可行。前台芯片不走 `artifactContext` 的免 @ 路由（`messages/routes.ts` 168 行 `canvasBot`），避免普通消息误触发 Bot；群与话题输入框都支持，服务端校验芯片产物属于本群。
- 用户移除芯片后，本条消息不再自动重加；切群、切标签按当时前台重算。
- 有目标时，`issuesNote`（`artifacts/service.ts`）只列目标产物的检查问题，不让其余产物的 lint 干扰。
- **无目标且有歧义**：提示词要求 Bot 先问；P2 的 `artifact_focus` 再补候选列表。

### P1 状态可信
- **事实以实际写入为准**：daemon 在检出成功后记文件基线，之后观察到的写入才算「正在改」；检出本身和检出前已有的改动不算。ACP `locations` 只作线索，加速定位；无 `locations` 的 shell 写入靠 mtime/size 轻扫兜底（不引 `notify` 依赖）。
- **文件到显示的映射**：`screens/<id>.html` → 该屏；`tokens.css`、`DESIGN.md`、`gg-artifact.json`、`rules/*.md` → 产物级「改全局样式/配置」；L0 产物的 `index.html` → 产物级。一个 run 可同时改多屏，活动是屏集合。
- **活动生命周期**：以 `runId + artifactId + screenId` 为键；run 终态、daemon 失联、超时（无新写入 60s）都清理。
- **完成条件**：只有**该 run 产生的版本成为 head** 且新屏 iframe 桥接 ready 时才播过渡。不等新截图——daemon 在 head 发布后才异步拉浏览器截图（晚 5–15s，没装 Chrome 时永远不来）；用旧版截图垫底擦除揭开新 iframe，没有旧截图就用 1.5s 描边闪。上传失败重试中、或只产生了未成为 head 的版本（合并冲突）时，不播过渡、显示对应状态。
- 「改了 N 处」逐处跳转依赖区块差异，移到 P2。

### P1 事件、权限与兼容
- `ArtifactActivity` 是临时信号，**不进 `runEvents` 表**，走服务端内存旁路；按产物访问权限订阅（`/ws/web` 的 focus 不等于授权），只传 `runId/artifactId/screenId/phase/at` 等最小字段；刷新或重连时下发当前快照，过期项自动清除。
- 协议加可选能力标记，不提高最低协议版本；TS/Rust fixtures 往返测试；验证新 server + 旧 daemon、旧 server + 新 daemon 混跑。服务端先上线，再发 daemon。

### P2 意图层与区块
- MCP 声明的意图（`artifact_focus`）与 daemon 观测到的写入分开呈现：意图显示为「打算改」，写入才显示「正在改」；两者不一致以观测为准。
- `bridge.js` 扩报 `data-section`（现在只报 `data-gg-anchor`）。
- 区块差异固定以本次检出版本为基准：`state.json` 不存旧 HTML，daemon 在 turn 开始时把各屏 section/anchor → sha256 基线缓存在内存，写入后对比；锚点缺失、重复或版本不符时降级为屏级。
- `artifact_focus` 是 daemon 侧工具（`gonggong-tools.json` 静态嵌入），需发 daemon；`artifact` 参数可选、可模糊匹配，命中时返回屏列表 + 区块摘要（对 AI 有用，促其主动调用）；未检出的产物登记 checkout，本轮不建目录。SKILL 保留无此工具时的降级写法。
- 候选列表只含调用者有权访问、当前 run 可用的产物；不在本次 run 内的产物提示用 `artifact_checkout`（下次运行生效）。

### P3 多人光标
- `bridge.js` 节流上报屏内 pointer：标注/编辑模式与原型编辑器下 iframe 吃掉指针事件，父页收不到。
- 位置带 `data-gg-when` 状态；对方所在状态在本端隐藏时不退回百分比，改为屏边缘头像提示。
- 作品页 `/works/:id` 也纳入在场。
- 光标 30s 无动作淡出，但**不等于下线**；「N 人在看」由页面可见性 + 心跳维护。
- 位置带屏 id 和版本号；对方看的不是同一版本或锚点缺失时，只显示「在某屏」，不画精确点。
- 关闭「显示我的光标」或页面隐藏时立即广播清除。
- 服务端每连接限频、每房间限人、积压时丢旧帧只留最新。量级：30 人各 20Hz 全量转发约 17,400 次投递/秒，因此定为 10–12Hz 上报 + 50–80ms 批量推送。
- 手机端（compact）只显示头像堆，不画光标。

### P4 分享页访客
- 分享链接 302 后 URL 已不带 token，访客靠预览域 HttpOnly Cookie，且运行在预览域原生壳 `kit/index.html`。因此不开 `/ws/share/:token`，改为预览域同源 `/__gg/presence`（复用现有 `allowed()` 鉴权）；光标脚本抽成独立 `/__gg/presence.js`，在线时经 gg-meta 注入（离线 zip 不带）。分享撤销、过期、改密后立即断开活跃连接；访客固定看分享时的版本，与成员房间按版本隔离。
- 「对访客隐藏成员名」：`preview_shares` 无可扩展列，**需轻量迁移加 `hide_member_names`**，P4 开工前单独确认。服务端出站时过滤，隐藏时连 userId 一起换成匿名 id，改后立即生效。
- 访客随机名由服务端按词库校验；私有档产物的分享不广播成员在场；文案同步 `en.ts` / `en.rs`。

## 六、验收标准

**P1（mock-agent 跑，集成 + e2e）**
- 前台开着 A，@Bot 不带其他引用：自动带 A 芯片，Bot 改 A。
- 前台开着 A，@Bot「改 B」或「修后端」：照常执行，不被拦。
- 前台开着 A、不 @Bot 发普通消息：不触发 Bot。话题输入框同样带芯片。
- 前台开着 A，消息显式引用 B：以 B 为目标，A 不受影响。
- 移除芯片后发送：不重加；切群、切标签后芯片随前台变化。
- 显式强目标为 B 时 Bot 写了 C：服务端拒绝、运行卡片提示，C 目录回滚到 head，下一轮不会把 C 当本机改动上传。
- ACP edit 写入、无 `locations` 的 shell 写入、只读不写：前两者画布在**实际写入后 2s 内**标出对应屏，第三者不标。
- 改 `tokens.css`：显示产物级「改全局样式」；一次改两屏：两屏同时标出。
- 完成过渡在新 head 桥接 ready 后立即播放（不等截图）；无旧截图时只描边闪。
- 取消、daemon 断线：「正在改」及时清理；合并冲突/上传失败：不播完成过渡。
- 旧 daemon：退回产物级 `running`，无报错。刷新页面：正在进行的活动从快照恢复。
- 减少动效模式：无动画，只有静态框与文字。

**P2–P4**：按第五节规则各自补测试；画布 20 屏、5 人在线滚动保持 60fps；成员与访客同看一产物光标对准同一元素，访客随机名刷新不变。

## 七、已定（姜维川 2026-11-19）

1. 不做 AI 写一半的实时草稿预览：P1–P2 只标改动区块和动效，P4 后再评估。
2. 分享页访客可以看到成员真名；分享设置加「对访客隐藏成员名」开关。
3. 顺序 P1 → P2 → P3 → P4，P1 先单独上线验证。

## 八、P1 实现记录（2026-11-19）

与第五节的出入：
- **非目标产物不硬拒、不回滚**：触发消息指明了产物（`referenced`：`artifactRefs` / 引用的产物卡片）时，本轮对其他产物的 `source=run` 上传存为 stale 候选、不成为 head（`submitVersion` `candidateOnly`），运行卡片显示「存为候选，未成为当前版本」。daemon 拿到的版本等于它本地文件，下一轮 `prepare` 照常检出 head 覆盖残留，旧 daemon 也不会卡在重传上，所以不需要 daemon 回滚。`source=local` 不受影响。
- **完成过渡**以「该 run 的版本成为 head」（`ArtifactDto.head.runId`）为准，在屏节点上播 0.6s 擦除 + 1.5s 描边淡出；没有等桥接 ready（iframe 下本来就垫着上一版截图）。
- **「跟随 AI」开关未做**：画布顶栏和运行卡片的「正在改 …」可点击，一次性定位到那几屏；持续跟随放到 P2 随区块动效一起做。

落点：
- 协议：`SendMessageReq.foregroundArtifactId`、`RunArtifact.candidate`、`ArtifactActivityDto`、`ArtifactDto.activity`、web 事件 `artifact.activity`、daemon 消息 `artifact.activity`（能力 `artifactActivity`，fixture `d2s.artifact.activity.json`）。
- 服务端：`artifacts/activity.ts`（内存表、按产物权限推送、run 终态/机器离线/60s 无写入清理）、`runTargets` / `foregroundArtifact`（`artifacts/service.ts`）。
- daemon：`artifacts/watch.rs`（检出后基线、500ms 轻扫、集合变化才发）。
- web：`MessageComposer` 的「正在看」芯片、`artifacts/ActivityLayer.tsx`（画布标记与过渡、顶栏 `ActivityNote`）、`CanvasRefs.tsx` 运行卡片行。
- 上线顺序：服务端先上（旧 daemon 不发活动，界面退回产物级 `running`），再按约定交共字君codex 发 daemon。

