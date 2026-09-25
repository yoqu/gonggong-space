一套在网页上复刻 macOS 27（Golden Gate）观感的 React 组件库：Liquid Glass 材质、胶囊控件、贴边侧栏、统一工具栏，另含一套飞书式 IM 聊天组件。数值参照 Apple 官方 macOS 27 UI Kit 与 Human Interface Guidelines；它是风格复刻，不包含 Apple 的字体文件、图标或标志。

## 设计原则

- **内容优先，玻璃浮于其上。** 只有浮层（工具栏分组、菜单、Alert、弹出框）用 Liquid Glass（`glass-fill` + `glass-blur` + `shadow-glass`）；内容区、列表、表单用不透明的 `content-bg` / `window-bg`。不要把整块内容做成玻璃。
- **可读性优先于通透（macOS 27 的修正方向）。** 默认玻璃是偏不透明的 `glass-fill`；`glass-fill-clear` 只用于装饰层。玻璃外缘用 `glass-edge` 加深，顶部用 `glass-specular` 提亮，让它在复杂背景上依然有轮廓。
- **一致的形状。** 可点击控件一律胶囊形（`radius-capsule`）；容器按层级用 `radius-field` 8 → `radius-menu` 12 → `radius-window` 14。macOS 27 收小并统一了窗口圆角，不要再用 Tahoe 那种 20px 以上的大圆角。
- **侧栏贴边，不悬浮。** 侧栏用 `sidebar-bg`，与内容之间仅一条 `separator` 发丝线，没有阴影和外边距；侧栏图标重新使用 `system-*` 彩色。

## 内容与文案

- 界面语言为简体中文，沿用 macOS 中文版的用词：「存储」而不是「保存」，「移到废纸篓」，「显示简介」，「偏好设置」→「系统设置」。
- 按钮是动词短语，不加句号：「存储」「不存储」「取消」。需要进一步输入的操作以省略号结尾：「重新命名…」「了解更多…」。
- Alert 标题写成问句并点明后果：「要将“季度报告”移到废纸篓吗？」；正文一两句，说明是否可撤销。
- 用「你」称呼用户；不用感叹号、不用 emoji。
- 快捷键使用系统符号 ⌘ ⌥ ⇧ ⌃ ⌫，写在菜单项右侧 `label-secondary`。

## 颜色

- 四套主题：`light`、`dark`，以及对应 macOS「增强对比度」的 `hc-light`、`hc-dark`。所有组件只读 token，切换祖先上的 `data-theme` 即可换肤。
- 文字：主要文字 `label`，次要 `label-secondary`，二者在 `window-bg`、`content-bg`、`sidebar-bg`、两种气泡和玻璃上都 ≥ 4.5:1（增强对比度主题 ≥ 7:1）。`label-tertiary` 只用于占位符和禁用态（浅色 / 深色下与系统一致，低于 4.5:1）。
- 强调色：`accent`（systemBlue）用于非文字的选中指示、开关、滑块、勾选框；链接和强调文字用 `accent-text`；主按钮底色和菜单高亮用略深的 `accent-fill` / `menu-highlight`，保证白字 `on-accent` ≥ 4.7:1。破坏性按钮 `destructive-fill` 同理。
- `system-*` 13 色（macOS 26/27 更新后的系统色）用于侧栏图标、标签、状态点、图表，不用作小号正文文字。状态不只靠颜色：错误提示同时带「⚠」符号和文字。
- 列表与表格：隔行底色 `row-alt`；选中行有焦点时 `menu-highlight` + `on-accent`，失焦后 `selection-inactive`（明显深于隔行底色）。Sheet 与对话框背后的遮罩用 `scrim`。
- `traffic-*` 仅用于窗口交通灯；非活动窗口统一为 `traffic-inactive`。
- `wallpaper-*` 只在演示页做桌面背景，用来展示玻璃的透视。

## 字体与排版

- 字体栈 `--font-sans`：Apple 设备上直接调用系统的 SF Pro 与苹方，其他平台回退到 system-ui。库中不附带 SF Pro 字体文件——Apple 的授权只允许在 Apple 平台上的界面设计中使用它。
- 文字样式照搬 macOS 的 Dynamic Type 表：`body` 13/16 是默认；`headline` 13/16 粗体用于窗口标题与分组标题；`subheadline` 11/14 semibold + `label-secondary` 用于侧栏分组标题；`title-1`、`large-title` 用于设置面板顶部。
- macOS 界面文字比网页小：正文就是 13px，不要放大到 16px。

## 尺寸、间距与布局

- 控件高度四档：`control-small` 20、`control-regular` 24（默认）、`control-large` 30、`control-xlarge` 36。同一行里的控件用同一档。
- 相邻控件间距 `space-8`；窗口内容边距 `space-20`；分组内边距 `space-16`。
- 统一工具栏高 `toolbar-height` 52px：标题在左，右侧是玻璃胶囊分组（`ToolbarGroup`），搜索框放最右。
- 设置类页面用 `GroupBox` + `GroupRow`：左标签、右控件、行间 `separator`（系统设置风格，参照「SettingsExample」）；Sheet 和对话框里的表单用 `Form` + `FormRow`：标签右对齐成一列（经典偏好设置风格）。
- 需要一小组输入再确认的任务用 `Sheet`（窗口内模态），只需确认的用 `Alert`，网页里没有窗口时用 `Dialog`。

## 阴影与状态

- 活动窗口 `shadow-window`，非活动 `shadow-window-inactive`（macOS 27 加强了两者的区别）。
- 控件表面 `shadow-control`（0.5px 描边 + 细投影）；菜单 `shadow-menu`；玻璃浮层 `shadow-glass`。
- 按下：`control-fill-pressed`，有色按钮降低亮度。禁用：整体 45% 不透明度。
- 键盘焦点：3px 实线 `focus-ring` 外环，偏移 1px，在 `content-bg`、`window-bg`、`sidebar-bg` 上都 ≥ 3:1。
- 动效克制：开关圆钮带轻微回弹，其余为 150–250ms 的淡入/位移；尊重「减少动态效果」。

## 无障碍

- **增强对比度**：`hc-light` / `hc-dark` 是额外主题，不改动品牌的浅色 / 深色。文字 ≥ 7:1；玻璃几乎不透明；分隔线、控件描边、所有阴影都带 ≥ 3:1 的实线；原本靠底色区分的元素（分段控件、搜索框、开关轨道、气泡、标签、分组框）通过 `shadow-outline` 画出轮廓；`system-*` 换成系统的高对比度版本。
- **键盘**：列表类组件（`Sidebar`、`ConversationList`、`NavRail`、`SegmentedControl`、`ColorWell inline`）只占一个 Tab 位置，方向键移动并选中，Home/End 到首尾，树形条目 → 展开 ← 折叠；`Table` 支持 ↑↓、⇧ 扩选、⌘A、Enter 打开；菜单类（`Menu` 含子菜单、`PopUpButton`、`PullDownButton`、`ContextMenu`）↑↓ 移动、→ 进入子菜单、Enter 选中、Esc 关闭并把焦点还给触发元素，按字母跳转；`Calendar` 方向键按天 / 按周、PageUp/PageDown 翻月；`ComboBox`、`TokenField`、@成员、表情浮层都能只用键盘完成；`Sheet` / `Dialog` 打开时焦点进入、Tab 在内部循环、Esc 关闭、关闭后焦点归还。
- **不只靠颜色**：错误带「⚠」和文字；已读回执靠形状；加急有文字和闪电；状态标签都有文字。
- **动效**：所有循环动画（进度、骨架流光、正在输入、会议进行中）在「减少动态效果」下静止或放慢。
- **读屏**：图标按钮都有 `aria-label`；列表、菜单、选择浮层使用对应的 ARIA 角色；「正在输入」「拷贝成功」用 live region 播报。

## 组件目录

- **操作**：`Button`（五种样式、四档尺寸、`loading`）、`PullDownButton`（标题固定的下拉菜单按钮）、`PopUpButton`（选择当前值）、`HelpButton`、`Link`
- **输入**：`TextField`（前后缀、清除）、`SecureField`、`TextArea`、`SearchField`、`Stepper`、`ComboBox`、`TokenField`、`DatePicker` / `Calendar`、`ColorWell`、`Slider`、`DropZone`
- **选择**：`Checkbox` / `CheckboxGroup`、`RadioGroup`、`Switch`、`SegmentedControl`
- **数据展示**：`Table`（排序、多选、树形）、`LevelIndicator`（容量、分格、评分）、`ProgressIndicator`、`PathControl`、`Tag` / `Badge`、`Avatar`
- **菜单与浮层**：`Menu`（子菜单）、`ContextMenu`、`Popover`、`Tooltip`
- **窗口结构**：`Window`（`rail` / `sidebar` / `toolbar` / `inspector`）、`Toolbar`、`Sidebar`（可折叠分组、嵌套、色块图标）、`TabView`、`Sheet`、`Dialog`、`Alert`
- **布局**：`Form` / `FormRow`、`GroupBox` / `GroupRow`、`Disclosure`、`Divider`
- **反馈**：`Toast` / `HUD`、`NotificationBanner`、`EmptyState`、`Skeleton`、`Kbd`
- **整页模板**：「SettingsExample」系统设置式窗口、「FinderExample」文件窗口、「IMExample」「IMThreadExample」聊天窗口

## 图标

- 原生 App 请用 SF Symbols。网页端的 `Icon` 组件是一组原创线性图标（18×18 画布、1.4 描边、圆头圆角），风格贴近 SF Symbols 但不是 Apple 图形——这是有意的替代。
- 侧栏图标着 `system-*` 色；工具栏和菜单图标用 `label` 色。按照 macOS 27 的做法，菜单里只给最常用的几项配图标。

## IM 聊天

IM 组件照搬办公 IM（飞书）的信息结构——会话列表、@提及、加急、表情回复、话题、已读回执、消息卡片、云文档卡片、群公告——外观则按 macOS 27 处理：会话列表就是贴边侧栏，聊天头部就是统一工具栏，悬停操作条和群公告用 Liquid Glass，按钮和标签一律胶囊形。

- **窗口结构**：`Window` 的 `rail` 放 `NavRail`（应用导航），`sidebar` 放 `ConversationList`，`toolbar` 放 `ChatHeader`，内容区从上到下是 `PinnedBanner`（浮动）、`MessageList`、`Composer`；右侧 `inspector` 按需停靠 `ChatInfoPanel`（群设置）或 `ThreadPanel`（话题）。参照「IMExample」卡片。
- **气泡**：他人 `bubble-in`，自己 `bubble-out`（浅蓝底、深色字），圆角 `radius-bubble`，靠近头像的上角收为 5px 表示方向，不画尾巴。气泡里的链接和 @ 一律用 `bubble-link`（`accent-text` 在浅蓝底上不够清楚）。@我 用 `accent-fill` 实心胶囊 + `on-accent`。
- **卡片不套气泡**：文件、图片、云文档、消息卡片、会议、日程在 `Message` 里加 `bare`，用 `content-bg` + 发丝描边的卡片呈现。语音、链接预览、代码块留在气泡里。
- **浮层**：@成员（`MentionPicker`）、表情（`EmojiPicker`）、名片（`Popover` + `ProfileCard`）、右键菜单（`ContextMenu` + `messageMenuItems`）都用和菜单相同的玻璃材质；系统通知横幅（`NotificationBanner`）是圆角 18px 的玻璃卡片。
- **状态**：没有内容用 `EmptyState`，加载中用形状一致的 `Skeleton`，对方输入中用 `TypingIndicator`，撤回用 `ChatNotice kind="recalled"`。
- **提醒的强度从低到高**：未读徽标（`badge-fill`）→「[有人@我]」前缀 →「加急」标签（`solid-red`）+ 气泡红色描边 + `ChatNotice kind="urgent"`。加急每条会话同时最多一条。免打扰会话的徽标用 `badge-muted`。
- **状态不只靠颜色**：已读回执靠「空心 / 饼图 / 打勾」三种形状区分；发送失败用红底感叹号并提供「重新发送」；加急同时有文字和闪电图标。
- **文案**：时间写「10:42 / 昨天 / 星期二 / 9月20日」；系统消息写陈述句「张三 邀请 李四 加入了群聊」；未读分隔写「以下为新消息」；输入框占位写「发送给 某人」。
- **标签颜色**：`orange` 外部、`blue` 机器人、`green` 官方、`purple` 全员、`gray` 部门——整个产品保持同一套对应。
- **头像**：人用圆形，群、机器人、应用用圆角方形；没有图片时显示姓名头像，底色取 `avatar-1`…`avatar-6`。

## 使用

```jsx
const { Window, Sidebar, Toolbar, ToolbarGroup, ToolbarButton, Button } = window.Pane;
<div className="pn" data-theme="light">
  <Window title="文稿" sidebar={<Sidebar sections={…} />}>
    <Button variant="primary">存储</Button>
  </Window>
</div>
```

根节点加 `pn` 类以获得字体与基础文字样式；深色模式在任一祖先上设置 `data-theme="dark"`。
