# UX 原则回归记录

由定期 UX 原则回归审查维护：对照 8 条用户体验原则全量核查 Web、Desktop（Tauri）、Server/Protocol 与 Rust CLI/Daemon，当轮修复高优问题并沉淀验收记录，遗留待办供下轮优先消化。

> 说明：单独的「动效回归」任务并行负责动画/过渡检查，本记录明确排除 `motion.css`、`presence.ts` 及 CSS `transition`/`animation`/`@keyframes` 改动；本轮零数据库迁移（`schema.ts` 未变更）。

---

## 本轮概览（2026-11-26）

### 1. 审查原则（8 条用户体验原则）
1. **#1 系统能判断的，不留给用户**
2. **#2 此刻没用的，就不出现**
3. **#3 能替人做的，就直接做**
4. **#4 同一件事，处处一样**（用词、按钮位置、确认方式、图标）
5. **#5 按下去有回应，再按能收回**（即时反馈、提交锁、错误重试、撤销）
6. **#6 不打断人手上的事**（少弹窗、少抢焦点、不清草稿、输入法保护）
7. **#7 常用的好做，会丢东西的难误碰**
8. **#8 界面自己说明自己**（可读对比度、清晰空态/加载/错误态、去内部术语）

### 2. 审查范围
- **基线提交**：`gitlab/main` `3b82012ba`（起于 `5f3f0b323`，最终 rebase 至 `3b82012ba`；分支 `ux/nightly-2026-11-26`）
- **覆盖范围**：Web 全量 41 个功能域 + `app/` 壳层 + `ui/` 设计系统组件、Desktop Tauri（含共享 `@web/*` 与 `src-tauri`）、Server/Protocol 用户可见文案与接口契约、Rust CLI/Daemon（`crates/gonggong`）。重点覆盖近 3 天 93 次提交（作品空间独立画布、连接器按人隔离、话题配色与移动端顶栏、供应商默认配置与管理台改版）及历史未审页面。
- **验证方式**：静态全量审计 + Playwright 桌面（1440×900）/ 移动端（390×844）× 亮/暗主题实测走查 + Gemini（`agy`）UX 顾问复核 + GPT（`codex exec`）全量 diff 审查 + TDD 回归测试（Web 3,301 + Desktop 120 + Protocol 531 + Rust/Server 单测全绿）。

### 3. 统计总表

| 维度 | 数量 | 说明 |
| :--- | :---: | :--- |
| **本轮已修总计** | **83 项** | 审查主清单 73 项（`U-01..U-67` + `L-1..L-6`）+ `agy` 新增 6 项（`A-1..A-6`）+ Codex 复审 4 项（`CX-1..CX-4`） |
| 按严重程度 | **P0: 14 · P1: 41 · P2: 27 · P3: 1** | 0 项 P0/P1 遗留；`agy` 建议中 2 项低优（B-6/B-7）延后至下轮 |
| 按原则分布（可多选） | **#1:** 9 · **#2:** 16 · **#3:** 5 · **#4:** 35 · **#5:** 36 · **#6:** 12 · **#7:** 22 · **#8:** 50 | 高频问题集中在自我说明（#8）、反馈/重试/撤销（#5）、跨端一致性（#4）与防误碰（#7） |

### 4. 已落地提交列表
- `5d6ecdb3c` — `fix(works,artifacts,previews): UX原则回归修复（空画布入口、独立作品权限与协作、预览与工作台状态）`
- `49a50ff9c` — `fix(chat,connectors,runs,ui): UX原则回归修复（连接器授权与开关、话题对比度与移动端顶栏、输入法与反馈态）`
- `3cda258b9` — `fix(web): UX原则回归修复（飞书与团队设置、密钥与工作区弹窗、配置页与管理台一致性）`
- `5b62d97b0` — `fix(desktop,agents,machines): UX原则回归修复（桌面端自动更新与错误恢复、供应商表单保护与单主按钮）`
- `b4f538c3d` — `fix(server,protocol,daemon): UX原则回归修复（作品接口与通知跳转、CLI删除确认、群事件与双语术语）`
- `89a146d1a` — `fix(artifacts,desktop,machines): 修复 Codex diff 审查指出的 4 处边界问题`

---

## 本轮已修清单

### 一、作品、产物、预览与工作台（Slice A）

| 编号 | 页面/模块 | 违反原则 | 现象 | 改法 | 验收标准 |
| :--- | :--- | :---: | :--- | :--- | :--- |
| `U-01` | 作品页 / `ArtifactTab` | #1, #3, #8 | 新建空作品（`!head`）渲染死胡同提示，未挂载画布栏与输入框 | 空原型作品直接挂载 `.art-main`、`PageRail`、`EmptyState` 与 `CanvasComposer`，保留侧栏展开入口 | Playwright 新建作品直接可输入首条创作指令 |
| `U-02` | 作品 / 产物 / 设计系统 | #3, #4, #8 | 独立作品与外部协作者不在 `groups` 中，Bot 解析为空并显示「群里没有 Bot」 | 回退 `ownBot`/`useArtifactBots()` 与 `useWorkspace.bots`；统一文案为「暂无可用 Bot」 | 独立作品与外协打开画布、批注、设计系统均正确显示 Bot |
| `U-03` | `ShareDialog` / `QrDialog` | #1, #4, #8 | 独立作品创建者无法开启公开分享或查看二维码，且露出「本群」选项 | `useShareAccess` 放行 `createdBy === me` 与 `canManage`；`works` 隐藏「本群」 | 独立作品创建者可直接切换「开启分享」，单测覆盖 |
| `U-05` | `NewWork` / `CanvasBotPicker` | #1, #4, #8 | 中文报错硬编码特定 Bot 名称；默认未优先在线 Bot；切换作品未重同步 | 统一 `Bot` 术语并移除不存在的「联系管理员配置」；优先在线 Bot、空态禁用、切换 `artifactId` 重同步 | 中英文报错无硬编码人名；切换作品自动同步默认 Bot |
| `U-15` | `WorksPage` / `WorkEditor` | #2, #4, #8 | 作品卡片泄露隐藏群名「作品空间」；工具栏叠两层；筛选器与弹窗仍写「群聊」 | 隐藏「作品空间」且无多余 `·`；合并单层工具栏；统一「全部来源 / 独立作品 / 发送到群」 | 卡片无「作品空间」，编辑页仅 1 个顶栏，`ShareToChatDialog` 用词为「群」 |
| `L-1` | `WorkEditor` / `ArtifactTab` | #2, #7 | 空作品（`!head`）时「发送到群」与蓝色「分享」仍可点击 | `!head` 时禁用两按钮并附带提示「生成第一版后可发送到群 / 可分享」 | Playwright 验证空作品两按钮 `disabled` 且 tooltip 正确 |
| `L-2` | `WorksPage`（`works.css`） | #8 | `.works__badge--creator` 胶囊撑宽约 180px | 修正样式顺序并加 `width: fit-content` | 创作者胶囊紧贴内容（约 61px） |
| `U-16` | `RulesPanel` / `PromptComposer` / `ThreadsSidebar` | #4, #7 | 删除规则、自定义指令与批注单击直接销毁无保护 | 规则删除改为即时删 +「撤销」Toast；自定义指令与批注接入 `ConfirmActionDialog` | 单测验证删除前弹确认或撤销恢复（配合 `CX-1`/`CX-3`） |
| `U-17` | `ArtifactMembers` | #5, #6, #8 | 协作者列表缺加载态、吞掉加载失败错误；无候选人时权限下拉仍可用 | 补 `<Spinner>` 与 `<Alert onRetry>`；无候选人时禁用权限选择器 | 加载失败显示重试并可恢复，0 候选人权限禁用 |
| `U-18` | `ArtifactShell` / `AnnotationsPanel` | #5, #6 | 批注新建/回复失败吞错误导致清草稿；面板缺加载/提交锁 | 改为返回 `Promise<boolean>`，失败保留草稿；补充发送与保存锁 | 接口失败草稿不丢失，单测覆盖 |
| `U-19` | `PreviewActions` / `PreviewsView` / `PluginLayer` | #2, #4, #5, #7, #8 | 离线/停止预览仍显示「打开/重新截图/托管」；插件/预览缺错误重试与提交锁 | 按状态隐藏不可用操作；补 `<Alert onRetry>`、删除确认与 `loading` | 离线预览仅展示合理操作，失败可重试 |
| `U-20` | `PageRail` / `CanvasPageChips` / `PrototypeEditor` | #4, #6, #8 | 单页/文件夹筛选缺少清除入口；重命名回车缺 Safari IME 保护 | `CanvasPageChips` 补清除按钮与 `PagePill`；`PageRail` 补 Safari `keyCode === 229` 防护 | 点击清除返回全部页面；拼音选词回车不误提交 |
| `U-21` | `WorksPage` / `DiffPane` / `FileViewer` / `ExportPanel` | #5, #8 | 空态文案过时；Diff/文件/导出加载失败缺重试入口 | 更新空态引导；各错误 `<Alert>` 接入 `onRetry` | `DiffPane` 等点击「重试」重新拉取数据 |
| `U-51` | 预览 / 工作台词典 | #2, #4 | 残留已下线的「桌面应用 / 小程序」废弃词条与分支 | 清理无效词条与死分支 | 词典无死项，类型检查与占位符单测通过 |
| `U-52` | `WebTab` / `PageTab` / `FilesTab` | #1, #2, #3, #4 | 已停止网页缺「重新启动」；离线点样式不统一；首载白屏 | 补「重新启动」、Pane 空心离线灰环与 `<Spinner>` | 停止态可一键重启，状态指示与全局一致 |
| `U-53` | `ImportDesignDialog` / `VariationsDialog` / `AddLinkDialog` / `NewTabMenu` | #5, #6, #8 | 提交中未锁定取消/关闭；`NewTabMenu` 缺网址校验提示 | 补 `loading`/`busy` 关闭锁；`NewTabMenu` 补 inline 网址校验错误 | 提交中无法误关，非法 URL 立即内联提示 |
| `U-54` | 作品/产物/预览/Diff/文件 CSS | #4, #8 | 可读时间戳、元数据误用 `--label-tertiary`（对比度 ~2:1） | 提升为 `--label-secondary` | 亮/暗模式下时间戳对比度 ≥ 4.5:1（实测 5.32:1） |

### 二、聊天、连接器、运行态、通知、定时任务与公共 UI（Slice B）

| 编号 | 页面/模块 | 违反原则 | 现象 | 改法 | 验收标准 |
| :--- | :--- | :---: | :--- | :--- | :--- |
| `U-04` | `MessageComposer`（画布态） | #2, #4 | 接入 `CanvasBotPicker` 时误删 `<RunConfigChips>`，画布无法选模型/思考深度 | 在 `canvasChat` 恢复 `<RunConfigChips>` 与 `<CanvasBotPicker>` 并排显示 | Playwright 与单测均可见模型/思考深度选择器 |
| `U-06` | `CliConnect` | #1, #3, #8 | 电脑已连接但缺业务域权限（`missing_scope`）时，弹窗不展示授权入口 | 放宽 `!domains.length` 条件，在就绪电脑上展示缺失权限说明与「补充授权」按钮 | Playwright 点击缺权连接器可见「补充授权」 |
| `U-07` | `ChatPage` / `ConnectorDialog` | #1, #3, #8 | 点击「授权即将过期」通知携带 `?connector=` 无法可靠打开弹窗，刷新后重复弹出 | 待连接器数据加载后再打开对应弹窗，并 `navigate(..., { replace: true })` 清除参数 | 点击通知直达弹窗，刷新不再重复弹出 |
| `U-08` | `ConnectorMenu` | #2, #7 | 非电脑主人对未就绪 CLI 连接器仍看到可切换的 `<Switch>` | 非就绪 CLI 行隐藏 `<Switch>`，就绪切换补 `loading` 状态 | Playwright 验证未就绪行 `hasSwitch: false` |
| `U-22` | 话题胶囊（`ChatView` / `threadSummary`） | #8 | 暗色模式下直接用头像色做文字，对比度仅 3.4:1 且鼠标指针为默认箭头 | 改用高对比 `--thread-text`、`cursor: pointer` 与触控热区 | Playwright 实测暗色 9.68:1（AAA）、亮色 5.94:1（AA） |
| `U-23` | 聊天顶栏（移动端 & 无障碍） | #2, #8 | 390px 移动端「话题」文字挤窄群标题；`aria-label` 未读数缺失 | 窄屏隐藏文字仅保留图标+红点，补 `aria-label="话题，{n} 个未读"` | 390px 顶栏标题不挤压，屏幕阅读器可读未读数 |
| `U-24` | `ConnectorDialog` | #6, #7 | CLI 安装/扫码进行中点击遮罩或 Esc 直接中断且无确认 | CLI 运行期间锁定关闭并在取消时弹 `AlertDialog` 确认 | 进行中误点遮罩不会静默中断授权流程 |
| `U-25` | `CliConnect` | #1, #2, #8 | 多机部分就绪时按钮/报错未指明电脑名，检测失败无重试 | 按电脑名明确检测/退出对象，补检测重试与未就绪 Bot 提示 | 多机提示清晰指明目标电脑与未就绪原因 |
| `U-26` | `ConnectorCardView` | #8 | 群内连接器卡片对非主人丢失发起 Bot 与电脑主人姓名 | 从 `meta.i18n.params` / `body` 展示 Bot 名与「等待电脑主人 {owner} 连接」 | 群成员一眼看出哪个 Bot 在等哪位成员连接 |
| `U-27` | `MessageComposer` / `ui/im/composer` | #5, #6 | 连接器菜单打开时点表情无反应，输入 `@`/`/` 在菜单后触发隐藏候选 | 打开表情或输入时先关闭 `ConnectorMenu`，菜单开启时拦截候选快捷键 | Playwright 点表情即关连接器菜单并开表情面板 |
| `U-28` | `ThreadView` / `useTimeline` | #5, #8 | 加载更早回复失败永久停滞；根消息被删后永远转圈 | 失败渲染「加载更早回复失败 + 重试」；无根消息显示空态「话题不存在或已删除」 | 断网与删根消息均无死循环加载 |
| `U-29` | `MessageActions` / `PinnedMessages` | #4, #5, #7 | 菜单「取消置顶」无确认与 Toast；「分支到新聊天」连点建重复群 | 统一取消置顶确认框与置顶/取消 Toast；补 `loading` 与 `branching` 锁 | 置顶/取消反馈统一，连点不重复建群 |
| `U-30` | `MessageEditor` / `ui/fields.tsx` | #6 | Safari 拼音回车误提交编辑；`TokenField` 按 Esc 清空草稿且关弹窗 | 补 Safari `compositionend` + `keyCode === 229` 防护；`TokenField` Esc 仅关下拉不清字 | 单测覆盖 Safari IME 与 `TokenField` Esc 行为 |
| `U-31` | `NotificationPanel` / `NotificationSettings` / `Sidebar` | #4, #5, #6 | 通知抽屉缺焦点陷阱与重试；退出频道弹窗在请求前关闭 | 补 `useFocusTrap`/`aria-modal`/删除锁/重试；退出群改用 `ConfirmActionDialog` | 失败不提前关闭确认框，通知抽屉键盘可闭环 |
| `U-32` | `ChatPage` / `AppShell` | #8 | 首页加载期误显空态；桌面隐藏侧栏时漏掉离线横幅 | 补加载态与错误重试；侧栏隐藏时保留离线提示横幅 | 首载不再闪空态，断网提示始终可见 |
| `U-33` | 聊天/连接器/运行/通知/定时 CSS | #8 | 9 个 CSS 文件可读文字误用 `--label-tertiary` | 统一提升为 `--label-secondary` | 亮/暗模式下元数据均满足 AA 对比度 |
| `U-55` | `ConnectorDialog` / `ConnectorCardView` | #2, #4, #8 | 弹窗标题恒写「连接」；已连态仍显示禁用「去试试」；缺密钥长度提示 | 按状态动态标题、隐藏无用按钮、统一「他人电脑」与长度说明 | 文案贴合当前连接状态，无死按钮 |
| `U-56` | `ApprovalBlock` / `QuestionBlock` | #4, #7 | 非审批人仍看到操作按钮；「更多」与选项缺提交锁（保留「本次运行免审批」在更多菜单） | 非审批人隐藏操作按钮，补 `loading` 与 `leaningKey` 锁 | 非审批人界面干净，连点不重复提交 |
| `U-57` | `runs/*` | #5 | `IssueBanner`/`ProcessView` 重试缺 `loading`；英文 `agent` 未大写、缺词条 | 补 `loading` 锁，统一 `Agent` 大写并补全 `runs/en.ts` | 操作态清晰，中英术语一致 |
| `U-58` | `LaterPage` / 收件箱 | #4, #5 | 按钮内嵌非法交互结构；滚动列表下拉缺 `portal`；改提醒无 Toast | 修复 DOM 结构、补 `portal` 与「已更新提醒」Toast | 列表末行菜单不裁切，修改有明确回应 |
| `U-59` | `NotificationSettings` / `RunConfigChips` / `GroupInfo` | #4, #5 | 开关切换缺 `loading`；私聊话题开关文案含混 | 开关补 `loading` 状态；私聊文案明确说明「Bot 的回复放进这条消息的话题，主时间线更清爽」 | 切换中防连点，私聊/群聊说明准确 |
| `U-60` | `MachineSidebar` / `NotFound` / `ConfirmActionDialog` | #4, #8 | 离线点实心灰；404 用原始 `<a>` 整页刷新；空 `consequences` 仍渲染空 `<ul>` | 统一空心离线灰环；404 改用 `useNavigate`+`<Button>`+`DeniedArt`；空列表省略 `<ul>` | 404 点「返回消息」SPA 跳转，无多余空列表 |
| `L-3` | `ui/nav-rail.css` | #8 | 侧轨「通知」红点与上方「电脑与 Bot」文字重叠 | 调整红点间距与偏移 | Playwright 实测净间距 +6px，零重叠 |
| `L-4` | `chat.css` / `timeline.css` | #8 | 移动端 Git 栏右侧硬截断；吸顶日期胶囊与消息头像打架 | Git 栏补右侧渐变遮罩，调整吸顶日期外边距 | 390px 亮/暗模式下横条与吸顶日期清晰 |
| `L-5` | `connectors.css` | #8 | 连接器玻璃浮层过透，底层卡片文字透出干扰阅读 | 切换为 `--glass-fill-thick` 材质 | 亮/暗模式下浮层清晰可读 |
| `L-6` | `ui/table.tsx` / `ui/table.css` / `admin/{Users,Teams}Page` | #4, #8 | 空单元格混用 `--` 且行尾 `···` 操作按钮过淡 | 空值统一 Pane 规范破折号 `—`，提升 `···` 对比度 | 后台列表空值统一为 `—`，操作入口清晰 |
| `A-1` | `ScheduleCard` | #2, #5, #7 | 加载完成后仍重复显示回退文案；停用/立即执行缺锁与 Toast；删除紧挨编辑 | 移除重复回退行，补 `busyOp`/`loading` 与触发 Toast，删除右置分隔 | 卡片精简，操作反馈明确且防误删 |
| `A-3` | `connectors.css` | #4, #8 | 空闲/未连接状态点为实心灰，与其他页面空心环不一致 | 改为 `1.5px` `--system-gray` 空心环 | 全站离线/未连指示灯统一 |
| `A-4` | `MachineSidebar` | #2, #4 | 仅 1 台电脑时顶栏与电脑下方 120px 内重复出现两个「+ 新建 Bot」 | 仅当 `machines.length > 1` 时显示顶栏入口 | 单机用户只看到 1 个「+ 新建 Bot」 |
| `A-5` | `ScheduleTag` | #8 | 仅显示图标+数字，含义不自明 | 桌面端展示「定时任务 {n}」，窄屏自动折叠 | 桌面端一眼看懂芯片含义 |

### 三、飞书、团队/群、密钥、工作区、配置、Git/同步与管理台（Slice C）

| 编号 | 页面/模块 | 违反原则 | 现象 | 改法 | 验收标准 |
| :--- | :--- | :---: | :--- | :--- | :--- |
| `U-09` | `FeishuAppForm` / `FeishuAppSteps` / `FeishuScanDialog` | #5, #7, #8 | 飞书应用加载失败被吞掉，误渲染空白创建表单诱发误配置 | 透传 `loading`/`error`，加载期显示 `<Spinner>`，失败显示 `<Alert title="飞书应用加载失败" onRetry>` 并隐藏表单 | 加载失败不再出现假未配置表单，重试可恢复 |
| `U-12` | `TeamAdminTabs` / `TeamSettingsDialog` | #5, #6, #7 | 参数/新人引导页吞错误且切 Tab 静默丢未保存改动；无改动时保存按钮仍可点 | 4 个 Tab 补 `<Alert onRetry>`；接入 `onDirtyChange`/`onSavingChange`、保存后刷新、无改动禁用保存 | Playwright 改参数后切 Tab 弹出未保存确认框 |
| `U-36` | `SidebarDialogs` | #5, #7 | 浏览频道失败仅 Toast 卡死加载态；分区名弹窗缺遮罩锁、提交锁与 Safari IME 防护 | 补 `<Alert onRetry>`、`closeOnBackdrop={false}`、`busy` 锁、IME 防护与删除 `loading` | 加载失败可重试，拼音选词不误提交 |
| `U-37` | `TerminalSpacePage` | #5, #7 | 删除终端用普通 `<Dialog>` 可点遮罩关闭且缺 Toast；重命名缺 IME 与提交锁 | 删除改为 `ConfirmActionDialog` +「终端已删除」Toast；重命名补 `closeOnBackdrop={false}`/`loading`/IME 锁 | 终端删除需明确确认且有完成提示 |
| `U-38` | `FeishuScanDialog` | #5, #8 | 首次创建扫码会话失败时无重试入口、加载中缺指示器 | 补 `<Spinner>` 与错误 `<Alert onRetry={start}>` | 注册失败可直接点重试重新生成二维码 |
| `U-39` | `SecretLayer` / `MySecrets` | #4, #5, #7 | 密钥加载失败无重试；开关无单行锁；填写弹窗缺未保存离开保护与长度校验 | 补 `onRetry`、`variant="ghost"`、`togglingId` 锁、`useDiscardGuard`、`<Form>` 与内联「至少 8 个字符」提示 | 表单受保护，非法输入内联拦截 |
| `U-40` | `WebhooksView` / `ChangePasswordPage` / `NewBotDialog` / `TeamSwitcher` | #5, #7, #8 | 轮换 Webhook 密钥用普通弹窗；改密/建 Bot/建团队缺提交锁或草稿保护；加团队链接校验缺内联提示 | 轮换改 `AlertDialog`；统一 `busy`/`loading`/`useDiscardGuard`；加团队无效链接内联提示 | 关键弹窗提交中不可误关，草稿有离页保护 |
| `U-41` | `WorkspacePicker` / `DirPicker` | #5, #7 | 快捷工作区与跨仓库确认缺 `busy` 锁；目录加载失败缺重试；新建文件夹回车缺 IME 防护 | 全路径加 `busy` 锁、`DirPicker` 补 `onRetry` 与 Safari IME 防护 | 连点不会重复绑定目录，加载失败可重试 |
| `U-42` | `ConfigPage` / `InheritedList` / `GroupConfigView` | #2, #5 | 配置页露出永久禁用的「团队层/群层」与无效「指令」Tab；开关与加载缺锁/重试 | 移除无效与永久禁用 Tab；补 `togglingName` 锁、`<Spinner>` 与 `onRetry` | Playwright `/admin/config` 仅展示 5 个有效 Tab |
| `U-43` | `AddTabDialog` / `CommitView` / `StashView` | #5, #8 | 知识库标签、Git 提交与暂存区加载失败无重试入口 | 补 `<Spinner>` 与 `<Alert onRetry>` | 错误态均可原地重试 |
| `U-61` | `FeishuAppForm` | #4 | 「更换/取消」顺序相反；存在多个并发蓝色主按钮 | 统一 `[取消] [更换]` 顺序并保证同屏最多 1 个 `primary` 按钮 | 按钮顺序与视觉主次符合 Pane 规范 |
| `U-62` | 管理/团队/市场/工作区/配置/Git/同步 | #2, #4, #8 | 混用「平台管理员」、小写 `agent`/`skill`、「托管目录」及陈述句确认标题 | 统一「系统管理员」「使用托管工作区」「Agent/Skill」及「要……吗？」问句确认标题 | 术语与确认句式全模块一致 |
| `U-63` | 用量/Bot/Git/飞书/工作区/设置 CSS | #4, #8 | 12 处可读元数据使用 `--label-tertiary` | 统一提升为 `--label-secondary` | 所有可读副文满足对比度要求 |
| `U-64` | 知识库/Git/团队/账号/Bot/同步/群公告 | #2, #5, #8 | 5 处 `MenuButton` 缺 `portal`；Bot/同步缺提交锁；共享与移公告缺成功 Toast | 补 `portal`、提交锁与完成 Toast | 菜单不被滚动容器裁切，操作有即时反馈 |

### 四、桌面端、电脑与 Agent / 供应商（Slice D）

| 编号 | 页面/模块 | 违反原则 | 现象 | 改法 | 验收标准 |
| :--- | :--- | :---: | :--- | :--- | :--- |
| `U-10` | `AgentsPanel` / `ProvidersPanel`（Web+Desktop 共享） | #4, #5, #8 | 加载失败无重试陷入死胡同；同屏出现 4 个蓝色主按钮竞争焦点 | 补错误 `<Alert onRetry>`；「全部升级」出现时其余按钮降级为默认态，保证单主按钮 | Playwright 验证同屏仅 1 个 `primary` 按钮 |
| `U-11` | `ProviderEditor` / `ProviderImports`（Web+Desktop 共享） | #1, #4, #5, #6, #7, #8 | 供应商表单无未保存离开保护；默认配置中 `--settings` 深藏高级折叠且提交缺锁 | 接入 `useDiscardGuard`、`busy` 锁；默认项仅提升 `ArgsRow` 保持其余高级折叠；拆分 `ProviderEditorParts.tsx` 控体积 | 表单离页弹保护框，`check-size` 零超限 |
| `U-13` | Desktop `updater.ts` / `UpdateBanner` | #5, #6 | 自动更新重启可能打断正在编辑的弹窗或未保存草稿，提示语偏长 | 精简文案为「v{v} 已就绪，任务结束且空闲 1 分钟后自动更新」；存在打开弹窗或未保存草稿时阻止自动重启 | Desktop 单测验证有弹窗/草稿时不触发重启 |
| `U-34` | `AdminPanels`（`WorkspacesPanel`） | #5, #7 | 批量删除工作区使用普通 `<Dialog>`，缺提交锁且 0 可删时仍显禁用红色按钮（含 `U-64`） | 改用严格确认流、`deleting` 锁，并在无任何可删工作区时隐藏删除按钮 | 无可删项不露出死按钮，删除中不可重复提交 |
| `U-35` | `PluginTrustsPanel` | #5, #7 | 点击「拒绝」时让「允许」主按钮转圈；确认态缺独立操作锁 | 按操作类型区分 `busy` 状态，分别锁定对应按钮 | 拒绝仅旋转拒绝按钮，不误导用户 |
| `U-43†` | `GitAccessPanel` | #5, #8 | Git 访问面板加载失败缺少 `onRetry` | `<Alert>` 接入 `onRetry={loaded.reload}` | 失败可一键重试 |
| `U-44` | Desktop `Settings.tsx` | #5, #8 | `ipc.settings()` 失败无错误态与重试，页面永久空白/失效 | 补错误状态与 `<Alert onRetry>` | IPC 失败展示重试并可恢复 |
| `U-45` | Desktop `Overview.tsx` | #1, #8 | `ipc.tools()` 加载中误把 `agents=[]` 当成未安装；屏蔽告警吞错误 | 加载态显示占位 `—` 而非假空态，透出 `BlockedAlert` 错误 | Desktop 单测验证加载中不闪假空态 |
| `U-46` | Desktop `Onboarding.tsx` | #5, #7, #8 | 引导表单缺 `<Form onSubmit>` 与提交按钮 `loading` | 补表单回车提交与 `loading` 锁 | 引导页键盘回车可用且防连点 |
| `U-47` | Desktop `Logs` / `Market` / `RunDetail` | #5, #8 | 诊断/轮询失败伪装为空态且无重试 | 区分失败态与空态，统一补 `<Alert onRetry>` | Desktop 单测覆盖 4 页错误恢复 |
| `A-2` | `MachinePage` / `AdminMachinePage` | #5, #7, #8 | 不可逆「解绑电脑」紧挨常用「终端」；管理端机器页首载返回 `null` 白屏且错无重试 | 「解绑电脑…」移入 `···` 更多操作破坏项；管理页补 `<Spinner>` 与 `onRetry` | Playwright 与单测验证解绑已移入溢出菜单 |
| `U-61†` | `GitAccessPanel` | #4 | 存在并列主按钮与操作顺序不统一 | 统一单主按钮与取消/确认顺序 | 符合 Pane 按钮层级规范 |
| `U-62†` | `AdminPanels` | #2, #4, #8 | 残留旧版实时画面投屏废弃提示 | 清理废弃文案（旧 daemon 枚举过滤见 `CX-4`） | 无过时功能文案 |
| `U-65` | Desktop `Workspaces` / `Tunnels` / `unbind` | #4, #7 | 可删工作区行缺「打开」操作；解绑/删除确认细节不一致 | 补「打开」按钮并统一确认文案与按钮层级 | 桌面端工作区操作一致 |
| `U-66†` | `AgentDetail` / Desktop 导航与诊断 / `src-tauri/i18n.rs` | #4, #8 | 暴露内部 `ACP` 术语、`git` 未大写、英文目录词不统一 | 改用「适配器 / CLI 内置适配器」、大写 `Git`、统一 `local folders` | Tauri Rust `i18n` 与 Desktop 单测全绿 |
| `U-67†` | Desktop `TitleBar` / `desktop.css` | #4, #8 | 标题栏离线点为实心灰 | 改为 Pane 规范 `1.5px` `--system-gray` 空心环 | 桌面端与 Web 离线指示一致 |
| `A-6` | `ProvidersPanel` / `machines/en.ts` | #4, #8 | 副标题中文缺宾语且英文 `agent` 未大写 | 补全「各 Agent 可在详情里选用匹配的供应商」并大写 `Agent` | 中英文语义完整规范 |

### 五、服务端、协议与 Rust CLI/Daemon（Slice E）

| 编号 | 页面/模块 | 违反原则 | 现象 | 改法 | 验收标准 |
| :--- | :--- | :---: | :--- | :--- | :--- |
| `U-02†`/`U-03†`/`U-05†` | `apps/server` 作品接口 & 词典 | #1, #3, #4, #8 | 独立作品 Bot 校验报错含硬编码人名；外协与创建者权限判断不全 | 统一无硬编码的「这个 Bot 暂不支持创作作品，请从列表里选择可用的 Bot」并对齐权限与 i18n | Server/Protocol 单测与类型检查全绿 |
| `U-07†` | `packages/protocol/src/notification-view.ts` | #1, #3, #8 | 连接器过期通知未携带稳定跳转参数 | 规范通知跳转链接 `?connector=` 生成逻辑并补单测 | `notification-view.test.ts` 全绿 |
| `U-14` | `crates/gonggong`（`gg workspaces --delete`） | #4, #7 | CLI 删除工作区不经交互确认直接删除全部匹配项 | 非 `--yes` 时先列出受影响工作区并要求交互确认，非 TTY 明确提示需 `--yes` | `cargo test --workspace` 全绿 |
| `U-48` | `crates/gonggong/src/connectors/` & `server` | #4, #8 | 连接器错误透出底层 OAuth 码（`expired_token` / `access_denied`） | 映射为人话中文与英文（如「已取消授权，需要时可重新连接」） | 中英文错误均无内部错误码泄漏 |
| `U-49` | `crates/gonggong` / `server` 群事件 | #4, #8 | 运行中修改工作区提示选项生硬，缺多语言键 | 精修为「现在就改 / 等运行结束再改」并同步英文词典 | 群事件中英切换准确 |
| `U-50` | `apps/server` & `packages/protocol` Zod 校验 | #4, #8 | 英文词典混入中文「共工」；daemon 鉴权与 protocol Zod 报错为裸英文或内部字段 | 清理中文泄漏，补全 `daemon/auth.ts` 与 `secrets`/`plugins`/`artifact-*` 中文校验文案 | `i18nPlaceholders.test.ts` 与 `ux-slice-e.test.ts` 全绿 |
| `U-66` | `crates/gonggong/src/**` & `i18n/en.rs` | #4, #8 | Rust CLI/Daemon 报错泄漏 `{reason:?}`、`daemon` 内部词与未翻译提示 | 全部改为用户可理解的「电脑客户端」等术语并补全 `en.rs` | `cargo test --workspace`（含 i18n 全覆盖扫描）全绿 |
| `U-67` | `apps/server/src/i18n/en.ts` & `packages/protocol/src/i18n-en.ts` | #4, #8 | 英文仍混用 `machine`/`DM` 而非规范词 `computer`/`direct chat` | 统一对齐术语表（保留历史 `postEvent` 兼容键） | Protocol 531/531 测试全绿 |

---

## Gemini（`agy`）顾问采纳与取舍记录

### 1. 采纳的 10 项改法与文案精修
| 目标 | 切片 | 采纳内容 |
| :--- | :---: | :--- |
| `U-16`（`RulesPanel`） | A | 删除规则采用即时删除 +「撤销」Toast，避免轻量列表操作被模态框打断（`PromptComposer`、`ThreadsSidebar` 保持 `ConfirmActionDialog`） |
| `U-11`（`ProviderEditor`） | D | 默认供应商仅把 `ArgsRow`（`--settings`）提到外层，其余低频高级项继续保持折叠（#2） |
| `U-10`（`AgentsPanel` + `ProvidersPanel`） | D | 「全部升级」出现时同步降级 `ProvidersPanel` 的「新增…」按钮，确保整页最多 1 个主按钮 |
| `U-56`（`ApprovalBlock`） | B | 保持「本次运行免审批」在「更多」菜单中并加 `loading`，不额外插对话中途确认框（#6） |
| `U-64`（`AdminPanels`） | D | 可删工作区为 0 时直接隐藏「删除所选」，不留禁用红按钮（#2） |
| `U-02` / `U-05` | A, B, E | 统一用词 **`Bot`**（不混用 `AI`），移除不存在的「联系管理员配置」，改为明确可选指引 |
| `U-15`（作品） | A | 统一用词 **`群`**（不用「群聊」）：「发送到群」「全部来源 / 独立作品」，无群名时去掉前导 `·` |
| `U-13`（桌面自动更新） | D | 精简文案为「v{v} 已就绪，任务结束且空闲 1 分钟后自动更新」，且弹窗打开或表单脏态即阻止自动重启 |
| `U-07`（`?connector=`） | B | 连接器数据加载后弹出对话框并立即 `navigate(..., { replace: true })` 去掉 URL 参数 |
| `U-25` / `U-48` / `U-49` / `U-50` | B, E | 统一中英文句式：多机缺权提示、取消授权提示、`现在就改 / 等运行结束再改`、电脑凭据失效提示 |

### 2. 采纳的 6 项新增发现
- 全部 6 项均已纳入本轮修复并验收通过：**`A-1`**（`ScheduleCard` 精简/提交锁/删除分隔）、**`A-2`**（`MachinePage` 解绑移入 `···` 溢出菜单 + 管理页加载重试）、**`A-3`**（连接器空心灰环统一）、**`A-4`**（单机去重顶栏 `+ 新建 Bot`）、**`A-5`**（桌面端 `ScheduleTag` 显示「定时任务 {n}」）、**`A-6`**（供应商副标题补全宾语与 `Agent` 大写）。

### 3. 延后的 2 项建议与理由
- **`B-6`（`GroupNotice.tsx` / `PinnedMessages.tsx` 顶栏 `×` 改文字按钮）**：**延后** — 两处均已接确认框防误触，390px 移动端单行横幅改文字按钮容易拥挤，需结合 `PinnedBanner` 原型统一评估。
- **`B-7`（`TeamSettingsDialog.tsx` 15 个 Tab 分 3 组重构）**：**延后** — 属于信息架构与原型层调整，放在独立 PR 经原型确认后再做，避免与本轮 P0 `U-12` 脏态保护耦合。

---

## GPT（`codex exec`）审查结论与修复记录

对 `git diff gitlab/main...HEAD`（303 文件）执行只读深度审查，共发现 **4 项真实问题（0 项误报）**，已全部转入定向修复并补充 TDD 回归测试：

| 编号 | 级别 | 归属 | 位置 | 问题与复现 | 修复与验收标准 |
| :--- | :---: | :---: | :--- | :--- | :--- |
| `CX-1` | P2 | Slice A | `RulesPanel.tsx:321-331`, `canvasRules.tsx:334` | 删除规则的 Toast 回调捕获删除前 `onSaveRules`（携带旧 `head`），点击「撤销」时服务端三方合并误判相对旧基线无变更，导致规则未恢复 | 通过 `useRef` 调用最新 `onSaveRules` 且保存链读取当前 `head` ref；TDD 验证 `v1 → v2` 删除后点撤销基于 `v2` 成功恢复 |
| `CX-2` | P2 | Slice D | `desktop/pages/Settings.tsx:72-87`, `machines/MirrorRows.tsx:42-56` | 自动保存用 `key === sent.current \|\| key === inflight.current` 去重：`A → B` 保存未完成时改回 `A`，因命中旧 `sent.current` 被跳过，最终界面显示 `A` 但持久化为 `B` | 改为对比 `inflight.current ?? sent.current` 并用 `queued` ref 串行队列在 `.finally()` 补发；双端 TDD 模拟 `A → B(pending) → A` 验证最终落盘为 `A` |
| `CX-3` | P2 | Slice A | `ThreadsSidebar.tsx:295-305`, `ArtifactShell.tsx:227-230` | `onDeleteThread` 用 `attempt()` 吞掉异常，导致接口失败时 `ConfirmActionDialog` 仍走成功分支关闭弹窗并弹出「已删除」 | `onDeleteThread` 失败时直接抛错，由 `ConfirmActionDialog` 留在当前框展示内联错误与重试；TDD 验证 reject 时弹窗不关、不弹成功 Toast |
| `CX-4` | P3 | Slice D | `AdminPanels.tsx:138-144, 175-185` | 删除 `CHECK_LABEL` 中 `screen_recording`/`accessibility` 映射但未过滤，旧版 daemon 上报时中文界面直接回退显示英文枚举名 | 在 `SelfChecks` 明确过滤废弃的 `screen_recording` 与 `accessibility` 项（原则 #2）；TDD 验证旧项不展示、现行检查项正常渲染 |

---

## 遗留待办（下轮优先）

| 页面 | 现象 | 改法 | 验收标准 |
| :--- | :--- | :--- | :--- |
| 作品创建（`packages/protocol/src/artifact-kind.ts`） | `ARTIFACT_BOT_NAMES` 仍通过硬编码白名单决定可创作作品的默认 Bot 名称，耦合特定环境命名 | 迁移为服务端团队/系统参数或 Bot 能力标记（capability flag），前端按服务端返回能力列表筛选 | 仓库中无硬编码 Bot 名称白名单；任意具备创作能力的 Bot 均可创建作品，现有作品单测全绿 |
| 团队设置弹窗（`TeamSettingsDialog.tsx`，原 `agy` B-7） | 左侧边栏平铺 15 个 Tab，缺少分组层级，扫描成本高 | 先更新原型确认 3 组分类（基础信息 / 协作资源 / 安全与集成），再按分组重排侧栏与键盘焦点流 | 15 项设置归入 3 个清晰分组，保留全部未保存切换保护与键盘可达性，管理端单测与 E2E 全绿 |
| 群公告 / 置顶横幅（`GroupNotice.tsx` / `PinnedMessages.tsx`，原 `agy` B-6） | 移除公告与取消置顶横幅按钮使用 `×` 图标，部分用户易误解为「仅收起横幅」而非「移除/取消置顶」 | 结合 `PinnedBanner` 原型评估桌面/390px 窄屏的图标语义（如 tooltip 强化、改用溢出菜单或明确文案），避免窄屏挤压 | 桌面与 390px 移动端横幅单行不换行、语义明确，且删除/取消置顶继续受确认框保护 |
| 历史 `UX走查记录.md` 遗留 & 桌面端实机走查 | `UX走查记录.md` 仍有少量低优 P2/P3 历史项（如已删 Bot 私聊英文标题、小样本统计百分比、定时任务草稿细节），且桌面端 Tauri 窗口本轮仅通过单测与共享 Web 验证 | 下轮安排真实本地 PG + Tauri 桌面端窗口实机走查，顺带收口 `UX走查记录.md` 剩余低优项并归档 | 桌面端 Tauri 真机亮/暗模式与关键流程截图验收通过，历史遗留项清零或明确闭环 |
