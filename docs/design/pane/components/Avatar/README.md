# Avatar

头像：圆形代表人，圆角方形（`shape="square"`）代表群、机器人和应用。

**你需要提供**：`name`（必填，用作无障碍名称和字母头像）、可选 `src`（图片）、`size`（20 / 32 / 40，对应 `avatar-small` / `avatar-regular` / `avatar-large`）、`status`（`online` 绿、`busy` 红、`away` 橙）。

- 没有图片时显示字母/姓名头像：中文人名取最后两个字（「李思远」→「思远」），群名取前两个字（「产品设计组」→「产品」），英文取首字母；底色按名字哈希到 `avatar-1`…`avatar-6`，白字 ≥ 4.9:1。
- 状态点的外圈颜色取父级的 `--pn-ring`（默认 `content-bg`）；放在侧栏里时设为 `sidebar-bg`。
- `AvatarGroup({people, size, max})`：叠放多个头像，超出部分显示「+N」，用于话题回复人、已读成员。
