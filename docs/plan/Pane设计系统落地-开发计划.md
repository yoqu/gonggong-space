# Pane 设计系统落地开发计划

目标：用设计系统 **Pane**（macOS 27 + 飞书式 IM）的 token 和组件，重做 Web 聊天界面、管理后台和桌面端（Tauri）的全部视觉。不改信息架构，不改业务流程。

参考源（只读）：`docs/design/pane/`，内容来自 https://claude.ai/artifact/9H7rtB9Ei7E6MBZ9NwV7cM
- `README.md`：设计原则、文案、颜色、排版、IM 约定，是最高依据
- `tokens.json`：全部 token 的数值
- `components/bundle.css`：组件样式的精确数值
- `components/bundle.js`：组件结构和图标路径
- `components/index.d.ts`：组件 API
- `components/<Comp>/README.md`：使用约定；`preview.html`：示例用法

本计划取代 `macOS27-视觉与动效重构-开发计划.md` 中关于颜色、材质、圆角、组件外观的条目。那份计划的动效部分（弹簧 token、退场动画、减弱动效、玻璃档位）继续有效。

## 1. 决策

| # | 项 | 结论 |
|---|---|---|
| D1 | 实现方式 | 用 TypeScript 在 `apps/web/src/ui` 重写 Pane 组件，**不加载** `bundle.js`，不新增依赖。数值照搬 `tokens.json` 和 `bundle.css` |
| D2 | Token 命名 | 以 Pane 命名为准（`--label`、`--content-bg`、`--accent-fill`、`--radius-capsule`…），生成 `styles/tokens.css`，包含 light 和 dark 两套主题。旧的 `--color-*`、`--radius-*` 等在 W0 改成指向新 token 的别名；W3 删除全部别名 |
| D3 | 强调色 | 改为 Pane 的 systemBlue（`accent` / `accent-fill` / `accent-text`）。玉青只保留在 Logo |
| D4 | 范围 | Web 聊天、管理后台、桌面端（桌面端通过 `@web/styles` 和 `@web/ui` 复用） |
| D5 | 图标 | 全部换成 Pane 风格：18×18 画布、描边 1.4、圆头圆角。Pane 已有约 51 个；应用用到的其余约 40 个 lucide 图标按同一风格补画（清单见 §3）。W3 删除 `lucide-react` 依赖 |
| D6 | 窗口外框 | Web 不画假交通灯，也不做 Window 外框，视口就是窗口。桌面端用原生标题栏。只使用 Pane 的 Sidebar、Toolbar 和内容区三件套 |
| D7 | 消息形态 | 人和 Bot 的文字消息都进气泡：他人 `bubble-in`，自己 `bubble-out`（靠右）。运行卡片、审批、提问、文件、图片这类内容加 `bare`，用 `content-bg` + 发丝描边卡片呈现，不套气泡 |
| D8 | Pane 没有的组件 | Dialog、Drawer、Toast、Tabs、Textarea、运行卡片、审批块等，按 Pane 的语言扩展：浮层用玻璃（`glass-fill` + `glass-blur` + `shadow-glass`）、`radius-menu`、胶囊按钮 |
| D9 | 文案 | 按 Pane README「内容与文案」：按钮用动词、不加句号，需要进一步输入的操作用「…」，Alert 标题写成问句。不得违反 memory 里的界面术语规范（Bot、机器、群；权限档位中文名） |
| D10 | 字号 | 正文 13px（`body`），侧栏分组标题 11px semibold，控件高度默认 24px（`control-regular`） |

## 2. 映射

### 2.1 组件

| 现有（`ui/`、`features/`） | Pane | 备注 |
|---|---|---|
| Button / IconButton / CloseButton | Button（default/primary/destructive/glass/plain，4 档尺寸） | 纯图标按钮 = 圆形，需要 `aria-label` |
| Switch / Checkbox | Switch / Checkbox | |
| Input / Field | TextField | 带 label/hint/error |
| Textarea | 扩展：TextField 多行 | |
| Select | PopUpButton + Menu | |
| Tabs | SegmentedControl / TabView | 页内切换用 SegmentedControl |
| Badge | Badge + Tag | 标签颜色约定见 Pane README |
| Avatar / Presence | Avatar / AvatarGroup | 人用圆形，群/Bot 用圆角方形 |
| Progress / Spinner | ProgressIndicator | |
| Alert（ui） | Alert（确认类）/ ChatNotice | |
| Toolbar（ui/toolbar） | Toolbar / ToolbarGroup / ToolbarButton | |
| — | SearchField、Slider、RadioGroup、GroupBox/GroupRow、Menu | 新增 |
| Dialog / Drawer / Toast | 扩展（D8） | |
| app/Sidebar | ConversationList（会话）+ Sidebar（后台导航） | |
| ChatView 头部 | ChatHeader | |
| TimelineItems 消息行 | Message / MessageList / MessageActions / Reactions / ReadReceipt / ThreadSummary | |
| Composer / MessageComposer | Composer | |
| WorkspaceBanner / 群公告 | PinnedBanner | |
| RunGraphics / ApprovalBlock / QuestionBlock | MessageCard（bare） | 保留业务结构，外观按 MessageCard |
| MessageAttachments | FileAttachment / ImageAttachment | |
| 系统消息、日期分隔 | ChatNotice | |
| 设置页、后台表单 | GroupBox + GroupRow | |

### 2.2 缺失图标（W0b 补画）

应用在用、Pane 没有的图标，按 lucide 名列出：Activity、Archive、BarChart3、Bot、ChevronDown/Up、CircleAlert、CircleCheck、CircleX、Copy、CornerDownRight、CornerLeftUp、Cpu、Eye、EyeOff、FileCode、FileText、FileWarning、FolderCheck、FolderGit2、FolderOpen、GitBranch、GitFork、HardDrive、Hash、Info、Laptop、LayoutDashboard、Link、MessageCircleQuestion、MessageSquare、Moon、OctagonX、PanelRight(Open)、Play、Plug、Quote、RefreshCw、Server、ShieldAlert、ShieldCheck、Slash、SlidersHorizontal、Square、SquareTerminal、Sun、Terminal、Undo2、User、UserCheck、Users。

能直接用 Pane 已有图标的，改用已有的：`X→xmark`、`Trash2→trash`、`Settings→gear`、`Search→search`、`Ellipsis→more`、`Paperclip→paperclip`、`Bell(Off)→bell(-slash)`、`Pin→pin`、`Plus→plus`、`Check→check`、`Image→image`、`AtSign→at`、`SmilePlus→smile`、`SendHorizontal→send`、`Megaphone→megaphone`、`TriangleAlert→warning`、`Clock→clock`、`Folder→folder`、`Inbox→tray`、`ChevronLeft/Right→chevron-*`。

## 3. 施工波次

并行 agent 各用独立 worktree，由集成者按波次合并。每个切片的完成标准：本切片测试全绿，全量不回归（`pnpm -r test`），`pnpm typecheck`、`pnpm lint` 通过，并交付 Playwright 无头截图（浅色、深色各一张，使用 `gonggong_design` 独立库，见 memory）。

**文件所有权**：同一波次内的切片不得改同一个文件。确实需要改别人名下的文件时，写进交付说明，由集成者处理。

### W0 基础（2 个 agent 并行）

- **W0a Token 与基础样式**
  - 负责文件：`styles/*`、`ui/ui.css`
  - 由 `tokens.json` 生成 `styles/tokens.css`（`:root` 为 light，`[data-theme="dark"]` 为 dark），包含字体栈、文字样式、间距、圆角、阴影、玻璃、控件尺寸
  - 旧变量改为指向新 token 的别名（D2）
  - `ui.css` 按组件拆成 `ui/<name>.css`，避免 W1 冲突
  - `base.css` 把正文改为 13px，`focus-ring` 外环按 Pane 规格
  - 测试：token 快照测试，确认 light/dark 的 key 集合一致
- **W0b 图标**
  - 负责文件：`ui/icon.tsx`（新）、`ui/icons/*`（新）
  - 从 `bundle.js` 提取 Pane 的约 51 个图标路径，并补画 §2.2 缺失的图标
  - `Icon({name,size=16,color,weight=1.4,label})`，`name` 是字面量联合类型，拼错名字时 typecheck 直接失败
  - 在 UiGallery 加一个图标总览页

### W1 组件库（3 个 agent 并行，依赖 W0）

- **W1a 基础控件**
  - 负责文件：`ui/controls.tsx`、`ui/display.tsx` 及对应 css
  - Button、Switch、Checkbox、RadioGroup、TextField（含多行）、SearchField、SegmentedControl、Slider、ProgressIndicator、PopUpButton、Tag、Badge、Avatar/AvatarGroup、GroupBox/GroupRow
  - 保持现有导出名兼容；API 按 `index.d.ts` 扩展
- **W1b 浮层与外壳原件**
  - 负责文件：`ui/overlay.tsx`、`ui/toast.tsx`、`ui/toolbar.tsx`、`ui/menu.tsx`（新）、`ui/sidebar.tsx`（新）及对应 css
  - Menu（玻璃）、Dialog/Drawer/Toast（D8）、Alert、TabView、Toolbar/ToolbarGroup/ToolbarButton、Sidebar
- **W1c IM 原件**
  - 负责文件：`ui/im/*`（新）
  - ConversationList/Item、ChatHeader、Message/MessageList、MessageActions、Reactions、ReadReceipt、ThreadSummary、Mention、ChatNotice、PinnedBanner、Composer（外观壳）、MessageCard、FileAttachment、ImageAttachment
  - 只做纯展示组件，不接业务数据

每个组件都进 UiGallery，逐一对照 `docs/design/pane/components/<Comp>/preview.html` 截图。

### W2 页面落地（4 个 agent 并行，依赖 W1）

- **W2a 外壳**
  - 负责文件：`app/*`（不含 UiGallery）、`features/search`、`features/notifications`、`features/auth/AccountMenu*`
  - 左栏改为 ConversationList，贴边、`sidebar-bg`、发丝分隔线
  - 顶部改为统一工具栏
  - 欢迎页
- **W2b 聊天内容区**
  - 负责文件：`features/chat`、`runs`、`reactions`、`attachments`、`users`、`groups`、`workspaces`
  - 用 ChatHeader、MessageList、Composer 组装
  - 消息按 D7 处理：运行、审批、提问改为 bare 的 MessageCard 外观
  - 群设置抽屉
- **W2c 管理后台、设置与登录**
  - 负责文件：`features/admin`、`bots`、`machines`、`config`、`usage`、`auth`（不含 AccountMenu）
  - 后台导航用 Sidebar；表单和设置用 GroupBox
  - 表格统一为 `content-bg` + 发丝行分隔
  - 登录、注册页用 xlarge 主按钮
- **W2d 桌面端**
  - 负责文件：`apps/desktop/src/**`
  - 页面改用 `@web/ui` 组件；`desktop.css` 只保留布局
  - 引导页、设置页用 GroupBox

各切片把自己负责文件里的 `lucide-react` 全部换成 `Icon`。

### W3 收尾（1 个 agent，依赖 W2）

- 删除 D2 的旧变量别名和所有未被引用的 css
- 移除 `lucide-react` 依赖（web 与 desktop）
- 清理硬编码颜色、圆角、字号（grep `#[0-9a-f]{3,8}`、`border-radius: \d`、`font-size: \d`，token 文件除外）
- 全站截图走查：聊天、后台、桌面端，浅色和深色；跑 `pnpm e2e`

## 4. 不做

- 不画假窗口外框和交通灯（D6）
- 不做玻璃折射（沿用旧计划 D4）
- 不改路由、接口、数据结构
- 不引入新的 UI 或动画依赖
