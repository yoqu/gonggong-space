# UX 走查记录

**只放未关闭的待办，关闭即移走**：每轮走查在下面追加一节（范围一行 + 待办）；待办修好后，把该条连同本轮「已修」「未判为缺陷」整理进 `docs/archive/<年月>/UX走查记录-<日期>.md`，这里删掉。往期全文：[11-09](../archive/2026-11/UX走查-2026-11-09.md)、[11-13 至 11-15](../archive/2026-11/UX走查记录-2026-11-13至15.md)、[11-20 第 2 轮](../archive/2026-11/UX走查记录-2026-11-20-2.md)。

每条：页面 · 现象 → 改法（验收）。环境与造数见记忆 ui-audit-real-data（真实库副本 `gonggong_audit`）。

## 11-09 遗留

- #1 已删除 Bot 的私信：侧栏仍有两条「已删除的 Bot」。
- #4 作废运行卡文案重复。
- #5 市场筛选。
- #7 离线机器缺下一步指引。
- #8 小样本「↓100%」：会话统计仍显示「↓100% 较前 30 天」。
- #10 群头部图标簇。

## 11-13 第 3 轮

- P2 工作台空态承诺「Git」但菜单里没有 → 有 Bot 但无可用 Git 时显示禁用的「Git 面板」项，副标题写原因（还没有工作区 / 机器离线）。
- P2 管理后台 › 群 把私聊当群列出，模式列全是「分区模式」 → 加「群 / 私聊」筛选默认只看群；模式只在非默认值时显示。
- P3 打开工作台时「全屏 ⌘⇧\」tooltip 自己弹出 → tooltip 只响应 `:focus-visible`（鼠标打开无 tooltip，Tab 聚焦仍显示）。
- P3 手机管理后台标题区三行、头像孤立 → 390 宽隐藏标题区头像，说明折成 1 行省略（标题区 ≤ 2 行）。

## 11-14 第 1 轮（英文界面、MCP 授权卡片）

- P2 已删除 Bot 的私聊标题英文仍是「已删除的 Bot」：`apps/server/src/modules/groups/title.ts` 把它写死进 SQL → 按请求语言翻译（`Accept-Language: en` 返回 Deleted bot）。
- P3 侧栏消息预览英文下用全角冒号：`groups/service.ts` 写死 `${author}：${line}` → server `t('{name}：{line}')`。
- P2 MCP 授权卡片按钮太多（桌面折两行）→ 只留「批准」「拒绝」+「更多」菜单（本次会话不再问 / 以后都允许 / 本次运行免审批），规则名用工具 title，「你是 Bot 主人」只在非主人时提示（436px 卡片按钮一行）。
- P3 英文导航标签折两行 → 导航用短标签「Machines」「Admin」（`#nav` 上下文后缀）。
- P3 历史群事件英文下仍是中文（写入时无 `meta.i18n`）→ 可选一次性回填脚本，不做也可接受。

## 11-14 第 2 轮（个人设置、⌘K、定时任务、知识库）

- P2 定时任务「创建」灰着不说缺什么 → 显示首个缺项；标签改「候选 Bot（至少选 1 个）」。
- P2 定时任务候选 Bot 不显示在线状态 → 胶囊加在线点 / 「离线」；全离线时提示「到点会跳过」。
- P3「仅一次」无默认时间和预览 → 默认下一个整点，显示「将在 … 执行」。
- P3 手机定时任务频率分段被截断 → 390 宽改 3×2 网格或下拉。
- P3「我的 Skill」空态与「我的密钥」风格不一 → 用 EmptyState，按钮居中。
- P3 ⌘K › 文件搜不到运行改过的文件（patch 过期清理后为空）→ 回退到运行保留的改动文件列表，或提示去「运行」里搜。
- P3 手机设置标签条最后一项被截断 → 两端渐隐遮罩，当前项滚入可见区。

## 11-15 第 1 轮（新 logo 登录页、团队设置、新建 Bot）

- P2 参数「留空沿用平台默认值」但清空不生效（`Stepper.commit` 遇空串还原）→ `Stepper` 可空，空串上报 `null`，表单视为删除覆盖（显示「继承平台值 N」）。
- P3 点登录后右侧表单先消失、空白片刻 → 跳转前保留表单，按钮「登录中…」。
- P3 新建 Bot：机器离线仍是绿色「创建后立即可用」→ 离线时改「创建后可拉入群」，中性色。
- P3 手机登录页只有 gg 图形没有产品名 → 图形右侧加「共工空间」字标。
- P3 新建 Bot「执行机器」机器名用等宽字体 → 改正文字体。
- P3 `/_ui` TOKENS 区缺品牌色 → 补 brand-blue / amber / ink / pupil 与 wash 一行。

## 11-15 第 2 轮（群聊消息与运行面板、Bot 详情、群设置子页、作品、市场、附件发送）

- P3 运行面板（过程已清理）：写「运行过程已过期，仅保留摘要」但面板里没有摘要 → 改「运行过程已过期，结果见聊天里的回复」，或在下方显示该轮最终回复。
- P3 运行面板错误横幅正文用等宽字体（「Bot 离线超过 30 分钟…」是中文说明不是日志）→ 只有原始错误输出用等宽，说明文字用正文字体。
- P3 运行标签页：状态图标（圈×，作废/失败）紧挨关闭 ×，像两个关闭按钮 → 失败/作废状态改用感叹号或色点。
- P3 群头部 Bot 胶囊「待绑定」与下方横幅「还没有选工作区」重复且用词不一 → 胶囊改「未选工作区」，横幅关闭前胶囊不再重复提示。
- P3 作品「已共享」为空时显示「没有符合条件的作品 / 清除筛选」→ 分段标签不是筛选：写「你共享给团队或公开的作品会出现在这里」，不给「清除筛选」。
- P3 附件 `.txt` 类型名叫「文本日志」（`attachments/api.ts`）→ 改「文本」；输入框附件提示「写入工作区 .gonggong/attachments/，不进 git」对非开发者是术语 → 改「Bot 能读到这些文件」，路径放 tooltip。

## 11-16 第 1 轮（Bot 在线角标与离线提示、新对话、Bot 名片简介、机器详情、私聊）

已修：Bot 名片简介把「# 角色」「- 列表」「**粗体**」去成「角色 你是 CC专家 ，… - 先读」→ 标题接「：」、去列表与强调符号不留空格、中文标点后不留空格，`snake_case` 不再被拆；`@所有人` 时输入框提示「未 @ 的消息不会触发 Bot」→ 改「@所有人 只通知成员，不会触发 Bot」。

- P2 群头部 Bot 胶囊不显示在线状态：Bot 全部离线时顶栏仍是「CC专家 main 未提交」，与头像角标、私聊副标题不一致（`chat/GitBar.tsx` `Item` 只看工作区状态）→ 名字前加与头像同映射的状态点（离线灰环、agent 缺失橙、运行中蓝），`title`/`aria-label` 带状态（验收：机器离线时胶囊有灰环，读屏读出「CC专家（离线）」）。
- P2 胶囊「···」菜单按钮 22×22、图标近乎看不见（截图只剩两个淡点），却承载「新对话 / 查看改动 / 浏览文件 / Git 面板」→ 图标加深到 `--text-secondary`，悬停底色；手机热区 ≥ 32px（验收：1440 与 390 下肉眼可辨，触屏点得中）。
- P3 手机点 Bot 名字：名片与消息悬停工具条同时出现，工具条压住上一条消息的 @ 链接 → 触屏打开名片时不显示该消息的悬停工具条（验收：390 触屏点名字只见名片）。
- P3 名片靠按钮聚焦触发，iOS Safari 点按钮不聚焦，真机可能点不开 → `HoverCardTrigger` 在 `pointer: coarse` 下改为 onClick 切换（验收：iPhone Safari 点 Bot 名字出名片）。
- P3 机器详情离线时只写「最后在线 2026/10/8 17:38:10」→ 顶部「机器离线」后加相对时长（「已离线 38 天」），绝对时间放 tooltip（验收：离线机器概览首屏可见离线时长）。
- P3 新对话发出原样「/new @CC专家」用户消息，紧跟事件「CC专家 下一轮将开新会话」，一件事两行 → 由按钮发起的 /new 只留事件行（或把用户消息折进事件「系统管理员 让 CC专家 开新会话」）（验收：点「新对话」后消息流只多一行）。

## 11-16 第 2 轮（工作台：改动、文件浏览与预览、Git 面板提交/日志/贮藏/分支、推送；桌面 1440 + 深色 + 390 触屏，真实 daemon + 本地目录工作区）

已修：文件搜索结果整条路径尾部截断（十几条都显示成「apps/server/plugins/official/sli…」）→ 文件名为主、所在目录灰字从开头截断；文件树「未提交」字母 M 对新建文件与文件夹也显示 → 改为圆点；README 内嵌 HTML（`<p align="center"><img>`、徽章）原样显示成源码 → 文档预览启用 rehype-raw + rehype-sanitize（仅文件预览，聊天消息不渲染 HTML）。

- P2 推送对话框：未绑定仓库的群（本地目录工作区）首推新分支时，左侧只写「首次推送…」、右侧「0 个提交的改动」，看不到要推什么（`git/dialogs/PushDialog.tsx` 的 `range` 依赖 `group.repo.branch`，无主线时为 null）→ 无主线时回退到远程默认分支（`<remote>/HEAD` 指向，或远程上的 main/master），仍无则列出不在任何远程上的提交（验收：本地目录工作区新分支首推，左侧列出待推送提交，右侧显示其改动）。
- P3 群头部 Bot 胶囊「···」菜单项（新对话 / 查看改动 / 浏览文件 / 更换工作区 / Git 面板）没有 `menuitem` 角色，读屏不报菜单、方向键不能移动 → 换成 `ui` 的菜单组件或补 `role="menu"/"menuitem"` 与上下键（验收：`getByRole('menuitem', { name: '查看改动' })` 可定位，↓ 键移动焦点）。
- P3 贮藏空态：工作区有 8 处改动时，空态只有说明文字，入口「贮藏改动…」是左上角小链接 → 有改动时空态里放主按钮「贮藏改动…」，无改动时写「没有可贮藏的改动」（验收：有改动时空态居中有按钮）。
- P3 手机 Git 面板工具栏折行：拉取 / 推送 / ··· 掉到第二行孤立在左侧 → 390 宽时分支名省略收窄，拉取/推送收进「···」，保持一行（验收：390 触屏下 Git 面板顶部只有一行操作）。
- P3 文件浏览面包屑祖先段被截成「工. › a. › web」→ 空间不足时中间段折叠为「…」下拉，首段与当前段保留全名（验收：展开 apps/web/src/features 时面包屑为「工作区 › … › features」）。
- P3 Git 面板「提交」按钮在未写说明时灰着不说原因 → 禁用时 title / 按钮下提示「先写提交说明」，勾选文件为 0 时提示「先勾选要提交的文件」（验收：悬停禁用按钮可见原因）。

## 11-16 第 3 轮（Agent 管理重构后：机器 › Agent 与供应商、Agent 详情、Bot 详情运行配置、新建 Bot；桌面 1440 + 深色 + 390 触屏，真实 daemon 检测 12 个 Agent）

已修：新建 Bot 默认选中离线机器（同名三台 yoqus-Mac-mini，前两台离线）→ 未指定机器时默认第一台在线机器；Agent 详情长路径/升级命令/安装命令把说明挤成每行 4 字、命令截断、复制按钮被挤出（手机上 Codex 升级命令无法复制）→ 长值换行、复制按钮常驻。

- P2 深色模式下 OpenCode、Goose、Copilot 的黑色官方标在深色列表底上几乎看不见（`ui/agent-icon.tsx`）→ 深色主题下 mark 为深色的图标加浅色底板或 1px 浅色描边（验收：深色截图 12 个图标都可辨认）。
- P2 未安装的 Agent 详情仍展示「默认「供应商/模型」」「官方登录 登录…/设置…」、路径/版本「--」，像已经能用（`agents/AgentDetail.tsx`）→ 未安装时只显示「安装方式 / 最低版本 / Node 要求 / 最新版本」，其余换成一行「安装后可设置默认供应商与登录」（验收：展开 OpenCode 只见安装相关 4 行与提示）。
- P3 新建 Bot「执行机器」三台同名 yoqus-Mac-mini 只能靠在线/离线区分 → 同名时副标题加「最后在线 x 天前」或机器 ID 前 4 位（验收：同名机器一眼可分）。
- P3 Agent 行「有更新」标签与右侧「升级到 x」按钮重复 → 有升级按钮时不显示「有更新」标签（`stale` 无按钮时保留）（验收：Claude Code 行只剩按钮）。
- P3「可安装」区 6 个蓝色「安装」主按钮并排，抢「全部升级」的视觉层级 → 「安装」改次级按钮（验收：页面只有「全部升级」与「升级到」为主色）。
- P3 Node.js 26.3 已满足时仍显示「需要 Node.js ≥ 24.9」（注册表静态 `note`）→ 只在当前 Node 不满足时显示，且用橙色（验收：Node 26 下 DeepSeek/Kimi 副标题不含 Node 要求）。
- P3 未安装 Agent「可用模型：机器上报后可见」→ 改「安装并登录后可见」；手机上已安装 Agent 的模型列表截断无从查看 → 允许换行（验收：390 宽 Codex 模型全部可见）。
- P3 Bot 详情「运行配置」只有「模型：默认模型」，看不出走哪个供应商（重构后 Bot 可继承/覆盖供应商）→ 改为「供应商/模型：官方登录 / 默认模型（继承机器默认）」（验收：与机器 Agent 详情「使用它的 Bot」一行文案一致）。

## 11-17 第 1 轮（创作面板：幻灯片/产品原型模板与三步流程、稍后处理、运行页「上下文」；桌面 1440 + 深色 + 390 触屏）

已修：稍后处理预览原样显示 Markdown（「**39s 和 43s**」、`## `、`- `）→ 逐行转纯文本；创作面板「内容与参数」步骤副标题显示开关值「否」，主题必填未填也打绿勾 → 副标题取第一个已填的文本项，有必填缺项（或未选 Bot）的步骤不打勾；本群 Bot 全部不可用时要走到第 3 步才发现 → 第 1 步顶部提示「本群暂时没有 Bot 能接这个任务」。

- P2 手机创作面板：右侧摘要（将交给 AI 的内容 / 发出后群里会看到 / 检查）在 390 宽常驻下半屏，模板区只露两张卡、输入框占位被截断，上下两块各自滚动（`plugins/plugins.css` `.plg-side`）→ 窄屏摘要折成底部一行「检查：2 项未完成 ›」，点开展开；主区单列滚动（验收：390 触屏第 1 步首屏见 ≥ 4 张模板卡，第 2 步主题占位完整）。
- P3 创作面板「检查」在第 1 步就用橙色列出「请填写主题」「请选择交给哪个 Bot」，用户还没到那一步就被报错 → 未到达的步骤缺项用灰色、到达后再变橙（验收：第 1 步检查框为灰色提示）。
- P3 未选 Bot 时「发出后群里会看到」写「并自动 @…。」→ 改「并自动 @ 选中的 Bot」（验收：未选时无省略号）。
- P3 面板里技术用语：模板说明「写到工作区 design/<slug>/ 并发布预览」、摘要「插件 `slides 0.2.0`」等宽、第 2 步说明「表单根据插件声明的输入项自动生成。」→ 说明改「生成后在群里预览」，摘要写「幻灯片 v0.2.0」正文字体，第 2 步说明删掉或改「带 * 的必填」；必填项标签加 *（验收：面板无路径、无等宽字体，主题标签带 *）。
- P3 幻灯片模板分组名带「经典·」前缀，且「演示工作室」（自述「通用各类演示」）被归在「经典·技术教育」（插件清单 `group`）→ 分组去掉「经典·」，演示工作室归「通用」并排第一（验收：分组胶囊无「经典·」）。
- P3 稍后处理每行常驻 4 个操作（完成/改提醒/跳到原消息/移除），5 条就是 20 个按钮；右侧「1 天前」与提醒时间并列，看不出是消息时间 → 桌面悬停/聚焦行时显示操作（触屏常驻），时间加 title「消息发于 …」（验收：桌面未悬停时每行只有内容与时间）。
- P3 侧栏快捷入口「稍后处理」带角标时被截成「稍后...」→ 有角标时隐藏图标或缩小间距，保证 4 字完整（验收：1440 宽角标 1 时显示完整「稍后处理」）。
- P3 运行页「上下文」对过程已过期的运行只写「运行过程已过期，仅保留摘要」，而头部已有 232.7k tokens → 过期时显示已知总用量一行「本轮共 232.7k tokens，分项已随过程清理」（验收：过期运行上下文页有用量数字）。
- P3 打开群时对离线 Bot 逐个请求 `git/refresh`，控制台 3 条 409「离线，无法读取 Git 信息」→ 前端对离线 Bot 不发刷新（验收：全离线群打开时无 409）。

未走查：运行页「上下文」实时分项（需真实运行中的 daemon 与 Agent，按记忆 real-agent-test-isolation 不在本机跑真实 Agent）。

## 11-18 第 1 轮（原型编辑器页面规则与标注模式、画布链接卡片、运行卡「计划」块、子 agent 泳道与聚合栏、Bot 审批设置、建群飞书开关；桌面 1440 + 深色 + 390 触屏）

已修（5 项 P1，共字君 11-18 修复，待本轮 P2/P3 关闭后一并归档）：
- P1 原型预览「标注」模式合并角标（`3+1` / `5+2`）按 `]` / `→` 切换规则陷入死循环，且关侧栏时弹出合并列表而非当前选中规则气泡：合并角标按钮仅带 `data-testid="proto-mark-${first + 1}"`（无组内第 2 条的按钮节点），推进到组内第 2 条（`selected = 3`）后焦点仍留在 `proto-mark-3`，再按 `]` 时 `focusedRule()` 读回 `2` 并永远切到 `2 + 1 = 3`；同时代码 `.focus()` 触发 `onFocus={() => hoverOn(ids[0])}` 导致关侧栏时显示合并列表而非选中规则气泡（`artifacts/previewMarks.tsx`）→ 按钮补 `data-rule-ids` 按组查找按钮、焦点已在当前选中规则所属合并角标上时以 `selected` 为起点推进、键盘推进期间不误触 `hoverOn`（验收：含合并角标页连续按 `]` 可遍历全部规则不卡死，关侧栏按 `]` 逐条弹出对应规则气泡）。
- P1 原型画布页面规则把锚点缺失的元素规则当成整页规则画在屏幕左上角、新建整页规则草稿角标偏移叠字、同元素多条规则角标完全重叠、侧栏不标「元素已不存在」：`canvasRules.tsx` 中 `place(spot?.rect ?? null)` 在 `r.anchor` 非空但 `!spot` 时也走 `pageAt(n, k++)` 画到左上角；草稿角标缺 `art-rule-mark--page` 导致 `-50%` 偏移盖住编号 `1`；同锚点多条规则坐标相同完全重叠；`RulesPanel.tsx` 未渲染预览侧已有的 `<Tag tone="red">{t('元素已不存在')}</Tag>` → 仅 `!r.anchor` 排整页角标、草稿无 `rect` 时补 `art-rule-mark--page`、同锚点角标横向错开、`RulesPanel` 标红「元素已不存在」（验收：删掉锚点元素后画布左上角无假角标且侧栏显示红标，新建整页规则草稿角标不叠字，同元素多条规则角标并排可见）。
- P1 原型预览「标注」面板与窄栏排版 4 处破版：`.art-panel__head h3`（`flex: 1`）与 `NotesPanel` 头部 `.art-bar__fill`（`flex: 1`）双弹性占位把 `?` 快捷键按钮顶在面板正中（`preview-marks.css`）；`.proto-note__shared` 与 `.art-shared__body` 内 Markdown 表格缺横向滚动被挤成一字一行（`preview-marks.css`、`rules.css`）；`@container (max-width: 480px)` 下 `.proto-bar__mode` 居中且无裁剪，左溢盖住返回键（`prototype.css`）；`.art-tip` 的 `max-width: min(420px, calc(100% - 320px))` 在 390px 宽屏下仅剩 70px 挤成竖条（`artifacts.css`）→ 标注面板标题 `flex: none`、共享规则表格 `width: max-content; min-width: 100%` 横向滚动、窄栏 `.proto-bar__mode` 左对齐裁剪、窄屏隐藏底部 `.art-tip`（验收：`?` 紧贴标题右侧，共享规则表格不折成单字列，390px 顶栏返回键不被遮挡且画布无竖条气泡）。
- P1 子 agent 底部聚合栏（`runs/ActivityDock.tsx`、`process.css`）胶囊耗时穿出右边框、动作被挤成半字：`.act-chip` 缺 `overflow: hidden` 且 `.act-chip__name` 为 `flex: none`，窄屏与分栏下耗时穿出胶囊圆角边框；同时展示 `subagents` 与 `tasks` 双计数时 3 枚胶囊把 `.act-chip__doing` 挤剩 6px → `.act-chip` 加 `overflow: hidden`、`.act-chip__name` 允许收缩省略、双计数时最多展示 2 枚胶囊（验收：390px 窄屏与桌面分栏下胶囊文字不穿出边框，动作摘要可读）。
- P1 Bot 详情 › 权限与运行配置在电脑离线时误报「客户端版本较旧，升级客户端后生效」（`bots/BotSettings.tsx`）：电脑离线时 `machine.features` 为空数组，组件未判断 `machine.online` 即报版本过旧 → 仅 `machine.online && !machine.features.includes(...)` 时显示旧版提示（验收：离线电脑下不显示「客户端版本较旧」黄条）。

- P2 原型预览「标注」关侧栏时，元素已不存在的规则既无角标也无可聚焦条目，按 `]` 走到它时焦点留在上一个角标，下一步又从那里起步可能卡住（`artifacts/previewMarks.tsx`）→ 走到无角标规则时把起点记在 `selected` 而非焦点（验收：关侧栏含失效锚点规则时连按 `]` 可遍历全部规则）。
- P2 运行卡与运行页「计划」块展开全量后无法收起已完成项：计划超 5 项时点「已完成 N 项」或「还有 M 项」后 `all` 单向变 `true`（`chat/RunPlan.tsx`），运行页顶部固定面板（`panel={true}`，头部不可折叠）一旦展开会常驻占用最高 `40vh` 挤压下方过程列表 → `all` 为真且原本满足折叠条件时，列表末尾提供「收起已完成（{n} 项）」按钮还原折叠态（验收：长计划点「已完成 N 项」展开后，可再点「收起已完成」回到只看当前进度）。
- P2 原型预览窄栏顶栏规则计数胶囊 `7 · 2` 丢失「待确认」语义与橙色警示：容器宽度 ≤ 720px 时 `.art-title__rules` 隐藏，「标注」按钮内 `.proto-marks-toggle__count` 把总数与待确认数拼成蓝底白字 `7 · 2`（`artifacts/previewMarks.tsx`、`preview-marks.css`），像版本号 `7.2` 且看不出有待确认项 → 有待确认时胶囊拆为总数 + 橙色圆点/橙底待确认数，并设 `title="规则 7 · 待确认 2"`（验收：窄栏下有待确认规则时「标注」按钮可见橙色待确认标识）。
- P2 原型画布极小缩放（如手机总览 5%–19%）下 18px 规则角标盖满屏幕缩略图：画布缩小看全局时屏幕节点仅几十像素宽，而 `.art-rule-mark` 固定 18×18px（`artifacts/canvasRules.tsx`），多条规则角标把整块屏幕画面完全遮住 → `view.z < 0.35` 时隐藏屏幕内单元素角标（仅保留屏幕标题旁「规则 N · 待确认 M」徽标）（验收：画布缩放 < 35% 时屏幕缩略图不被角标遮挡，放大后角标显现）。
- P3 添加链接弹窗（`artifacts/AddLinkDialog.tsx`）细节：「显示方式」双行单选项的圆点垂直居中于两行文字之间而非对齐首行标题；初始空表单时「添加到画布」按钮置灰但无必填标识或原因提示 → 多行 Radio 项圆点与首行文字对齐；「链接地址」「标题」标签加必填说明或按钮旁提示缺项（验收：弹窗内单选圆点与粗体标题同行对齐，空态可知需填链接与标题）。
- P3 Bot 详情 › 权限「帮我审批」说明段落在开启内置审核时过密（`bots/ApprovalFields.tsx`）：`MODE_HINT.review`、`FLOOR`、`BUILTIN_HINT` 三段共 140 多字塞在同一 `FormRow` 的 `hint` 里，且 `BUILTIN_HINT` 未包块级元素与上一段紧贴 → `BUILTIN_HINT` 独立成带上下间距的段落或浅色提示条（验收：Claude/Codex 在线电脑下「帮我审批」说明分段清晰、段间有留白）。
- P3 发起会话弹窗「同时创建飞书群」未绑定飞书账号时无快捷跳转（`chat/NewGroupDialog.tsx`）：开关置灰时副标题仅纯文本写「先在设置 › 账户中绑定飞书账号」，用户需先关建群弹窗再自己找设置入口 → 副标题后附「去绑定 ›」按钮直接打开个人设置 › 账户页（验收：未绑定飞书时点击副标题入口可直达账户设置）。

## 11-18 第 2 轮（Skill 密钥声明与配置引导全链路、全屏工作台悬浮输入框与圆球 HUD、原型屏内状态与产物画布顶栏；桌面 1440 + 分栏 + 深色 + 390 触屏）

已修（4 项 P1，共字君 11-18 修复，待本轮 P2/P3 关闭后一并归档）：
- P1 产物画布顶栏 `.art-issues` 宽度误设在触发器锚点上，390px 手机端遮挡「预览」按钮点击并把「分享」挤出屏幕：`Popover` 的 `className` 挂在外层 `<span class="ui-popover-anchor">` 上（浮层宽度由 `width` prop 控制），而 `artifacts.css:171` 写了 `.art-issues { width: 320px }`，把顶栏行内锚点撑成 320px 宽，390px 触屏下直接盖住右侧「预览」按钮拦截点击，并把「分享」主按钮彻底挤出视口外（`artifacts/ArtifactTab.tsx`、`artifacts.css`）→ `IssuesButton` 改传 `<Popover width={320} portal>` 并移除锚点上的 `width: 320px`，窄屏顶栏收窄次要项保底「预览」与「分享」完整可点（验收：390px 触屏下含规范提示时「预览」「分享」完整可见且一键可点，问题浮层宽 320px 不越界）。
- P1 工作台全屏悬浮球（Orb）吸附左/右边缘或顶角时，实时状态胶囊（Live HUD）穿出视口被裁切、盖住工作台顶栏按钮，且入场动画闪跳：`ComposerDock.tsx:484` 让宽 180–640px 的居中 `.cdock__hud` 直接复用 44px 圆球的贴边位移 `orbTransform`（`±(at.width - 44)/2`），圆球吸右时 HUD 右端越出视口把「展开聊天 ›」裁掉一半，吸右上角（`top: 0`）时盖死工作台右上角 `[分栏 | 全屏 | ×]` 按钮，吸左时伸入侧栏；同时 `composer-dock.css:138` 的 `ui-enter` 关键帧重写 `transform` 导致 HUD 先在底部正中闪现再跳回球旁，且分栏切全屏过渡中途测量使左吸附停在半空（`chat/ComposerDock.tsx`、`composer-dock.css`）→ 圆球态下 HUD 按边缘反向对齐（左吸左对齐、右吸右对齐、距顶 `< 56px` 排到圆球下方）并钳制在 `.bench` 内，分离定位层与入场动画层，切全屏 `transitionend` 补测 `.bench` 边界（验收：圆球吸附任意边缘与四角时 HUD 不裁切、不压顶栏按钮、出现无闪跳）。
- P1 Skill 密钥声明两处角色权限错配：仅群管理员（非团队管理员）在聊天建定义卡误显「按声明创建」点击报 403，在市场引入弹窗切「每人自填」误显「在本团队创建定义」引入后 403 被成功 Toast 覆盖静默丢定义：`SecretCard.tsx:15-31` 未判断 `card.define.layer.scope === 'team'`（`SecretRequestPage.tsx` 也缺前置校验），向无团队管理权的群管理员展示主按钮「按声明创建」；`market/SecretSpecs.tsx:130-145, 284-290` 按静态 `spec.mode` 而非所选 `choice.mode` 计算 `canCreate` 且未对非团队管理员禁用「每人自填」单选项，`InstallTargetDialog.tsx:148-150` 在 `secrets.apply()` 403 后立即弹成功 Toast 覆盖报错 → `SecretCard` 与 `SecretRequestPage` 按 `define.layer.scope` 严格校验对应层管理员（无权显示灰标「等待 {admins} 创建」）；群引入且 `!teamAdmin` 时禁用「每人自填」选项并按 `choice.mode` 算权限；`secrets.apply()` 非 409 失败时保留错误提示不报全成功（验收：仅群管理员看团队层建定义卡显示等待提示，群引入无法误触发团队层 403 静默丢定义）。
- P1 原型画布与编辑器「屏内状态」三处破版与断路：画布总览（19% 缩放）屏标题被挤成 0px 且状态胶囊跨屏叠字；编辑器分栏下状态胶囊挂在产物总标题旁易与居中模式栏碰撞；手机打开独立分享页（`compact`）丢失状态切换且 `#canvas` 滚轮单格跳变 2.7 倍：`Canvas.tsx:1892, 1937-1938` 在缩略视图下同时渲染 `flex: none` 的规则徽标与 `.art-state`，超出单屏列宽压到邻屏标题上；`PrototypeEditor.tsx:570` 把屏级 `states.picker` 放在 `.art-bar__fill` 前紧贴左侧产物名；`kit/index.html:214, 571` 在 `body.compact` 下隐藏整个 `.bar` 导致无处切状态，且滚轮未同步 `1/300` 线性缩放系数 → 画布 `view.z < 0.55` 且未选中该屏时收起 `.art-state` 并限制 `.art-title` 不越列宽；编辑器将 `states.picker` 移至右侧「标注」按钮旁并在窄栏限宽省略；`kit/index.html` 在 `compact` 顶部 `.strip` 补状态下拉并同步线性滚轮缩放（验收：19% 画布屏名可读无跨屏叠字，分栏与 390px 编辑器顶栏不碰撞，手机分享页可切屏内状态且 `#canvas` 滚轮平滑缩放）。

- P2 群聊顶部密钥待办条「本群有 N 个密钥待你配置」合并计数却分窗割裂，且运行时「填写密钥」弹窗缺失用途与申请入口：`SecretBanner.tsx:62-64, 78` 把 `cards` 与 `needs` 合并计数，点「去配置」却只弹首张 `FillDialog`（纯大写变量名，无说明、占位符与申请外链），填完关窗仍余待办需连点多次（`secrets/SecretBanner.tsx`、`SecretCard.tsx`）→ 待办条统一打开聚合配置弹窗（关联未填 `origin` 卡片一并提交消卡续跑），`FillDialog` 同步展示定义说明与 Skill 声明的用途、占位符及申请链接（验收：待办条提示 N 项时点一次「去配置」即可在一个弹窗内看全用途并一次保存清空）。
- P2 团队设置与群设置「密钥」列表中，未填值的「统一值」密钥缺醒目警示与直接填写按钮：`SecretLayer.tsx:89-129, 211` 对 `value === null` 的 `shared` 密钥首行只挂蓝/灰标签，将「统一值未填写」混在第四行浅灰说明里，且右侧仅淡色 `···` 菜单（对比 `每人自填` 行有显眼「填写我的值…」按钮），管理员极易误以为已配好 → `s.mode !== 'personal' && !s.value` 时首行加橙色 `<Tag tone="orange">未填写</Tag>`，本层可编辑行右侧直接给「填写统一值…」按钮；群层继承的未填团队统一密钥补「需团队管理员在团队设置中填写」（验收：未填统一值的密钥在团队与群列表首行有橙标且管理员可一键补填）。
- P2 「配置密钥」与「按声明创建」弹窗在无 `title` 时重复渲染两遍/三遍同名变量，且已配置项无更新入口：`SecretNeeds.tsx:60-61, 87` 与 `SecretCard.tsx:125-126` 未判断 `spec.title` 是否存在就并排渲染 `<strong>DW_API_KEY</strong>` 与 `<code>DW_API_KEY</code>`，输入框 `label` 又重复第三遍；同时 `n.status === 'ok'` 时隐藏输入框导致普通成员在「群设置 › 密钥 › 配置密钥」无法轮换失效个人 Key → 仅 `spec.title && spec.title !== spec.name` 时渲染旁注 `<code>`，`SecureField` 改 `aria-label` 配默认占位符；已配置可填项行尾提供「更新…」展开重填（验收：无 `title` 密钥只显示一次名称，已配置项可点「更新…」修改保存）。
- P2 画布与原型预览处于「非默认屏内状态」时，平移画布或切屏加载瞬间闪回默认状态静态截图：服务端 `screenThumbs` 仅截取默认状态，而 `Canvas.tsx:1349-1352` 的 `covered(n)` 与 `PrototypeEditor.tsx:691` 的占位图未排除非默认状态（`artifacts/screenStates.tsx`、`Canvas.tsx`、`PrototypeEditor.tsx`）→ `useScreenStates` 暴露 `isDefault(id)`，非默认状态下画布平移保持实时帧、预览切屏改走骨架屏不垫默认态旧图（验收：切到「已满」等状态后平移画布或跳转不闪回默认态画面）。
- P3 群设置 › Skill 页在「已引入」已有条目时上半屏仍占半屏展示「还没有 Skill」空态插画，且缺「配置密钥」快捷入口：`GroupSettingsDialog.tsx` 无条件先渲染手写 `SkillLayerList` 大空态再渲染下方 `InstalledSection`，且未按方案 §6 在 Skill 页提供密钥入口 → 有已引入条目而无手写 Skill 时手写区收为紧凑单行提示 +「添加 Skill…」按钮；本群存在 `secret-needs` 时在 Skill 页同步提供「配置密钥」按钮（验收：有引入条目的群打开 Skill 页首屏直见已引入列表与「配置密钥」入口）。
- P3 飞书密钥卡片独立落地页（`/secret-requests/:id`）完成「按声明创建」后误写「已填写」，且未前置拦截无权限成员：`SecretRequestPage.tsx:38-55` 对 `req.define` 完成后仍显示「已填写，可以回到飞书」（实际仅建空定义未填值），且普通成员打开管理员专属链接直接弹窗，提交才报 403 → `req.define` 完成后提示「已创建密钥定义，请成员各自填写后继续」；加载后对非 `origin` 卡片前置判断管理权限，无权直接显示只读等待空态（验收：建定义完成页文案准确，普通成员打开管理员卡片链接见只读等待说明）。
- P3 市场详情页主操作栏右侧常驻实心高饱和红底「封禁」按钮，与「引入到…」抢视觉层级（`market/ListingDetail.tsx`）→ 未封禁条目的「封禁」改为次级危险按钮或收进右上角 `···` 管理菜单，仅已封禁条目主栏展示「解除封禁」（验收：正常条目详情主操作栏仅「引入到…」一个实心主色按钮）。

## 11-19 第 1 轮（Skill 密钥待办条与配置弹窗交互、群设置密钥、工作台全屏空态、市场密钥引入窄屏；桌面 1440 + 手机 390）

已修（2 项 P1，本轮直接修复，待本轮 P2/P3 关闭后一并归档）：
- P1 群顶栏密钥待办条遇到「按声明创建（`define`）」卡片时错开成「填写密钥」密码弹窗（`secrets/SecretBanner.tsx`）：`open === 'card' && first` 无条件渲染 `FillDialog`，未按 `first.define` 分发 `DefineDialog` → 引入 `DefineDialog` 按 `first.define` 分发（验收：群内有待处理 `define` 卡片时点顶栏「去配置」弹出「按声明创建密钥」，可直接点「创建」无需填值）。
- P1 配置密钥弹窗折叠在「可选配置」中的待创建密钥默认勾选并被静默提交（`secrets/SecretNeeds.tsx`）：`creating` 仅看 `!skip[key]`，导致用户未展开的折叠区可选密钥默认勾选并随保存一起创建 → 改为按 `n.spec.required` 决定默认勾选态，可选密钥必须展开后手动勾选才创建（验收：含可选待创建密钥时不展开直接保存不会创建可选密钥定义）。

- P2 配置密钥弹窗层级扁平、全局选项归属不清且团队层标签文案失准（`secrets/SecretNeeds.tsx`、`secrets/secrets.css`）：Skill 标题与密钥行缺少分隔，密钥条目之间无卡片描边或分割线；底部「允许在他人电脑上的 Bot 使用」紧贴在「可选配置」下方无分割线，易误解为只作用于最后一条可选密钥；团队层 `fill_shared` 标签写死「本群统一密钥 · 管理员」未按 `n.def?.scope` 区分 → 每条 `.sn-row` 加轻描边或底部分割线、全局复选框上方加分割线、`fill_shared` 按 `scope` 区分本群/团队（验收：桌面与 390px 手机下每条密钥边界清晰、全局开关与上方列表明确分隔）。
- P2 工作台全屏空态「还没有打开的标签页」左偏未居中（`workbench` 空态容器）：全屏模式下空态块偏在左侧约 x=200px，右侧留大片空白 → 空态容器占满工作台主区并 `display: grid; place-items: center`（验收：桌面 1440 分栏与全屏模式下无标签页时提示块均居中）。
- P2 市场引入弹窗「声明 vs 现有定义」双列对比在 390px 手机端未折成单列（`market/market.css`）：`.mkt-secret__compare` 固定 `grid-template-columns: 1fr 1fr`，窄屏每列不足 130px 挤成竖条 → `@media (max-width: 640px)` 下改为单列 `1fr`（验收：390px 下声明与现有定义上下堆叠、文字易读）。
- P3 配置密钥弹窗在本群存在他人电脑上的 Bot 时，默认未勾选「允许在他人电脑上的 Bot 使用」（`secrets/SecretNeeds.tsx`）：与 `FillDialog`（`card.foreign` 默认勾选）不一致，成员经待办条填完个人密钥后 @群内他人 Bot 仍无法读取 → `useForeignBots(groupId)` 非空时默认勾选并保留下方说明（验收：群内有他人 Bot 时打开弹窗默认勾选且明确列出 Bot 名）。
- P3 配置密钥弹窗输入不足 8 字符时缺少行内红字错误提示（`secrets/SecretNeeds.tsx`）：输入短值后仅「保存」按钮置灰、`SecureField` 仍只显示灰色 `hint` → 当 `value.length > 0 && value.length < SECRET_MIN_LENGTH` 时向 `SecureField` 传 `error={t('至少 8 个字符')}`（验收：输入 3 字符时输入框下方变红提示，满 8 字符恢复）。

## 11-19 第 2 轮（原型画布左栏与独立 AI 对话输入框、群设置 › Webhook 管理、群信息 › 在线预览；桌面 1440 + 分栏 + 全屏 + 深色 + 390 触屏）

已修（3 项 P1，本轮直接修复，待本轮 P2/P3 关闭后一并归档）：
- P1 原型画布窄屏/手机端（< 720px）展开左栏抽屉后无宽度上限、无点击遮罩且无法按 Escape 收起：`PageRail` 内联写死 `style={{ width }}`（桌面曾拉宽到 480px 切手机直接顶出视口把收起按钮挤到屏幕外），且无遮罩拦截、点空白无法关闭抽屉（`artifacts/ArtifactTab.tsx`、`PageRail.tsx`、`rail.css`）→ 窄屏下隐藏右边缘拖拽条、抽屉限宽 `max-width: min(85%, 320px)`、补半透明遮罩点击关闭与非输入态 `Escape` 关闭（验收：390px 手机下即使桌面拉宽至 480px 抽屉仍不越界，点遮罩或按 Escape 可收起）。
- P1 Webhook 编辑弹窗点击「删除」缺少二次确认直接永久删除：`WebhookDialog.tsx` 底部红色实心「删除」按钮直接调用 `webhooksApi.remove(webhook)`，而可恢复的「重置令牌」反而有确认弹窗，极易误删生产 Jenkins Webhook → 点击「删除」改弹统一的 `ConfirmActionDialog` 说明调用地址与令牌将立即失效，确认后再删除（验收：点「删除」先弹出确认框，取消不删，确认后删除并提示）。
- P1 在线预览面板离线态与已退出后台服务展示非法操作项：`PreviewsView.tsx` 在预览 `offline` 时更多菜单仍展示「仅暂停后台进程（保留卡片）」且主按钮误标「停止」（实际不停止进程仅关闭记录）；独立后台服务 `exited` / `failed` 时仍显示「停止」按钮 → 仅 `online` 预览显示「仅暂停后台进程」，`offline` 预览主按钮显示「关闭」，独立后台服务仅在 `running` / `starting` 时显示「停止」（验收：离线预览更多菜单无暂停项且按钮为「关闭」，已退出服务无「停止」按钮）。

- P2 原型画布左栏文件夹树不支持折叠/展开（`artifacts/PageRail.tsx`）：支持最多 7 级嵌套后所有子文件夹与页面始终全量展开，页面多时列表冗长难以定位 → 为含子项的文件夹行增加小三角折叠/展开按钮（默认展开并记忆折叠态），点箭头仅切折叠、点名称仍切画布视图（验收：点击文件夹左侧箭头可收起/展开其子项且不切换画布）。
- P2 原型画布左栏「删除文件夹」无安全感反馈，用户易担心误删文件夹内页面（`artifacts/PageRail.tsx`、`en-rail.ts`）：菜单红字「删除文件夹」点下即删且无提示，页面虽自动上移保留但用户不知情 → 删除成功后 Toast 提示「已删除文件夹「{title}」，其中的页面已保留」，非空文件夹菜单项标为「删除文件夹（保留页面）」（验收：删除含页面的文件夹后顶部弹出明确提示）。
- P2 原型画布输入框占位与「AI 对话」空态方位文案在桌面与手机均与实际布局不符（`artifacts/CanvasChat.tsx`、`chat/MessageComposer.tsx`）：桌面端输入框在画布下方而非左栏下方；手机端左栏默认收起，输入框写「回复显示在左侧『AI 对话』」让用户找不到入口 → 空态改「在画布下方输入框描述要怎么改，AI 的回复显示在这里」，窄屏占位改「描述要怎么改，回复显示在左上角『AI 对话』」（验收：桌面与 390px 手机文案均与实际界面位置一致）。
- P2 Webhook 一次性令牌弹窗「调用示例」缺一键复制按钮，且手机端列表行长标题被挤成 3 行（`webhooks/WebhookDialog.tsx`、`webhooks.css`、`WebhooksView.tsx`）：`WebhookUrlDialog` 仅地址框有「复制地址」按钮，多行 `curl` 示例需手动拖选；390px 手机端标题+标签+3 个操作同排把长名称压成 3 行竖条 → 示例标题旁加「复制示例」按钮；窄屏下 `.gs-row` 操作区折至第二行右对齐（验收：可一键复制 `curl` 示例；390px 下 Webhook 名称不折成 3 行）。
- P3 Webhook 列表「待生成令牌」行操作层级不清晰、停用行视觉区分弱（`webhooks/WebhooksView.tsx`）：「生成令牌」与「编辑」同为蓝色纯文字按钮，停用行与启用行标题对比度相同 → `!w.hasToken` 时「生成令牌」使用次级边框按钮突出主操作，停用行标题降低对比度（验收：待激活行首要按钮一眼可见，停用行与启用行一眼可分）。
- P3 在线预览面板独立后台服务行的长命令在窄侧栏单行截断且无查看完整命令入口（`previews/PreviewsView.tsx`、`previews.css`）：`apps/server$ node di...` 被省略号截断且无 `title` 或展开详情 → 为 `.pv-mono` 补充完整 `title` 属性或提供展开技术详情查看完整目录与命令（验收：悬停或展开可见完整 `cwd` 与 `command`）。

## 11-20 第 1 轮（原型协作 P1 前台「正在看」提示与 AI 编辑可视化、产物「移动到群…」与分享、群顶栏标签栏与添加标签、群设置 › 知识库与仓库；桌面 1440 + 分栏 + 深色 + 390 触屏）

已修（3 项 P1，本轮直接修复，待本轮 P2/P3 关闭后一并归档）：
- P1 前台产物「正在看」软提示标题为空且关闭工作台后仍残留（`chat/MessageComposer.tsx`）：`useForeground` 未检查工作台 `s.open && s.groupId === groupId`，关闭工作台后输入 `@Bot` 仍显示「正在看」并附带 `foregroundArtifactId`；同时直接读 `tab.title`，当 tab 以空标题打开（如 `openArtifact(id)`/`focusArtifact`）时渲染成 `正在看 · ` 缺失产物名 → `useForeground` 校验工作台打开且属于当前群，标题回退读取群产物列表与产物详情实时标题（验收：打开空标题 tab 时芯片显示完整产物名，关闭工作台后芯片消失且发送不带 `foregroundArtifactId`）。
- P1 原型画布 AI 编辑可视化（`ActivityLayer`）在缩放画布下随视口缩小至无法辨认（`artifacts/ActivityLayer.tsx`、`Canvas.tsx`、`activity.css`）：`<ActivityLayer>` 挂在随 `view.z` 缩放的 `.art-world` 内，34% 默认适配与 19% 总览缩放下 `{name} 正在改` 徽标与 2px 流光描边被缩成 2–4px 肉眼不可见 → 移入屏幕空间层 `.art-overlay` 按 `n * view.z + view` 定位保持恒定清晰尺寸，缩略屏宽 `< 90px` 时隐藏内部文字仅保留流光外框（验收：34% 缩放下徽标字号恒定可读不溢出，19% 总览下流光外框清晰可见）。
- P1 群顶栏标签栏溢出时在「更多」按钮左侧生硬截断图标/半字（`group-tabs/GroupTabBar.tsx`、`group-tabs.css`）：桌面分栏与 390px 手机端触发溢出后 `.gtabs__list` 直接硬裁切，留下孤立图标或半个汉字紧贴「更多 ▾」，且「更多」菜单未标出失效标签 → 监听滚动与尺寸变化为 `.gtabs__list` 动态挂接左右 24px `mask-image` 渐隐类，「更多」菜单对 `stale` 标签追加 `（已失效）`（验收：溢出时「更多 ▾」左侧平滑渐隐无半字/孤立图标，失效标签在下拉中可辨）。

- P2 知识库列表摘要原样展示 Markdown 源码且行尾「···」菜单带生硬黑框（`knowledge/KnowledgeView.tsx`、`knowledge.css`）：`e.excerpt` 直接渲染 `## 发布步骤 1. 先跑 \`pnpm check\`...` 造成阅读噪音；右侧 `MenuButton` 未传轻量样式在 390px 手机上呈粗黑矩形框 → 摘要剥离 Markdown 标记转纯文本，`MenuButton` 改无边框轻量图标样式（验收：列表摘要无 `#`/`\`` 源码符号，行尾「···」无黑框）。
- P2 知识库编辑器打开已有条目默认「预览」态却自动聚焦可编辑标题框（`knowledge/KnowledgeEditor.tsx`）：`mode === 'preview'` 时正文为只读预览，但顶部「标题」「标签」仍为可编辑输入框且自动套上蓝色焦点环，编辑与预览态混杂 → 预览态下以只读标题与标签呈现（不自动聚焦），切至「编辑」后显示表单输入框（验收：点开已有条目首屏为纯净阅读态无焦点框，切「编辑」立即进入表单）。
- P2 产物「移动到群…」弹窗切选目标群未清除旧错误、提交中未禁用关闭且缺状态反馈（`artifacts/MoveDialog.tsx`）：移动失败报错后改选其他目标群旧红条仍留存；提交中 `busy` 未阻止关闭且按钮仍显示「移动」 → `onChange` 同步清空 `error`，`busy` 时禁用取消/关闭并显示「移动中…」，无其他群时用次级说明文案并隐藏主操作按钮（验收：报错后重选目标群红条消失，提交中不可误关）。
- P2 群标签「添加标签」允许重复添加同一内置入口（`group-tabs/AddTabDialog.tsx`）：群内可反复添加多个「群公告」「定时任务」标签，导致顶栏重复冗余 → 校验当前群已有同 `entry`（及同 `botId`）标签时在下拉标注「已添加」并禁用提交（验收：已添加「群公告」后再选该入口提示已存在且不可重复创建）。
- P3 知识库历史版本弹窗回滚无二次确认且回滚后不刷新外层列表、打开时未默认展开最新版本（`knowledge/KnowledgeHistory.tsx`、`KnowledgeView.tsx`）：点「回滚到此版本」立即覆盖当前版本且关闭后外层列表仍显示旧版本号；打开弹窗下方空白需再点一次「查看」 → 回滚前弹确认框并传入 `onReload` 同步刷新外层列表，弹窗打开默认选中最新版本并高亮当前查看行（验收：打开历史直接见最新版改动，回滚确认后外层列表即时更新）。
- P3 群标签「添加标签」输入缺少协议头的链接时仅置灰「添加」按钮无原因提示（`group-tabs/AddTabDialog.tsx`）：输入 `example.com` 后按钮静默置灰不说明需带 `http://` 或 `https://` → 链接框非空且不匹配 `LINK` 时显示行内错误提示「请输入以 http:// 或 https:// 开头的链接」（验收：输入无协议头域名时下方实时提示）。
- P3 产物「分享」弹窗在可见范围为「团队/全员」但未开启外部链接时副标题自相矛盾（`artifacts/share.tsx`）：上方刚说明「团队成员/所有登录用户都能查看和演示」，下方「开启分享」关闭态仍写死「未开启，只有群成员能查看」 → 关闭态文案改为「未开启，仅上方可见范围内的成员可查看」（验收：切「团队/全员」时上下两段文案一致）。
- P3 英文界面左侧栏底部连接状态栏 `0 computers online` 右端溢出被截断（`app/Sidebar` 状态栏）：1440px 宽英文界面下状态栏右侧被裁成 `0 computers onlin` → 开启 `overflow: hidden; text-overflow: ellipsis` 并缩短英文态文案（如 `0 bots · 0 machines`）（验收：英文 1440px 下状态栏完整无裁切）。

## 11-21 第 1 轮（会话导航、左侧栏分区、入群预览、收件箱与话题抽屉；桌面 1440 + 1024 窄桌面 + 深色 + 英文 + 390 触屏）

已修（6 项 P1，本轮直接修复，待本轮 P2/P3 关闭后一并归档）：
- P1 移动端（390px）进入未加入团队分区群 `JoinPreview` 无返回键且无底栏被困死（`app/ChatPage.tsx`、`groups/JoinPreview.tsx`、`groups/groups.css`）：`ChatPage` 未传 `onBack`、`JoinPreview` 无移动端顶栏 → 移动端传入 `onBack` 并渲染 52px 顶栏 + `.pn-chathead__back` 返回按钮（验收：390px 下可见 36×36 返回按钮并可返回会话列表）。
- P1 侧栏快捷入口（话题 / 全部未读 / 稍后处理）与未加入目录群写死 `tabIndex={-1}` 键盘完全不可触达（`app/Sidebar.tsx`、`chat/UnreadsRow.tsx`、`saved/LaterRow.tsx`）→ 快捷入口恢复默认 Tab 可聚焦，目录群纳入 roving tab stop 与 `↑↓` 键盘导航（验收：Tab 可直达三项快捷入口；无已加入群的新成员可 Tab + 方向键遍历目录群）。
- P1 删除个人/团队分区无二次确认直接级联删除子树（`app/Sidebar.tsx`、`groups/SidebarDialogs.tsx`、`groups/en.ts`）→ 抽出 `DeleteSectionDialog` / `SidebarDialogHost`，删除前弹 `AlertDialog` 明确提示子分区级联与全团队影响并保留会话，确认后弹成功 Toast（验收：点击「删除分区」先弹确认框，取消不发 DELETE，确认后删除并提示）。
- P1 群内「本群话题（`GroupThreads`）」与「话题抽屉（`ThreadView`）」不支持 `Escape` 关闭且按键穿透触发底层群聊全部标已读（`chat/GroupThreads.tsx`、`chat/ThreadView.tsx`）→ 均注册 `useEscape(onClose)` 加入后开先关遮罩栈（验收：按 `Escape` 优先关闭抽屉内菜单/选人浮层，再关闭话题抽屉且不触发底层 `POST /groups/:id/read`）。
- P1 移动端（390px）多处高频返回/分区/底栏账户按钮触控热区仅 20–24px（`chat/UnreadInbox.tsx`、`chat/ThreadInbox.tsx`、`saved/LaterPage.tsx`、`app/shell.css`、`ui/nav-rail.css`）→ 三个收件箱返回键改用 36×36 `.pn-chathead__back`，`@media (pointer: coarse)` 放大侧栏分区 `···`（32×32）与新建分区（≥36px），移动底栏 `.account__trigger` 扩至 44×44 热区（验收：390px 触屏下全部高频入口热区合规）。
- P1 服务端 `/api/threads` 与 `/api/threads/unread` 缺失当前团队（`teamId`）隔离过滤（`apps/server/src/modules/threads/routes.ts`）→ `followedBy` 增加 `eq(groups.teamId, teamId)`，路由解析 `currentTeam(ctx, req, me.id)` 严格隔离（验收：多团队成员请求带 `X-GG-Team` 仅返回对应团队话题与未读数，跨团队头返 404）。

- P2 普通成员打开 `JoinPreview` 每次必发 `GET /api/groups/:id` 触发控制台 404（`app/ChatPage.tsx`）：`useGroupOutsideList` 未排除非管理员已命中本团队目录的 `preview` → 仅 `groupsState === 'ready' && !group && (!preview || teamCanManage)` 时查询（验收：普通成员点目录群控制台与 Network 零 404）。
- P2 侧栏底部「新建分区」菜单未启用 `portal` 向下溢出贴底压迫状态栏（`app/Sidebar.tsx`）：`<PullDownButton label={t('新建分区')} />` 遗漏 `portal` → 补传 `portal` 自动脱离滚动容器并向上翻转（验收：长侧栏底部点「新建分区」不被裁剪且不挡状态栏）。
- P2 侧栏分区计数与实际显示行数背离且与「把会话拖到这里」矛盾、触屏仍提示拖拽（`app/Sidebar.tsx`）：星标/个人分区覆盖导致分区下可见为 0 却显示计数 `3/3` + 拖拽空态 → 覆盖导致的空分区改提示「{n} 个群已显示在星标或个人分区」，计数补 `title` 说明，触屏空分区改「长按会话可移到这里」（验收：无矛盾提示、触屏无拖拽文案）。
- P2 工作台专注模式 `ConversationStrip` 顶部展开按钮现原生黑框且未过滤已完成会话（`app/shell.css`、`app/ConversationStrip.tsx`）：`.conv-strip__item` 缺 `border: 0; background: transparent; padding: 0;`，未复用 `isDone` 过滤且漏普通群未读点 → 清除原生边框底色、过滤已完成会话并补普通未读圆点（验收：专注模式顶部按钮风格一致、已完成群不冒出）。
- P2 `/unreads`、`/threads`、`GroupThreads` 摘要原样渲染 Markdown 且翻页失败静默吞错/连点重复追加（`chat/UnreadInbox.tsx`、`chat/ThreadInbox.tsx`、`chat/GroupThreads.tsx`）→ 摘要统一走 `plainText` 剥离标记，翻页加互斥锁与 `root.id` 去重，失败显示错误与重试；对齐免打扰群在侧栏与 `/unreads` 的展示（验收：无原始 `**`/`##` 源码，翻页失败可见重试且连点不重复）。
- P2 英文界面侧栏 `All unreads`（1440px）与底栏 `Notifications`（390px）截断（`app/AppRail.tsx`、`app/en.ts`、`chat/UnreadsRow.tsx`、`chat/en.ts`）→ 使用 `#nav` / `#shortcut` 短标签 `Alerts` 与 `Unreads`（验收：英文 1440px 与 390px 导航和快捷入口零省略号）。
- P2 `GroupThreads` 与 `ThreadView` 抽屉副标题硬编码 `# ` 且缺单行省略（`chat/GroupThreads.tsx`、`chat/ThreadView.tsx`、`ui/im/panels.css`）：私聊与私有群错显 `# 名称` → 仅公开频道加 `# `，`.pn-threadpanel__sub` 补单行省略、`.pn-threadpanel__actions` 设 `flex: none`（验收：私聊无 `# `，超长群名不撑破顶栏）。
- P3 侧栏「频道」分区头按钮被同名 `.sidebar__add` 样式污染呈 20×28 竖椭圆且分区 `···` 蓝灰配色不一（`app/shell.css`、`app/Sidebar.tsx`）→ 拆分或重置 `.sidebar__sechead .sidebar__add` 为 20×20 正圆、统一基线居中，分区 `···` 改 `variant="ghost"`（验收：桌面图标正圆对齐、分区操作统一中性灰）。
- P3 通知面板移动端缺显式关闭键、头尾按钮高 20px 且底部说明存在孤字折行（`notifications/NotificationPanel.tsx`、`notifications.css`）→ 顶栏右侧补 `<CloseButton />`，触屏按钮 `min-height: 32px`，精简底栏文案消除孤字（验收：390px 可点 `×` 关闭且无孤字）。
- P3 390px 移动端「稍后处理」带角标时误隐图标、`ThreadView` 关注按钮缺防重与响应即时同步（`saved/later.css`、`chat/ThreadView.tsx`）→ 仅桌面窄栏隐藏书签图标，`follow()` 加 `busy` 并直接应用接口返回态（验收：390px 三项快捷入口图标齐整，关注按钮即时切态）。
- P3 移动端「浏览频道」分段与行按钮偏小、新成员空「频道」区无发现引导（`groups/groups.css`、`app/Sidebar.tsx`）→ 触屏分段与行按钮 `min-height: 32px`，空「频道」区提供「浏览公开频道…」快捷按钮（验收：390px 控件 ≥32px，新成员一键可发现公开频道）。

## 11-21 第 2 轮（聊天消息流交互、消息操作/编辑/置顶、表情反应、富交互卡片、输入框 @ / 候选与芯片、全局搜索 ⌘K；桌面 1440 + 深色 + 390 触屏）

已修（13 项 P1，本轮直接修复，待本轮 P2/P3 关闭后一并归档）：
- P1 消息悬停条「表情回应」浮层（`ReactionPicker`）未启用 `portal` 且 `top-start` 向右溢出裁切掉 `❤️`/`😂`（`ui/popover.tsx`、`reactions/ReactionPicker.tsx`、`reactions/reactions.css`）→ `useFixedPosition` 按 `top-*` 优先置顶并钳制水平视口边界，`ReactionPicker` 改 `portal placement="top-end"` 并同步样式选择器与触屏反应热区（验收：1440 与 390 下 6 枚表情全数可见无裁切）。
- P1 消息内联编辑器（`MessageEditor`）无「保存/取消」按钮且 `Escape` 穿透关闭话题抽屉、窄栏溢出（`chat/MessageEditor.tsx`、`chat/edit.css`、`chat/en.ts`）→ 补底部「取消」「保存」按钮（空内容无附件禁用）、接入 `useEscape` 与 `stopPropagation` 隔离、窄栏改 `width: min(460px, 100%); min-width: min(260px, 100%)`（验收：390px 触屏可点按钮保存/取消，话题内编辑按 Esc 仅退出编辑）。
- P1 顶部置顶条（`PinnedMessages`）取消置顶零确认且只读态仍可点报 403、展开列表缺 `Esc`/点外关闭（`chat/PinnedMessages.tsx`、`chat/ChatView.tsx`、`chat/en.ts`、`ui/im/notice.css`）→ 接入 `AlertDialog` 二次确认与成功 Toast、`readOnly` 隐藏取消按钮、多置顶顶栏不放歧义 `×`、展开列表注册 `useEscape`/`useOutsidePress`、触屏关闭键扩至 32×32（验收：取消置顶先确认、只读无关闭键、列表可 Esc 收起）。
- P1 消息操作条 `···` 菜单（`MenuButton`）未 `portal` 致末条消息底边平切、390px 下二级子菜单越屏（`ui/menu.tsx`、`ui/menu.css`、`chat/MessageActions.tsx`、`runs/ApprovalBlock.tsx`）→ `MenuButton` 新增 `portal` 固定定位与视口翻转钳制、640px 以下子菜单水平钳制、触屏菜单项 `min-height: 36px`（验收：末条消息与 390px 子菜单完整不裁切）。
- P1 话题抽屉（`ThreadView`）中 `RunCard`「复制链接」与 `MessageQuote` 引用跳转丢失 `thread=` 参数导致找不到消息（`chat/TimelineItems.tsx`、`attachments/MessageAttachments.tsx`）→ 均读取 `ThreadScope` 补齐 `thread=` 参数（验收：话题内复制链接与点击引用直达话题目标消息）。
- P1 390px 移动端消息头元信息硬裁切无省略、消息操作条与反应按钮热区过小、首条长按操作条冲出顶部（`ui/im/message.css`、`ui/im/message.tsx`）→ `.pn-msg__meta` 补 `max-width: 100%; min-width: 0`，粗指针下 `.pn-msgactions` 38px/按钮 36×34px、`.pn-reaction` 32px，监听 `data-actions="open"` 触发 `placeActions` 翻转（验收：390px 消息头正常省略、触控热区 ≥32px、顶部消息长按不越界）。
- P1 用户/Bot 名片触发器头像按钮全量缺失 `aria-label`、触屏点空白关不掉、键盘无法 Tab 进名片（`chat/TimelineItems.tsx`、`users/UserCard.tsx`、`users/BotCard.tsx`、`users/useHoverCard.ts`、`users/en.ts`）→ 头像触发器补 `ariaLabel`、接入 `useOutsidePress`、支持 Tab 进出名片与 Esc 归还焦点（验收：`missingA11y` 清零，触屏点外即关，键盘可操作名片按钮）。
- P1 全局搜索 `⌘K › 文件` 点击仓库镜像文件（无 `run` 的 `?file=`）为死链且残留 URL 参数（`app/ChatPage.tsx`、`app/en.ts`）→ `useLinkedRun` 消费无 `run` 的 `?file=` 选最优在线就绪 Bot 打开工作台文件标签（全离线给明确提示），仅清理 `run`/`file` 参数（验收：镜像文件点击直达工作台预览或给出原因提示，URL 无残留）。
- P1 全局搜索 `⌘K` 在「文件/运行」标签混入「会话」吞掉空态引导、切标签 `active` 越界、Safari 中文 IME 按 Enter 误跳转（`search/SearchOverlay.tsx`、`search/search.css`、`search/en.ts`）→ 仅空查询或「消息」标签展示会话、补「没有匹配的消息」提示、切标签复位 `active` 并钳制 `safeActive`、补 Safari IME 守卫（验收：`文件` 0 命中正确显示空态与「去『运行』里搜」，拼音选词回车不误跳）。
- P1 全局搜索 `⌘K` 缺焦点陷阱与 `aria-modal`、不能再按 `⌘K` 关闭、选中行 `<mark>` 对比度崩坏（`search/SearchOverlay.tsx`、`search/search.css`、`app/AppShell.tsx`）→ 补 `aria-modal="true"` 与 Tab 焦点循环及关闭归还、`⌘K` 改开关切换、`<mark>` 改 `rgba(0, 0, 0, 0.24)` 保障四套主题高对比（验收：四主题高亮清晰、Tab 不逃逸、再按 ⌘K 关闭）。
- P1 `ui/im/Composer` 内置 `EmojiPicker` 绕过 `useEscape` 穿透关闭话题/标已读、与 `@` 浮层叠压且窄栏裁切（`ui/im/composer.tsx`、`ui/im/pickers.css`、`ui/im/composer.css`）→ 改用 `useEscape`/`useOutsidePress` + IME 守卫 + 关闭归还焦点、与外部 `popover` 互斥、响应式宽度与 8 列自适应网格（验收：Esc 仅关表情面板不穿透、双浮层不重叠、320px 窄栏不裁切）。
- P1 `@`/`/` 候选浮层无法点空白关闭、移动光标后卡死劫持按键、非空草稿后点 `/` 工具按钮失效（`ui/im/composer.tsx`、`chat/MessageComposer.tsx`）→ 暴露 `onCaretChange` 实时同步光标、`MessageComposer` 接入 `useEscape`/`useOutsidePress`、`/` 按钮按光标自动前置空格插入并支持切换（验收：390px 点外即关、移走光标浮层收起、正文后点 `/` 正常弹命令）。
- P1 输入框底栏不折行致 390px 手机与 360px 话题抽屉模型芯片挤成单字/顶出发送键，且多处触控热区 <32px（`ui/im/composer.css`、`chat/MessageComposer.tsx`、`chat/run-config.css`、`chat/context.css`、`ui/segmented.css`）→ 窄屏与话题内 `.pn-composer__accessory` 自动置顶成独立行、话题/画布隐藏群级 `✦ 创作`、粗指针下模型芯片/上下文/小分段控件 `≥32px`（验收：窄栏与 390px 双 Bot 芯片可读且发送键永不溢出）。

- P2 运行卡中断区块「丢弃本轮改动」与触发运行中 Bot 的消息「撤回」均缺二次确认与按钮加载态（`runs/InterruptBlock.tsx`、`chat/MessageActions.tsx`）→ 两处高危操作均弹 Pane `AlertDialog` 写明后果并区分按钮 `loading`（验收：点击先确认，取消不发请求，提交中按钮有加载态）。
- P2 390px 移动端相邻运行卡宽度呈 170–320px 锯齿参差（`chat/timeline.css`）→ `@media (max-width: 767px)` 下含 `.run-mcard`/`.tl-webhook-card` 的 `.pn-msg__row` 设 `align-self: stretch`、`.pn-msg__bare` 设 `width: 100%`（验收：390px 下所有状态运行卡右缘齐平）。
- P2 置顶条文字链接 `chat-pins__link` 为 `display: inline` 致 390px 布局盒宽越屏（`chat/timeline.css`）→ 改为 `display: block; max-width: 100%`（验收：390px 下 `right <= 390`，焦点框四边完整）。
- P2 Markdown 内联文件引用（`FileRef`）吞掉离线/403/网络错误一律误报「工作区里没找到」且无防连点（`chat/Markdown.tsx`）→ 仅 404 报没找到，其余走 `toastError(e)` 并加 `busy` 防重（验收：Bot 离线时点击文件路径提示真实离线原因）。
- P2 富交互块 `Mermaid` 在 `hc-dark` 渲染亮色主题黑底黑字、缺加载态与全屏放大，`Actions` 提交缺按钮 `loading`（`rich/theme.ts`、`rich/Mermaid.tsx`、`rich/Actions.tsx`）→ `isDark()` 改 `endsWith('dark')`，Mermaid 补加载态及全屏查看/复制源码，`Actions` 按点击项设 `loading` 并为只读态补提示（验收：`hc-dark` 清晰可读，加载与提交反馈明确）。
- P2 消息流活跃副标题、事件时间、`已编辑` 与计划折叠按钮误用 `--label-tertiary`（对比度 ~2:1，深色隐形）（`chat/timeline.css`、`chat/edit.css`、`chat/run-plan.css`、`chat/task-dock.css`）→ 统一改用 `var(--label-secondary)`（验收：浅/深色下对比度 ≥4.5:1）。
- P2 `@` 候选浮层「所有人」头像错显「有人」、1 人群仍置顶压过 Bot 且英文搜不到 `@all`/`@everyone`（`chat/ComposerCandidates.tsx`）→ `members.length > 1` 才显示且排在 Bot 后，复用 `.pn-mentionpicker__all` `@` 图标并支持英文关键词匹配（验收：无「有人」头像，1 人群不显 `@所有人`，`@`+Enter 优先选中 Bot）。
- P2 候选浮层鼠标悬停与键盘选中双蓝冲突、运行中 Bot 蓝点在蓝底隐身、禁用命令可被高亮吞 Enter（`chat/ComposerCandidates.tsx`、`chat/composer.css`、`chat/MessageComposer.tsx`）→ 用 `onMouseEnter` 驱动单一 `aria-selected` 高亮，状态点加描边，初始化与上下键跳过禁用项（验收：任意时刻仅一条蓝高亮，禁用命令自动跳过）。
- P2 输入框孤立 `@` 与 `/` 命令误报「未 @ 不会触发 Bot」，390px 移动端缺失 `@所有人` 警告、附件上传中发送键无等待提示（`chat/MessageComposer.tsx`）→ 修正 `hint` 条件排除 `command` 与空 `@`，移动端补 `@所有人` 轻量提示，上传中传等待提示/态（验收：输入 `/stop` 无矛盾警告，手机输入 `@所有人` 有提示）。
- P2 `@` 搜文件等待期间闪现误导「没有匹配的成员或 Bot」、`/` 与 `#` 无加载/空态且分组缺分割线（`chat/ComposerCandidates.tsx`、`chat/composer.css`）→ 暴露远程 `loading` 态，区分「没有匹配的成员、Bot 或文件 / 命令 / 作品」，分组间加分割线（验收：输入 `@src` 先见加载态，`/xyz` 显示无匹配命令）。
- P2 `RunConfigChips` 临时修改模型后缺单条恢复默认入口、「设为本群默认」无成功 Toast 且可能闪回旧值（`chat/RunConfigChips.tsx`）→ 菜单补「恢复本群默认」，保存成功弹 Toast 并同步更新本地 `botStates`，只读态提供可聚焦说明（验收：可一键取消单条指定，保存默认即时反馈不闪烁）。
- P2 全局搜索 `⌘K` 缺一键清除键、390px 软键盘下纵向溢出、英文模式过期运行归档图标失效且报错缺警示图标（`search/SearchOverlay.tsx`、`search/search.css`、`packages/protocol`、`server/search/routes.ts`）→ 补清除按钮与 `100dvh` 约束，协议增 `purged?: boolean` 替代中文子串判断，报错态加 `⚠` 图标并补 ARIA 属性（验收：390px 软键盘不越界，英文归档图标正确）。
- P2 上下文容量浮层（`ContextMeter` / `ContextRing`）压缩失败丢字、Safari IME 误发、`≥ 阈值` 显示「还剩 0」，桌面端 `ContextBadge` 指引 `/new` 漏 `@Bot`（`chat/ContextMeter.tsx`、`chat/ContextRing.tsx`、`apps/desktop/src/lib/ContextBadge.tsx`）→ 失败保留已填文本并加提交 `loading` 与 Safari IME 守卫、修正阈值文案与色彩判定、桌面端补 `@{bot}`（验收：失败不丢字、无「还剩 0」、桌面端提示命令直接可用）。
- P2 待发队列（`PendingMessages` / `pending.ts`）失败态重复两套重发按钮、跨群切丢被拒草稿与画布选区、红字缺 `⚠`（`chat/PendingMessages.tsx`、`chat/pending.ts`、`chat/MessageComposer.tsx`、`chat/chat.css`）→ 合并为单一左对齐失败条（含 `⚠` + 原因 + 重发/删除），按群/话题队列保存被拒草稿与选区（验收：无重复重发按钮，切群不丢草稿与选区）。
- P3 表情回应并发失败回滚覆盖相邻操作、`QuestionBlock` 漏答无剩余题数提示、`RemindDialog` 过去时间置灰无行内红字（`reactions/store.ts`、`reactions/ReactionBar.tsx`、`runs/QuestionBlock.tsx`、`saved/SaveMenu.tsx`）→ 按当前 store 态精准回滚并加在途锁，补缺答与时间错误提示（验收：并发点表情互不覆盖，置灰原因可见）。
- P3 390px 移动端系统事件折叠头（18px）与运行卡底部「查看过程」（20px）触控高度偏小（`chat/timeline.css`）→ `@media (pointer: coarse)` 下统一 `min-height: 32px`（验收：触屏热区 ≥32px）。
- P3 移动端输入框 16px 字号配 19px 固定行高显拥挤（`ui/im/composer.css`、`chat/composer.css`）→ 引入 `--composer-line-height` 移动端升至 `22px`（验收：多行中文与 `@提及` 舒适对齐）。
- P3 全局搜索 `⌘K` 右侧 `esc 关闭` 大小写与 `<Kbd>` 风格不统一（`search/SearchOverlay.tsx`、`search/en.ts`）→ 统一使用 `<Kbd>Esc</Kbd>`（验收：与 `ShellBar` 快捷键视觉一致）。
- P3 话题抽屉（`ThreadView`）发送新回复时未自动滚底展示待发消息行（`chat/ThreadView.tsx`、`chat/pending.ts`）→ `useOnQueued` 按 `(groupId, thread)` 订阅并在入队时滚底（验收：话题上翻后发新回复立即滚底可见「发送中」）。

## 11-21 第 3 轮（群信息侧栏与群公告、群设置弹窗 11 标签页、定时任务、群标签栏与工作台新建菜单、发起会话与飞书接入弹窗；桌面 1440 + 深色 + 390 触屏）

已修（13 项 P1，本轮直接修复，待本轮 P2/P3 关闭后一并归档）：
- P1 长群公告顶部横幅（`GroupNotice`）截断后不可点击展开全文、群头 topic 误跳主面板、`GroupInfo` 公告行未钳制行数撑长侧栏（`ui/im/notice.tsx`、`ui/im/notice.css`、`ui/im/panels.css`、`chat/ChatView.tsx`、`groups/GroupNotice.tsx`、`groups/GroupInfo.tsx`）→ `PinnedBanner` 支持点击与 `aria-expanded` 展开，群成员点公告/topic 直达「群公告」子页，只读预览点击展开全文，侧栏公告行 2 行省略钳制（验收：成员与只读用户均可完整阅读多行公告，侧栏高度不被撑长）。
- P1 `NewGroupDialog` 选单个共享 Bot 切私聊后仍矛盾显示「Bot 主人自动加入」2 人芯片且强制劫持已配置群为私聊、无法建 1 人 1 Bot 群（`chat/NewGroupDialog.tsx`、`chat/chat.css`、`chat/en.ts`）→ 先判 `canDm`（已改群名/开公开频道/开飞书/手动加人不劫持），私聊时 `owners` 置空不矛盾，并提供「改为建群 / 改回私聊」切换（验收：共享 Bot 私聊不展示主人芯片，已改群名不跳私聊，支持创建 1 人 1 Bot 群）。
- P1 `FeishuGroupDialog` 未绑定飞书账号时误报「没有可关联的飞书群」、`刷新`/`重试` 无加载反馈、旧数据存在时刷新报错被吞、带按钮错误 `Alert` 缺失红警示图标（`lib/useGet.ts`、`ui/display.tsx`、`feishu/FeishuGroupDialog.tsx`、`feishu/GroupFeishuTab.tsx`、`feishu/en.ts`）→ `useGet` 暴露 `loading`，查 `/me/feishu` 引导未绑定用户一键去「个人设置 › 账户」绑定，报错与刷新态完整透出，错误 `Alert` 始终带 `warning` 图标（验收：未绑定有明确入口、刷新/重试带 `aria-busy`、所有错误框均含警示图标）。
- P1 `MemberPicker` 在 `/users` 加载中与搜不到结果时均误报「所有账号都已在群里 / 没有可添加的成员」且 `NewGroupDialog` 吞掉加载错误（`groups/pickers.tsx`、`groups/GroupInfo.tsx`、`chat/NewGroupDialog.tsx`）→ 新增 `loading` 态渲染 `<Spinner />`、区分「没有匹配的成员」与真正无候选态，`NewGroupDialog` 透出失败提示与「重试」（验收：加载显转圈、搜无结果不误报全员在群、失败可重试）。
- P1 390px 移动端 `NewGroupDialog`/`FeishuGroupDialog`/`GroupFeishuTab` 多个分段、输入框、仓库按钮与底部操作按钮热区 <32px 且飞书多控件行把说明挤成竖条（`ui/segmented.css`、`ui/form.css`、`ui/overlay.css`、`chat/chat.css`、`repos/repos.css`、`feishu/FeishuGroupDialog.tsx`、`feishu/GroupFeishuTab.tsx`）→ 粗指针下分段/输入/仓库/弹窗按钮均升至 `≥32px`，飞书行改用 `.feishu-creds` 堆叠与可折行容器（验收：390px 下触控舒适、飞书说明占满整行不挤碎）。
- P1 `GroupInfo` 退出/解散群采用原位红条无取消入口、`ConfirmRemove`/`RemoveNoticeDialog` 提交中未锁背景与 Esc 易误操作（`groups/GroupInfo.tsx`、`groups/GroupNotice.tsx`、`groups/en.ts`）→ 退出/解散/删除私聊/唯一管理员拦截统一改用 Pane `AlertDialog`（提交中锁按钮与 Esc），移出成员与移除公告弹窗均 `closeOnBackdrop={false}` 并锁取消与防重（验收：高危操作可明确取消、提交中不可重复触发）。
- P1 `ScheduleDialog` 缺少「删除」入口、`ScheduleCard` 删除无确认弹窗易误点、`SchedulesView` 接口失败永久转圈（`schedules/store.ts`、`schedules/ScheduleDialog.tsx`、`schedules/SchedulesView.tsx`、`schedules/ScheduleCard.tsx`、`schedules/en.ts`）→ 编辑弹窗补红色「删除」键、两处均接 `ConfirmActionDialog` 与成功 Toast，列表加载失败渲染错误 `<Alert>` +「重试」（验收：两处删除均需确认、失败有重试不卡死）。
- P1 `GroupSettingsDialog` 切标签、点背景或按 Esc 直接静默丢弃「基本信息 / 群级参数 / MCP」未保存改动（`groups/GroupSettingsDialog.tsx`、`config/ConfigPage.tsx`、`groups/en.ts`）→ 接入 `hasDirty` 拦截与 `AlertDialog`（「继续编辑」/「放弃更改」），有未保存改动时禁用点背景关闭（验收：三个可编辑标签切页与关闭前均二次确认，放弃后正确重置草稿）。
- P1 `GroupSettingsDialog` 群级参数、`WebhooksView`、`GroupPluginsTab` 接口失败时永久转圈或静默假空态，插件空列表呈空白卡片（`lib/groupStore.ts`、`webhooks/WebhooksView.tsx`、`groups/GroupSettingsDialog.tsx`、`plugins/store.ts`、`plugins/PluginLayer.tsx`、`plugins/en.ts`）→ `createGroupStore` 与 `usePluginStore` 记录按群错误态（兼容旧服务端 404 降级），三处失败均渲染错误 `<Alert>` +「重试」，插件空态改用带插画 `<EmptyState>`（验收：500 报错清晰可重试、0 插件不再显空壳）。
- P1 `GroupSettingsDialog` 左侧导航与 390px 顶部横向标签随内容滚走、触屏标签偏矮、窄屏设置行/MCP/Skill 编辑器溢出（`groups/groups.css`、`config/config.css`）→ 弹窗体改独立滚动让桌面左栏与移动顶栏固定不滚走，触屏标签升至 `36px`，窄屏行与操作区折行、`SkillEditorDialog` ≤640px 切单列（验收：长页滚动导航常驻可见，390px 零横向溢出）。
- P1 `BotsView` 行尾 `···` 按钮用错 `ui-btn--plain` 呈淡灰近隐形且菜单未 `portal` 易被容器裁切（`groups/GroupInfo.tsx`）→ 改用 `ui-btn--ghost ui-btn--icon ui-icon-btn` + `weight={2.4}` + `MenuButton portal`（验收：浅/深色清晰可见，菜单浮层不被弹窗裁切）。
- P1 `GroupTabBar` 删除群共享标签零确认、复制链接未用 `copyText` 降级、触屏无法重命名/删除、热区 24px、共享 `<Presence>` 破退场动画、`NewTabMenu` 在私聊误显「添加群标签…」（`group-tabs/GroupTabBar.tsx`、`group-tabs/group-tabs.css`、`group-tabs/en.ts`、`workbench/NewTabMenu.tsx`）→ 删除接入 `ConfirmActionDialog`、改用 `copyText` 与失败提示、新增触屏「管理标签」菜单、粗指针 `≥32px`、拆分独立 `<Presence>`、私聊隐藏「添加群标签…」（验收：删除先确认、触屏可管理标签、私聊不显示无效菜单项）。
- P1 `GroupSettingsDialog` 管理员实时降权或全局关闭插件开关后，停留在「飞书/插件」标签导致弹窗标题出现 `undefined · 群名` 且残留内容（`groups/GroupSettingsDialog.tsx`）→ 计算 `activeTab` 并在当前标签消失时自动回退并同步至 `'basic'`（验收：降权或关开关瞬间无 `undefined`，立即切回只读基本信息）。

- P2 `GroupSettingsDialog › 基本信息`「回复风格」说明文案「聊天：默认像聊天，简短直接」与实际默认值 `'technical'` 相反且下拉项缺说明（`groups/GroupSettingsDialog.tsx`、`groups/en.ts`）→ 修正说明文字标明「技术（默认）」与「聊天」差异并在选项或副文案中明确区分（验收：默认值与文案完全一致）。
- P2 `GroupSettingsDialog` 非「群级参数」页仍渲染空白底部 footer 栏截断左侧导航底色（`groups/GroupSettingsDialog.tsx`、`groups/groups.css`）→ 仅 `readOnly || activeTab === 'params'` 时传 `footer`，其余标签省略 footer 让左栏贯通到底（验收：基本信息/成员/Bot 等标签无底部空条）。
- P2 `GroupSettingsDialog › Skill` 群层列表底部说明硬编码「跳过团队版」实为「跳过群版」（`config/SkillLayer.tsx`、`config/en.ts`）→ 改为按 `layer` 渲染对应文案（群层写「本群禁用后跳过群版」或回退上层）（验收：群层与团队层提示语准确无混淆）。
- P2 `SkillHistoryDialog` 点击「回滚到此版」直接生效无二次确认与加载锁，且打开后首版不默认高亮预览（`config/SkillHistoryDialog.tsx`）→ 补 `AlertDialog` 确认与 `busy` 锁定，初始化默认选中当前生效版本预览（验收：回滚需确认、防连点、打开即有选中态）。
- P2 `GroupSettingsDialog › 群级参数` 未改动时「保存」仍亮蓝且 `Stepper` 缺 `live` 致失焦前无法立即保存（`groups/GroupSettingsDialog.tsx`）→ `!dirty || !parsed?.success` 时禁用「保存」，`Stepper` 传入 `live` 实时同步值（验收：未修改保存置灰、输入数字即亮起）。
- P2 `GroupSettingsDialog › MCP` 内置 `gonggong` 11 行文字墙占满首屏、只读配置加载缺 `<Spinner />` 且说明重复（`config/ConfigPage.tsx`、`groups/GroupSettingsDialog.tsx`）→ 折叠内置工具详单（默认仅展示摘要+「查看工具」展开），只读加载补 `<Spinner />` 并去除重复顶部提示（验收：首屏即可看到自定义 MCP，只读态加载与错误状态完整）。
- P2 `GroupInfo` 右侧栏「群管理」区块在插件总开关开启时漏掉「插件」快捷入口（`groups/GroupInfo.tsx`）→ `pluginsOn` 为真时在「群管理」补「插件」行点击直达 `onSettings('plugins')`（验收：右侧栏与弹窗 11 标签一一对应）。
- P2 飞书接口失败报错三重嵌套裸露 Node 异常字符串，且 `FeishuLoadError` 使用内联硬编码 `style` 与过时 `size="sm"`（`feishu/GroupFeishuTab.tsx`、`apps/server/src/modules/feishu/`）→ 服务端收敛为可读中文错误码/提示，`FeishuLoadError` 改用标准 `size="small"` 与语义样式类（验收：错误提示简洁易懂、不暴露技术栈文本）。
- P2 `GroupInfo` 顶部快捷操作栏固定 `repeat(4, 1fr)` 在 2–3 个按钮时整体左偏失衡（`ui/im/panels.css`）→ 改为 `grid-template-columns: repeat(auto-fit, minmax(0, 1fr))` 自适应均分（验收：私聊/普通群 2/3/4 键均居中对称）。
- P2 `BotsView` 普通成员点击无操作行呈死点击、拉入/移出缺防重提示、0 Bot 缺空态、私聊拉人漏共享 Bot（`groups/GroupInfo.tsx`）→ 0 Bot 渲染 `<EmptyState>`，拉入/移出加提交态与成功 Toast，私聊补展示共享给我的 Bot（验收：空态明确、无死点、共享 Bot 可在私聊拉入）。
- P2 `BotPicker` / `MemberPicker` 多选行误用 `menuitemcheckbox` 缺 `menu` 容器、无上下键导航、Tab 易逃逸、搜索框随列表滚走（`groups/pickers.tsx`、`groups/groups.css`）→ 修正为 `role="listbox"` + `role="option"` + `aria-selected`，搜索框吸顶固定并支持键盘上下选与焦点循环（验收：键盘可完整检索并勾选，滚动长列表搜索框常驻顶部）。
- P2 `GroupInfo` 子页按 `Esc` 直接关整栏静默丢失公告草稿、公告历史返回断链、管理员无法恢复已隐藏的群公告（`groups/GroupInfo.tsx`）→ 子页按 `Esc` 优先返回主视图（有公告草稿先确认），公告子页为已隐藏公告提供「重新在顶部显示」开关（验收：Esc 逐级返回不丢草稿、已隐藏公告可恢复）。
- P2 `GroupInfo` 成员预览网格丢失成员头像且重名成员 `key` 冲突、窄栏 `LoadError` 160px 裁切（`groups/GroupInfo.tsx`、`ui/im/panels.css`）→ `ChatInfoMember` 补 `id` 与 `avatar` 字段并用 `userId` 作 key，`LoadError` 取消固定窄宽允许折行（验收：成员头像一致显示、长错误信息不被裁切）。
- P2 `NewGroupDialog` 创建提交中仍可点背景或 Esc 关闭、Safari IME 回车误触发提交、置灰提交按钮无缺失原因提示、切「新建终端」重挂载丢草稿（`chat/NewGroupDialog.tsx`、`chat/NewSessionDialog.tsx`）→ 提交中锁定关闭、补 `isComposing` 守卫、在底栏补齐置灰原因文案、切 tab 用隐藏保活草稿（验收：提交中不误关、拼音回车不误建、切换不丢草稿）。
- P2 `FeishuGroupDialog` 刷新列表后若原选 `chatId` 失效仍残留在状态中、名称框按回车无响应、切换「关联到已有群」弹窗标题仍显示「从飞书群创建」（`feishu/FeishuGroupDialog.tsx`）→ 数据刷新时校验并清空失效 `chatId`，补 `onKeyDown` 回车提交，弹窗标题随 `mode` 切换（验收：刷新不残留失效选项、标题与动作一致）。
- P3 `WebhooksView` 空态误用默认聊天气泡图标且「重置令牌」未用 `AlertDialog`（`webhooks/WebhooksView.tsx`）→ 改用语义图标与 `AlertDialog` 确认（验收：空态图标贴合 Webhook、重置令牌符合高危确认规范）。
- P3 `webhooks.css` 引用未定义变量 `--fill-quaternary` 且多处状态文案误用 `--label-tertiary` 导致对比度偏低（`webhooks/webhooks.css`、`groups/groups.css`、`config/config.css`）→ 替换为 `--control-track` / `--label-secondary`（验收：浅/深色下背景与文字对比度达标）。
- P3 仓库页禁止解绑仅靠 `title` 提示、`RepoDialog`/`ConfirmActionDialog` 提交中未统一锁定取消按钮与 loading（`repos/RepoSettings.tsx`、`ui/overlay.tsx`）→ 补可见说明行并在提交中同步禁用取消键（验收：触屏可见禁用原因、提交中防误点取消）。
- P3 `GroupInfo` Bot 胶囊离线圆点呈实心缺空心环、普通成员管理区提示易误导可编辑（`groups/GroupInfo.tsx`、`groups/groups.css`）→ 离线态改用空心描边环与 `Dot` 统一，只读成员区弱化箭头并明示只读（验收：在线/离线状态视觉全站一致）。
- P3 `GroupInfo` 顶部裸露长 SSH 仓库地址、通知下拉切态缺加载锁、`NoticesView` 时间格式未跟随英文语言（`groups/GroupInfo.tsx`）→ 顶部展示 `owner/repo` 简名（悬停见完整 URL），通知下拉接入 `pending` 锁，时间格式走 `i18n`（验收：顶部简洁、切通知不并发乱序、英文时间本地化）。
- P3 `ChatPage` 用单个 `<Presence>` 同时包裹 `NewGroupDialog` 与 `FeishuGroupDialog` 导致弹窗退场动画失效（`app/ChatPage.tsx`）→ 拆分为两个独立 `<Presence>`（验收：两弹窗关闭均有平滑退场动画）。


## 11-21 第 4 轮（管理后台一：壳层导航与核心列表 `/admin/users`、`/admin/teams`、`/admin/bots`、`/admin/groups`、`/admin/schedules`；桌面 1440 + 深色 + 390 触屏）

已修（9 项 P1，本轮直接修复，待本轮 P2/P3 关闭后一并归档）：
- P1 `TabView` 标签栏缺少宽度约束与横向滚动，导致 `BotsAdminPage` 400px 详情卡与 390px 手机端 7 个标签整体溢出卡片外并触发页面横向滚动（`ui/tab-view.tsx`、`ui/tab-view.css`）→ 为 `.ui-tab-view` 加 `max-width: 100%`、`.ui-tab-view__bar` 设 `overflow-x: auto; scrollbar-width: none`，切换标签自动 `scrollIntoView({ block: 'nearest', inline: 'nearest' })`（验收：400px 详情卡与 390px 移动端均零横向溢出，长标签组可顺滑横滑）。
- P1 `Table` 移动端卡片模式对无标题操作列渲染孤立冒号 `：`、`ActionsCell` 行尾 `···` 用 `plain` 近隐形且触控热区偏小（`ui/table.tsx`、`ui/table.css`）→ 仅 `ci > 0 && c.title` 时渲染 `.ui-table__label`，`ActionsCell` 改 `variant="ghost"`，粗指针下动作按钮升至 `32×32px` 且卡片右侧留白 `48px`（验收：390px 定时任务卡片无孤立 `：`，`···` 清晰可点且不遮盖文案）。
- P1 `ConfirmActionDialog` 与 `AlertAction` 缺少 `loading` 加载态，提交中未锁定取消按钮、Esc 与重复点击（`ui/overlay.tsx`、`ui/confirm.tsx`）→ `AlertAction` 增加 `loading?: boolean`，`ConfirmActionDialog` 在 `busy` 期间锁住取消键、关闭回调与重复提交并传 `loading: busy`（验收：确认提交期间按钮显 `aria-busy`，点取消或按 Esc 不会中断/误关）。
- P1 `AdminLayout` 移动端顶部导航切到靠后路由时不自动滚入视野、触屏项偏矮（28px）、页首副说明单行硬截断，且 `PopUpButton` 粗指针热区 <32px（`admin/AdminLayout.tsx`、`admin/admin.css`、`ui/popup.css`）→ 路由切换自动将 `[aria-current="page"]` 滚入可见区，移动端导航项升至 `min-height: 36px`，`.admin__desc` 改为 2 行省略，粗指针 `.ui-popup__btn` 升至 `32px`（验收：390px 直达 `/admin/schedules` 当前项即刻可见、说明完整可读、下拉热区达标）。
- P1 `TeamsPage`「归档团队」点击即刻生效零二次确认、「恢复团队」缺在途锁、`TeamDialog` 加载 `/admin/users` 失败无错误提示与重试、提交中未锁关闭与 `loading`（`admin/TeamsPage.tsx`、`test/adminOps.test.tsx`）→ 「归档团队」接入 `ConfirmActionDialog` 列明只读与 Bot 暂停后果，恢复加 `restoringId` 防重，`TeamDialog` 补加载 `<Spinner />`、失败 `<Alert>` +「重试」及提交锁，团队名补 `title` 悬停提示（验收：归档前必先确认且取消不发请求，成员接口失败可原位重试）。
- P1 `SchedulesPage` 删除用蓝色两段式按钮无弹窗确认、启停 `Switch` 缺在途锁与反馈、超长任务名在桌面硬裁切半字、390px 顶部 4 个统计卡单列占满首屏（`admin/SchedulesPage.tsx`、`schedules/schedules.css`）→ 删除改红色幽灵键并接入 `ConfirmActionDialog`，`Switch` 加 `togglingId` 锁与成功 Toast，长标题加 `.sc-admin-cell__text` 省略与 `title`，≤640px 统计卡切 `2×2` 网格（验收：删除先确认、长名平滑省略无半字、390px 首屏同时可见指标与任务卡片）。
- P1 `BotsAdminPage` 接口报错时仍误显「还没有 Bot」假空态、右侧 `BotDetail` 有未保存修改时切换 Bot 或团队筛选静默丢稿、保存缺 `loading`、新建/删 Bot 跨团队未刷新（`bots/BotsAdminPage.tsx`、`bots/BotSettings.tsx`、`bots/DeleteBotDialog.tsx`）→ 报错时隐藏空态仅展示错误 `<Alert>` +「重试」，`BotDetail` 透出 `onDirtyChange` 与 `loading={saving}`，切换前弹 `AlertDialog` 确认放弃，新建与删除均触发 `reload()`（验收：500 报错不误导空列表，编辑中切 Bot 必先拦截确认）。
- P1 管理后台 5 个核心列表页（账号/团队/Bot/群/定时任务）加载失败仅显示纯文本 `<Alert>` 缺少「重试」按钮，用户只能整页刷新（`admin/UsersPage.tsx`、`admin/TeamsPage.tsx`、`bots/BotsAdminPage.tsx`、`admin/GroupsPage.tsx`、`admin/SchedulesPage.tsx`）→ 统一在列表错误 `<Alert>` 内补「重试」按钮并绑定 `loading` 与 `reload`（验收：5 页接口失败均可原位一键重试恢复）。
- P1 `UsersPage` 新建账号在剪贴板写入失败时回退提示丢失明文初始密码（导致管理员无法拿到刚生成的密码）、新建/编辑与重置密码弹窗提交中未锁关闭与按钮加载态（`admin/UsersPage.tsx`、`admin/en.ts`）→ 剪贴板失败 Toast 直接展示 `{password}`，两处弹窗提交中锁定关闭与取消键并传 `loading: busy`，姓名列补 `title`（验收：无剪贴板权限时仍能完整复制初始密码，提交中不误关）。

- P2 `UsersPage` 新建账号弹窗空表单时「创建」按钮仍亮蓝可点且触发工具栏按钮文案「新建账号…」与弹窗标题「新建成员」不一致（`admin/UsersPage.tsx`、`admin/en.ts`）→ 未填合法账号/姓名/密码前可禁用或行内标明必填，统一按钮与标题措辞（验收：表单可提交状态与标题一致）。
- P2 `GroupsPage` 私聊行模式列展示 `--` 无说明、缺少点击进群/查看详情或行内操作（`admin/GroupsPage.tsx`）→ 私聊模式显语义标签（如「私聊」）并按权限提供查看/归档入口（验收：表格列含义自洽无裸 `--`）。
- P2 `BotsAdminPage` 390px 移动端右侧 `BotDetail` 叠在全部 Bot 卡片最底部，点击某行无跳转或抽屉反馈易以为点击失效（`bots/BotsAdminPage.tsx`、`bots/bots.css`）→ 窄屏点击 Bot 行打开详情抽屉/弹窗或自动平滑滚动到详情区（验收：390px 点任意 Bot 立即进入详情编辑）。
- P2 `AdminPage` 390px 移动端隐藏了右上角 `AccountMenu`，无法在后台内快捷切主题/语言或退出登录（`admin/AdminPage.tsx`、`admin/admin.css`）→ 在移动端工具栏或顶部导航右侧保留紧凑账户入口（验收：手机端后台可直接访问账户菜单）。
- P2 `TeamsPage` 创建时间未传 `dateLocale` 跟随系统英文设置、`AdminLayout` 移动端顶部「返回消息」粘性置左时首项可能在其左侧透出半截（`admin/TeamsPage.tsx`、`admin/admin.css`）→ 日期格式化统一用 `dateLocale`，移动端顶部条为粘性返回项补实色底与左侧遮罩（验收：英文日期本地化、顶栏滚动不穿底）。
- P2 `TeamFilter` 仅 1 个团队时仍占位可点（无切换意义）且 `/admin/teams` 失败时静默消失无反馈（`admin/TeamFilter.tsx`）→ 单团队时隐藏或只读，错误时提供轻量重试或回退（验收：单团队模式工具栏更清爽）。
- P2 `BotsAdminPage` 状态列离线圆点为实心灰点，与聊天侧栏 `Dot` 空心灰环不一致（`bots/BotsAdminPage.tsx`）→ 复用统一状态点样式（验收：全站在线/离线指示视觉统一）。
- P2 非系统管理员直访 `/admin/*` 时被静默重定向至 `/` 没有任何提示（`admin/AdminLayout.tsx`）→ 重定向前发一条温和权限说明 Toast（验收：误点后台链接知道原因）。
- P3 `UsersPage` 禁用账号状态标签与停用按钮视觉层级可进一步拉开、`GroupsPage` 仓库列长路径可简写为 `owner/repo` 悬停见全址（`admin/UsersPage.tsx`、`admin/GroupsPage.tsx`）→ 精修标签对比度与仓库短名显示（验收：表格信息扫视更快）。
- P3 `SchedulesPage` 顶部 4 个统计卡仅静态展示，不支持点击「启用中 / 已自动停用」联动过滤下方列表（`admin/SchedulesPage.tsx`）→ 点击统计卡同步切换筛选分段（验收：指标卡可交互联动）。
- P3 `TeamsPage` 与 `UsersPage` 的新建引导横幅按钮与顶部工具栏按钮文案完全重名，屏幕阅读器难以区分（`admin/UsersPage.tsx`、`admin/TeamsPage.tsx`）→ 区分引导区按钮文案或仅留主入口（验收：无重名按钮冲突）。
- P3 `BotsAdminPage` 桌面端选中行右侧详情卡切换时缺少轻过渡反馈（`bots/BotsAdminPage.tsx`）→ 保持滚动回顶与平滑切换（验收：切 Bot 详情从顶部开始阅读）。

## 11-21 第 5 轮（终端空间与工作台终端、飞书管理、审计记录、客户端发布、同步冲突处理；桌面 1440 + 深色 + 390 触屏）

已修（4 项 P1，本轮直接修复，待本轮 P2/P3 关闭后一并归档）：
- P1 飞书管理页在 390px 手机端严重溢出破版（`feishu/FeishuAdminPage.tsx`、`feishu.css`）：「对外地址」行 `.gs-value-line` 将「保存」按钮顶出视口外、「主应用 › 凭证」`.feishu-app__fields` 固定双列把 `App Secret` 右半与显隐眼标裁出屏幕、长重定向 URL 无换行 → 窄屏下对外地址行纵向堆叠铺满、`.feishu-app__fields` 改单列、`.feishu-app__id` 允许任意处换行（验收：390px 下对外地址保存按钮与 App Secret 完整可见可点、无横向溢出）。
- P1 审计记录在 390px 手机端第 7 项分类「预览」被裁出屏幕无法点选，且分类切换无竞态保护、「加载更多」缺防重入（`admin/AuditPage.tsx`、`audit.css`）→ 筛选区 `.admin-audit__filters .ui-seg` 允许横向滚动、首页拉取补 `cancelled` 竞态清理、`loadMore` 补 `loadingMore` 禁用态与「加载中」文案（验收：390px 下 7 个分类全部可达，连点「加载更多」不发重复请求）。
- P1 终端空间切换会话不重置 `ended` 状态、终端出错/退出态无重连或新开入口、剪贴板失败静默丢失且重命名/删除缺防重入（`terminal/TerminalSpacePage.tsx`、`TerminalView.tsx`、`view.ts`）→ 切换 `space.id` 重置 `ended`/`failed`、错误态与退出态遮罩均提供「重新连接 / 新开 Shell」主按钮、剪贴板失败改为 `toast` 提示、重命名未改动按 Enter 不提交并补保存/删除防重入（验收：从已结束终端切至运行中终端顶栏按钮正确置灰，出错/退出态可一键恢复）。
- P1 同步冲突弹窗加载失败误显「冲突已处理」且缺少竞态保护（`sync/ConflictDialog.tsx`、`sync/en.ts`）：`syncApi.conflicts` 失败时直接 `setConflict(null)` 导致界面误报已处理 → 区分 `loadError` 态展示「读取冲突失败」与「重试」按钮，为 `ConflictDialog` 与 `Preview` 补 `cancelled` 竞态清理（验收：冲突接口报错时显示错误与重试按钮，不再误报「冲突已处理」）。

- P2 终端搜索栏（`Cmd+F`）缺少 `Enter`/`Shift+Enter` 跳转与关闭按钮（`terminal/TerminalView.tsx`、`terminal.css`）：仅渲染裸 `<input>` 无占位提示，输入后按 Enter 不跳转下一匹配且无鼠标关闭入口 → 补 `Enter`/`Shift+Enter` 调 `findNext`/`findPrevious`、占位提示与关闭 `×` 按钮（验收：打开终端搜索后可键盘上下翻找匹配并可点 `×` 关闭）。
- P2 新建终端输入相对路径或 `~/...` 时「创建」按钮静默置灰无原因提示（`terminal/NewTerminalDialog.tsx`）：仅要求 `cwd.trim().startsWith('/')` 却未提示格式要求，且创建中无加载态文案 → 目录非空且不以 `/` 开头时显示行内错误「请输入以 / 开头的绝对路径」，提交中显示「创建中…」并禁用取消（验收：输入 `~/code` 时输入框下方明确提示需绝对路径）。
- P2 飞书管理「重定向 URL」缺一键复制按钮，且「接入进度」第 4 步按钮在窄屏贴边（`feishu/FeishuAdminPage.tsx`、`FeishuOverview.tsx`）：重定向 URL 仅静态 `<code>` 需手动拖选；第 4 步按钮文案较长在 390px 紧贴卡片右缘 → 重定向 URL 右侧加一键复制按钮（带 ✓ 反馈），进度卡片按钮文案精简为「复制登录地址」（验收：可一键复制重定向 URL，390px 下进度卡片留白均衡）。
- P2 客户端发布页「编辑版本说明」缺取消按钮，且「移除」弹窗缺提交中防重入（`admin/ReleasesPage.tsx`）：进入编辑态后无法放弃草稿退回预览，移除产物请求期间按钮未禁用 → 编辑态补「取消」按钮还原原说明，移除确认弹窗补 `removingBusy` 防重入（验收：编辑版本说明可随时取消还原，移除中不可连点）。
- P3 审计记录详情弹窗 `detail` 原始英文键名与 JSON 单行平铺难阅读（`admin/AuditPage.tsx`）：嵌套 JSON 以单行紧凑字符串展示，排查长参数不便 → 对对象值使用缩进格式化与等宽换行块，支持一键复制详情 JSON（验收：含复杂 `detail` 的审计记录在弹窗内层次清晰不截断）。
- P3 目录选择器（`DirPicker`）新建文件夹输入空名按 Enter 静默无反馈且缺触屏确认/取消按钮（`workspaces/DirPicker.tsx`）：仅依赖键盘 Enter/Esc，手机触屏端缺少显式按钮 → 空名提交时显示「请输入文件夹名称」，编辑行右侧补确认/取消小按钮（验收：390px 触屏下可点击完成或取消新建文件夹）。
