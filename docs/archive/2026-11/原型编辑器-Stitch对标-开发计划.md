# 原型编辑器 · Stitch 对标开发计划

> 依据：`stitch-能力清单.md`（2026-10-29 实测）、`产物托管与编辑-开发计划.md`（托管、版本、编辑的底座与安全约束，本计划全部继承）。分支 `feat/artifacts`，worktree `../ai-chat-artifacts`。**有数据库迁移、三端改动和 daemon 发版，合并 main 前先确认。**
>
> 界面风格一律用共工自己的设计系统（`apps/web/src/ui`、`styles/tokens.css`，深浅色都要好看），只对标 Stitch 的能力与交互，不照搬它的视觉。

## 1. 已定（2026-10-29，姜维川要求一比一参考全部能力；提问超时，以下按推荐项执行）

| # | 项 | 结论 |
|---|---|---|
| B1 | Agent 面板与 AI 输入框 | 复用群聊。画布里选中屏幕或元素，群输入框自动出现上下文芯片（可 ×），@Bot 改；运行卡片即 Agent log。编辑器内的「Edit With AI / Generate 菜单 / Variations」都转成带上下文的 @Bot 消息 |
| B2 | 本期不做 | 导出到第三方（AI Studio / Figma / Netlify / Lovable / Bolt）、Live Mode 语音、Predictive Heatmap、Material You 六种配色自动推导（改为手动调四色 + 种子色生成色阶）、首页项目列表页 |
| B3 | 编辑器位置 | 右侧工作台新标签 `artifact`（ArtifactTab），全宽 focus 模式下就是 Stitch 的整块画布 |
| B4 | 屏幕产物格式 | 沿用 L1：`gg-artifact.json` + `screens/<id>.html` + `tokens.css`（不引入 Tailwind CDN） |

## 2. 能力映射（Stitch → 共工）

| Stitch | 共工实现 | 轮次 |
|---|---|---|
| 项目 | 产物（artifact，属于群，服务端为准，带版本） | R1 |
| 无限画布：点阵、平移缩放、缩放菜单、Zoom to Fit/Selection、快捷键 | ArtifactTab 画布 | R1–R2 |
| 节点：屏幕（全高渲染、标题、尺寸徽标）、设计系统节点（色板、字体样张、组件样张）、DESIGN.md 节点、原型节点 | 画布节点 | R2 |
| 选中：描边、手柄、尺寸徽标、浮动工具条 Generate/Modify/Preview/More、右键菜单、多选、⌘A | 画布交互 | R2 |
| 右侧竖向工具栏：Select V、Mark M、Direct Edit E、Hand H、上传到画布、DESIGN.md、Favourites | 画布工具栏 | R2–R3 |
| Rename / Duplicate / Delete / Favourite / Focus / Copy as PNG / Download | 屏幕操作（改清单 + 新版本） | R2 |
| Direct Edit：Edit Text、Edit With AI、Delete；属性 | 桥接 + 源码编辑（加我们自己的样式属性面板） | R3 |
| Mark 圈画批注 → AI | 批注（按版本） → @Bot | R3 |
| View Details（含 Design Prompt）、View Code、Copy code | 屏幕详情面板、代码弹窗 | R3 |
| Generate 菜单（Instant Prototype、Variations、Regenerate、Desktop Web Version、Missing States、Animate、各类 Assets、Accessibility Audit）、/ 命令、Variations 3x | 指令模板 → @Bot（带上下文） | R3 |
| 选中即上下文、Add to Chat ⌘L | 群输入框上下文芯片 | R3 |
| DESIGN.md 面板：Theme（Mode、Seed、四色、三档字体）/ DESIGN.md 原文，Save / Save & Apply，Presets | 设计系统面板（改 tokens.css / DESIGN.md，生成新版本） | R4 |
| Instant Prototype、原型编辑器 Preview/Edit、Connected 标记、Connect Element（目标屏、转场） | 原型视图 + 连线编辑（改 `data-gg-link`、`data-gg-transition`） | R5 |
| Preview 菜单：New Tab、QR、Mobile/Tablet/Desktop、Full Height | 预览菜单（复用预览分享链接与二维码） | R5 |
| Export：.zip、Code to Clipboard、Project Brief、MCP 说明 | 导出面板（zip、复制代码、让 Bot 写 PRD） | R5 |
| Share：开关 + 复制链接 | 复用 `preview_shares` | R5 |
| Undo/Redo | 版本前进后退（设为当前版本） | R2 |

## 3. 轮次（每轮 = 实现 → 集成自检 → 截图对比 → 差距清单 → 下一轮先修差距）

- **R1 底座**：协议契约与 fixtures；服务端产物表、版本提交、产物 blob、产物预览服务（外壳 + 屏幕从 blob 读取）；daemon 检出与上传；创作改为预分配产物；web ArtifactTab 画布骨架（加载 head 版本、平铺屏幕、平移缩放）、产物卡片打开标签。
- **R2 画布对标**：节点类型、选中与工具条、右键菜单、工具栏、快捷键、缩放菜单、屏幕操作、版本 Undo/Redo。
- **R3 编辑对标**：桥接脚本、Direct Edit、样式属性、Mark 批注、详情与代码、上下文芯片、Generate/Variations 指令。
- **R4 设计系统对标**：DESIGN.md 面板、Theme 字段、Save & Apply、设计系统节点、Presets。
- **R5 原型与导出对标**：原型编辑器、连线、转场、预览菜单、导出、分享。
- **R6+ 打磨**：每轮由对比子 agent 用 ego-browser 在同一窗口尺寸下分别截 Stitch 与共工的对应界面，逐项打分并列差距（能力缺失 > 交互不一致 > 视觉细节），实现子 agent 修复；至少跑到第 5 轮对比。

每轮出口：本轮新增测试全绿、`pnpm check` 全绿、截图发群。

## 4. 不变的约束

继承 `产物托管与编辑-开发计划.md` 的全部 P0/P1 修订：前置上传失败不覆盖本地、产物 blob 独立目录、产物目录不进强制同步、专用 blob 路由鉴权、外壳为唯一可信中继、head CAS 与幂等、`(versionId, file, ggId)` 定位、安全错误硬拒绝。
