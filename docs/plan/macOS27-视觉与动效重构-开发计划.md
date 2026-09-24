# macOS 27 视觉与动效重构开发计划

目标：Web 与桌面端（Tauri，复用 `@web/styles`）整体观感对齐 macOS 27 Golden Gate，重点是**材质层级、动画、交互细节**。不改信息架构与业务流程；本计划落地后，视觉以本计划为准，取代原型中的对应样式。

## 1. 调研结论（2026-09）

### 1.1 macOS 27 相对 macOS 26 Tahoe 的设计变化

| # | 变化 | 对我们的含义 |
| --- | --- | --- |
| R1 | Liquid Glass 调低默认透明度，更强地「漫射」背后复杂内容；**加暗边 + 更亮的高光**以增加层次 | 玻璃不是「更透」，而是「磨砂 + 描边 + 高光」；可读性优先 |
| R2 | 设置中新增玻璃滑杆：超清透 ↔ 全着色；仍遵循「降低透明度」「增强对比度」 | 提供用户级「玻璃效果」档位，并响应系统无障碍偏好 |
| R3 | **统一工具栏**：顶部一条磨砂工具栏，标题等自由文字下方用 hard-edge 滚动边缘效果 | 各页顶部栏统一成一种组件，滚动时出现磨砂与分隔 |
| R4 | **侧栏贴边**（不再悬浮）、侧栏图标**恢复彩色**、选中项文字**半粗** | 侧栏贴窗口边、去掉浮动阴影；选中态 = 浅色胶囊 + semibold + 彩色图标 |
| R5 | 所有窗口**统一且更紧的圆角**，并提供「同心圆角」API（`containerConcentric`，近角子元素半径 = 容器半径 − 内边距，有最小值） | 建立同心圆角规则，清理 103 处硬编码圆角 |
| R6 | 新增「交互式玻璃」：控件被点击时玻璃**轻微回弹**；官方强调「少量使用」 | 只给工具栏按钮、分段控件等玻璃控件加回弹，普通按钮不加 |
| R7 | 非活动窗口更易区分（阴影变化、侧栏图标/文字变暗，`appearsActive`） | 窗口失焦时降低侧栏与工具栏强调 |
| R8 | 系统动画更紧凑、更顺滑（官方口径 “Animations are tighter”） | 时长偏短、无拖尾；弹簧为主，默认零回弹 |

### 1.2 HIG 与动画基准

- Motion：动画要有目的、简短精确；**高频交互避免额外动画**；动画可被打断，不让用户等待；动效不能是唯一信息通道。
- Materials：Liquid Glass 只用于**功能层**（工具栏、侧栏、菜单、弹层），**不用于内容层**；文字多的组件（弹窗、侧栏、popover）用 regular（磨砂）变体。
- 弹簧：Apple 以 `duration + bounce` 描述弹簧；预设 `.smooth`(0.5s, 0) / `.snappy`(0.5s, 0.15) / `.bouncy`(0.5s, 0.3)；默认用 bounce 0，UI 元素 bounce 不宜超过 0.4。

### 1.3 Web 可行性

| 能力 | 结论 |
| --- | --- |
| 磨砂玻璃 `backdrop-filter: blur() saturate()` | 全平台可用（含 WKWebView），采用 |
| 折射（SVG `feDisplacementMap` + `backdrop-filter: url()`） | 仅 Chromium 支持，Safari/WKWebView 不支持，且只适配固定尺寸圆角矩形 → **不做** |
| 弹簧曲线 CSS `linear()` | Baseline 2023，采用；用预计算采样点代替 JS 物理引擎 |
| 进入动画 `@starting-style` + `transition-behavior: allow-discrete` | Baseline 2024，采用 |
| `overlay` 过渡属性 | Safari/Firefox 不支持 → 弹层不依赖 top-layer 退出动画 |
| 同文档 View Transitions | Baseline 2025-10，用于主题切换与侧栏选中胶囊等少量场景，不支持时直接切换 |

来源：Apple macOS 27 页面、WWDC26《Modernize your AppKit app》《What’s new in SwiftUI》、MacRumors《All the Liquid Glass Changes in macOS Golden Gate》、Cult of Mac、The Verge 上手、HIG Motion / Materials、WWDC23《Animate with springs》、web.dev Baseline 入场动画、MDN `startViewTransition`。

## 2. 现状

| 项 | 现状 |
| --- | --- |
| 动效 token | `styles/motion.css` 3 个 cubic-bezier 档 + 若干未统一使用的缓动/时长，无弹簧 |
| 动画使用 | 全站仅 3 个 `@keyframes`（spin、flash），过渡约 15 处；弹窗/抽屉/下拉/toast **无入场与退场** |
| 弹层实现 | `ui/overlay.tsx` 的 `Dialog`/`Drawer` 在 `open=false` 时直接 `return null`，退场动画无从谈起 |
| 材质 | `--backdrop-blur` 已定义但未使用；所有面板为实色 |
| 圆角 | `radius.css` 有 token，但 CSS 中 103 处硬编码 `border-radius: Npx`，无同心规则 |
| 减弱动效 | `base.css` 对所有元素 `animation/transition: none !important`，连淡入淡出一起砍掉 |
| 主题偏好 | `app/theme.ts` + `localStorage(aiws.theme)`，浅/深/跟随系统 |

## 3. 决策

| # | 项 | 结论 |
| --- | --- | --- |
| D1 | 实现手段 | 纯 CSS + 少量 React hook，**不引入动画库**（framer-motion 等） |
| D2 | 动效 token | `motion.css` 重写为四档弹簧 + 两档淡入淡出（见 §4.1）；组件只能引用 token |
| D3 | 玻璃范围 | 仅功能层：顶部工具栏、菜单/下拉/popover、弹窗、toast、输入框浮层。侧栏、消息区、卡片保持实色 |
| D4 | 折射 | 不做（D3 已足够，且 WKWebView 不支持） |
| D5 | 玻璃档位 | 外观菜单新增「玻璃效果：清透 / 标准（默认）/ 着色」，`<html data-glass>`，与主题同样存本机 `localStorage(aiws.glass)` |
| D6 | 无障碍 | `prefers-reduced-transparency` / 「着色」档 → 玻璃退化为实色；`prefers-contrast: more` → 加粗描边；`prefers-reduced-motion` → 保留淡入淡出、去掉位移/缩放/回弹 |
| D7 | 退场动画 | 新增 `usePresence(open)`：关闭时先置 `data-state="closed"`，`animationend` 或超时后卸载 |
| D8 | 圆角 | 同心规则：子元素半径 = `max(父半径 − 内边距, 最小值)`；用 CSS 变量 `--r-outer` / `--pad` 计算，不再写死 |
| D9 | 回弹 | 只用于玻璃控件的按下释放（R6）与开关旋钮；其余一律零回弹 |
| D10 | 验收基准 | 运行中的应用（浅/深 × 三档玻璃），不对照原型截图 |

## 4. 设计规范

### 4.1 动效 token（`styles/motion.css`）

| token | 参数（Apple 语义） | 用途 |
| --- | --- | --- |
| `--spring-snappy` | duration 0.35s, bounce 0 | 菜单、下拉、popover、tooltip 入场 |
| `--spring-smooth` | duration 0.45s, bounce 0 | 弹窗、抽屉、侧栏折叠、卡片展开 |
| `--spring-bouncy` | duration 0.4s, bounce 0.15 | 玻璃控件按下回弹、开关旋钮 |
| `--spring-interactive` | duration 0.2s, bounce 0 | 选中胶囊滑动、分段控件指示条 |
| `--fade-in` / `--fade-out` | 150ms / 110ms ease-out | 纯透明度、退场（退场永远比入场快） |

- 弹簧以 `linear()` 采样实现：`tools/gen-springs.mjs` 按 `duration/bounce` 求解阻尼弹簧并输出 `linear(...)` 与对应时长，结果写入 `motion.css` 并提交；脚本附单测校验端点与单调性（bounce 0 时）。
- 高频交互（hover、列表选中、打字流式输出）只做颜色/透明度过渡 ≤ 100ms，不做位移。

### 4.2 材质 token（`styles/materials.css`，新增）

```
--glass-fill        按主题与档位：color-mix(panel, transparent N%)
--glass-filter      blur(24px) saturate(180%)；清透档 blur 更小
--glass-edge        inset 0 0 0 0.5px 暗边（R1）
--glass-highlight   inset 0 1px 0 高光（R1），深色主题降低强度
--scroll-edge-hard  工具栏下方实色渐变遮罩，用于有标题文字处（R3）
```

一个 `.glass` 工具类承载以上四项；不支持 `backdrop-filter` 时回落到 `--color-panel-elevated` 实色（`@supports not`）。

### 4.3 交互细节清单

| 组件 | 入场 | 退场 | 交互 |
| --- | --- | --- | --- |
| Dialog | 遮罩淡入；面板 `scale(.96)→1` + 淡入，`--spring-smooth` | 反向，`--fade-out` | 回车/Esc 关闭时动画可被新打开打断 |
| Drawer | 从右滑入 `translateX(24px)` + 淡入 | 反向加速 | — |
| 下拉/菜单/popover | 从触发点 `transform-origin` 缩放 `.97→1` + 淡入，`--spring-snappy` | 仅淡出 | 选项 hover 为实色高亮，无动画 |
| Toast | 自右上 `translateY(-8px)` + 淡入；堆叠时下移让位 | 向右滑出 + 淡出 | 悬停暂停计时 |
| 工具栏按钮（玻璃） | — | — | hover 出现玻璃胶囊；按下 `scale(.94)`，释放 `--spring-bouncy` 回弹（R6） |
| 普通按钮 | — | — | 按下 `scale(.97)`，无回弹 |
| Switch | — | — | 旋钮 `--spring-bouncy`；按住时旋钮横向拉伸 |
| Tabs / 分段控件 | — | — | 选中指示条滑动 `--spring-interactive` |
| 侧栏 | — | — | 选中胶囊在项间滑动；选中 semibold；彩色图标（R4） |
| 焦点环 | 由外扩 6px 收拢到 3px，120ms | — | 模拟 macOS 焦点环吸附 |
| 可折叠卡片（运行、审批、提问） | `grid-template-rows: 0fr→1fr` + 内容淡入，`--spring-smooth` | 反向 | — |
| 新消息 | `translateY(6px)` + 淡入，仅整条消息入场一次 | — | 流式 token 不做动画 |
| 主题切换 | View Transition 交叉淡入 200ms | — | 不支持时直接切换 |
| 窗口失焦 | `data-window-inactive`：侧栏图标去色、工具栏文字降为次要色（R7） | — | — |

## 5. 切片（TDD，每片测试全绿 + 全量不回归 + typecheck + lint）

### S1 Token 基础
- `tools/gen-springs.mjs` + 单测；重写 `motion.css`（§4.1），新增 `materials.css`（§4.2），`radius.css` 增加同心计算变量。
- `base.css`：减弱动效改为只去位移/缩放，保留 ≤150ms 透明度过渡（D6）。
- 验收：`UiGallery` 新增「动效」「材质」两节，可逐档预览。

### S2 退场动画基础设施与弹层
- 新增 `ui/presence.ts`：`usePresence(open, { timeout })` 返回 `{ mounted, state }`。
- 单测（先写）：关闭后仍挂载且 `state==='closed'`；`animationend` 后卸载；jsdom 无动画时超时兜底卸载；关闭中再次打开恢复 `open`；减弱动效时立即卸载。
- `Dialog`、`Drawer`、`Select` 菜单、`AccountMenu`、通知面板、`Toaster` 接入；按 §4.3 写入/退场样式并套 `.glass`。
- 回归：`ui.test.tsx`、各 feature 中依赖「关闭即卸载」的断言改为等待卸载。

### S3 控件微交互
- `Button`、`IconButton`（工具栏变体为玻璃）、`Switch`、`Checkbox`、`Tabs` 滑动指示条、焦点环动画。
- 测试：`Tabs` 指示条随选中项更新定位变量；其余为样式改动，由 S8 视觉验收覆盖。

### S4 外壳：统一工具栏与侧栏
- 顶部栏统一为 `Toolbar` 组件（聊天、管理、Bot、配置各页复用），`position: sticky` + `.glass`；滚动后出现 hard-edge 滚动边缘（优先 CSS 滚动驱动动画，不支持时用 IntersectionObserver 哨兵置 `data-scrolled`）。
- 侧栏贴边、去浮动阴影；选中胶囊滑动、semibold、彩色图标（颜色取现有语义 token，不新增品牌色）。
- `window` `focus/blur` → `data-window-inactive`（R7）。
- 测试：`data-scrolled` 随哨兵切换；失焦/聚焦切换属性；侧栏选中项 `aria-current` 不变。

### S5 玻璃档位设置
- `app/theme.ts` 旁新增 `glass.ts`（`getGlass/setGlass`，非法值回落「标准」）；`index.html` 内联脚本首屏写 `data-glass`。
- `AccountMenu` 外观区增加三档；桌面端设置页同步。
- 测试：默认值、持久化、非法值回落、切换后 `dataset.glass` 变化。

### S6 圆角与硬编码清理
- 103 处 `border-radius: Npx` 改为 token 或同心计算；窗口级容器统一 `--radius-window`，数值按 macOS 27 截图测量后定稿（R5）。
- 验收：`grep -rnE "border-radius: [0-9]+px" apps/web/src --include='*.css'` 仅剩 `styles/` 定义行。

### S7 内容区动效
- 运行卡片、审批卡、提问卡折叠展开；新消息入场；主题切换 View Transition。
- 测试：新消息只在首次挂载带入场类，流式更新不重复触发。

### S8 桌面端与验收
- Tauri（WKWebView）逐项确认 `backdrop-filter`、`linear()`、`@starting-style` 生效；原生标题栏/红绿灯区域与统一工具栏对齐，涉及 Tauri 窗口 API 时先查官方文档。
- 运行中应用走查：浅/深 × 清透/标准/着色 × 减弱动效/减弱透明度/增强对比度；正文对比度 ≥ 4.5:1（玻璃上按最差背景测）。
- 性能：Chrome Performance 录制打开弹窗、滚动长会话，确保无掉帧与持续重绘；`backdrop-filter` 元素同屏 ≤ 3 个。
- e2e：`m0-skeleton` 增加「打开并关闭弹窗后节点被移除」「切换玻璃档位刷新后保持」。

## 6. 不做

- 折射/色散（D4）、JS 物理弹簧引擎、下拉刷新（桌面 Web 无对应手势）。
- 内容层玻璃化（消息气泡、卡片、表格）。
- 路由级整页过渡动画。
