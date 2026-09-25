# Disclosure

折叠组：带展开三角的标题，点开显示下面的内容（DisclosureGroup）。用来收起不常用的「高级」设置或长段详情。

**你需要提供**：`title`、`children`、可选 `open`/`defaultOpen`/`onToggle`、`summary`（折叠时在右侧显示摘要，如「3 项设置」）、`variant: 'group'`（放进圆角分组框里，和 `GroupBox` 并列时使用）。

- 三角旋转 90° 表示展开；内容缩进 20px，与标题文字对齐。
- 默认折叠的内容不能是完成任务必需的；读屏通过 `aria-expanded` 朗读展开状态。
