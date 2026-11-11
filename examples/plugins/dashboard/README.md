# 示例插件：数据看板

插件作者的参考样例，演示不改共工核心代码就能新增一类创作：

- `gonggong-plugin.json`：清单。`entry` 指向创作用的 skill，`templates` / `inputs` / `composer` 决定创作面板，
  `icon` 是插件图标，`artifact.kit` 声明画布外壳目录，`contributes.commands` 加了一条聊天命令（`/weekly-report`）和
  一条画布命令（「加下钻页」）。
- `skills/dashboard/SKILL.md`：给 Agent 的说明，产物按 `gg-artifact.json` 多屏约定输出，平台负责托管、画布和编辑。
- `skills/dashboard/shell/`：画布外壳（复制自官方「产品原型」插件，可以按需改样式）。

上传：把这个目录打包后在「市场 → 发布」上传，或系统管理员在「系统设置 → 插件」上传到平台层。约定详见
`docs/plan/插件体系-contributes-方案.md`。
