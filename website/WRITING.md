# 文档写作规范（共工Bot 帮助手册）

站点：VitePress 1.6，源文件在 `website/`，侧栏见 `.vitepress/config.mts`（页面路径固定，不要改名或增删页面；确需新增先写在本文件末尾「待定」里）。

## 定位与读者
- 产品名：**共工Bot**（英文 gonggong）；命令行叫 `gg`；成员机器上的常驻程序称「daemon」，桌面端应用名 Gonggong（窗口标题「共工」）（以代码里的实际名称为准）。
- 读者：第一次接触的团队成员、搭服务的管理员、想参与开发的贡献者。写给使用者看，不写内部开发过程。

## 事实来源（最重要）
- **一切以当前代码为准**：界面文案去 `apps/web/src`、`apps/desktop/src` 查实际字符串；命令、参数去 `crates/gonggong/src/main.rs`；环境变量去 `apps/server/src`（grep `process.env` / `GONGGONG_`）；系统参数去 `apps/server/src/modules/admin/params.ts`。
- `docs/` 下的计划文档可作背景，但可能过时，与代码冲突时以代码为准。
- 不确定的事不写；禁止臆造按钮、参数、默认值。

## 文风
- 中文，简洁直接，短句。操作步骤用有序列表，按钮/菜单名用「」括起来并与界面完全一致，如 点击「新建 Bot」。
- 术语统一：「Bot」（不写 BOT/bot）、「机器」（不写电脑/设备）、「群」（不写群聊）、「工作区」只指 Bot 的目录、「Agent 命令」。权限档位：只读 / 工作区写入 / 完全访问。
- 禁止出现内部开发备注：一期/二期/P1/切片/待定/需实测/验收 等字眼，也不要提计划文档编号（P4、D17…）。
- 善用 VitePress 容器：`::: tip`、`::: warning`、`::: danger`、`::: details`。代码块标注语言。
- 每页开头一句话说明本页讲什么；结尾可放「相关页面」链接（站内链接用绝对路径，如 `/user/create-bot`，不带 .md）。

## 截图
- 截图统一放 `website/public/screenshots/`，引用写法：`![新建 Bot 对话框](/screenshots/web/new-bot.webp)`（路径以 `/screenshots/` 开头，VitePress 会自动加 base）。
- **只能引用下方清单里的文件名**。清单外需要的图，把需求追加到本文件末尾「截图补充需求」，不要自己编文件名。
- 截图数据是演示数据（团队「星河工作室」，成员 王磊/李娜/陈晨，仓库 `todo-app`），正文举例尽量与之一致。

## 截图清单（Web：1440×900，浅色主题，除注明外）

| 文件 | 内容 |
| --- | --- |
| web/login.webp | 登录页 |
| web/change-password.webp | 首次登录修改密码 |
| web/welcome.webp | 登录后首页/欢迎页 |
| web/interface.webp | 主界面全景（左侧栏群列表 + 群消息 + 右侧栏） |
| web/account-menu.webp | 右上角头像菜单展开 |
| web/bind-machine.webp | 「绑定新机器」对话框（绑定码、复制命令/接入链接） |
| web/machine-dialog.webp | 机器详情（系统信息、在线状态） |
| web/machine-tools.webp | 机器详情 → Agent 工具（Claude Code/Codex/Node 版本、安装升级） |
| web/machine-providers.webp | 机器详情 → 供应商列表 |
| web/provider-editor.webp | 供应商编辑表单 |
| web/new-bot.webp | 「新建 Bot」对话框（名称、机器、Agent、性格角色头像） |
| web/bot-settings.webp | Bot 设置（触发范围、权限档位、并发、审批） |
| web/bot-agent-config.webp | Bot 的模型与推理强度配置 |
| web/bot-page.webp | 与 Bot 私聊页 |
| web/my-bots.webp | 我的 Bot 与用量 |
| web/new-group.webp | 「新建群」对话框（群名、仓库地址校验、拉入 Bot） |
| web/group-settings.webp | 群设置 |
| web/group-info.webp | 群信息侧栏（成员、Bot、公告） |
| web/chat.webp | 群聊全景：多条消息 + 已完成的运行卡片 |
| web/composer-mention.webp | 输入框输入 @ 弹出 Bot 候选 |
| web/composer-commands.webp | 输入框输入 / 弹出指令候选 |
| web/attachments.webp | 消息中的图片/附件 |
| web/run-card.webp | 进行中的运行卡片（共字君动画、步骤） |
| web/process-panel.webp | 右侧「过程」面板（思考、工具调用、命令） |
| web/diff-pane.webp | 右侧 diff 面板（代码高亮） |
| web/gitbar.webp | 群头部 Git 条（分支/提交/同步状态） |
| web/file-viewer.webp | 文件查看（文件树 + 代码高亮） |
| web/context-meter.webp | 群头部 Bot 条的上下文占用（压缩/新对话） |
| web/approval.webp | 权限审批卡片（批准/拒绝） |
| web/question.webp | Bot 向群成员提问的卡片 |
| web/append.webp | 运行中追加消息（打断并追加提示） |
| web/reactions.webp | 消息表情回应 |
| web/notifications.webp | 通知中心面板 |
| web/preview-card.webp | 聊天中的预览卡片 |
| web/preview-workbench.webp | 预览工作台（网页预览标签页） |
| web/preview-share.webp | 分享公开链接对话框 |
| web/theme-dark.webp | 深色主题下的群聊 |
| web/admin-users.webp | 管理后台 · 账号与角色 |
| web/admin-bots.webp | 管理后台 · Bot |
| web/admin-groups.webp | 管理后台 · 群 |
| web/admin-config.webp | 管理后台 · 配置中心 |
| web/admin-params.webp | 管理后台 · 系统参数 |
| web/admin-releases.webp | 管理后台 · 客户端发布 |
| web/admin-machines.webp | 管理后台 · 机器 |
| web/admin-usage.webp | 管理后台 · 用量 |
| web/admin-shares.webp | 管理后台 · 公开链接 |
| web/admin-audit.webp | 管理后台 · 审计记录 |

## 截图清单（桌面端：窗口 1100×720）

| 文件 | 内容 |
| --- | --- |
| desktop/onboarding.webp | 首次引导（粘贴绑定命令） |
| desktop/overview.webp | 概览 |
| desktop/agents.webp | Agent 工具 |
| desktop/bots.webp | Bot 列表 |
| desktop/workspaces.webp | 工作区 |
| desktop/tunnels.webp | 隧道/预览 |
| desktop/live.webp | 实时画面 |
| desktop/logs.webp | 日志 |
| desktop/settings.webp | 设置 |

## 截图补充需求
已补拍：register、settings-account、settings-git、settings-appearance、bot-overview、repo-picker、workspace-picker、interrupt-choice、run-config-chips、admin-user-new、admin-config-mcp、admin-releases-upload（均为 web/*.webp）。

未拍（需真实桌面环境）：web/live-view（gg-cast 录屏需签名与屏幕录制授权）、web/devtools-guide（会启动微信开发者工具）、desktop/permissions、desktop/tray-menu（系统原生菜单）。

重拍：`bash website/scripts/shots-web.sh`（隔离库 gonggong_docs + 真实 Claude/Codex，约 5 分钟）；`node website/scripts/shots-desktop.mjs && bash website/scripts/to-webp.sh`。
