# SecureField

密码框：输入内容以圆点显示，右侧眼睛按钮切换明文；大写锁定打开时显示 ⇪ 图标和「大写锁定已打开」提示，和 macOS 登录框一致。

**你需要提供**：与 `TextField` 相同的 `label`、`value`/`defaultValue`/`onChange`、`hint`、`error`；可选 `revealable: false`（不允许查看明文，如确认旧密码）、`autoComplete`（默认 `current-password`，注册时传 `new-password`）。
