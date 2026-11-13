# 术语表

本页按主题列出共工空间中的常用术语及对应的英文（代码与协议里的叫法），方便对照阅读界面、日志和源码。

## 产品与组件

| 中文 | 英文 | 说明 |
| --- | --- | --- |
| 共工空间 | gonggong-space | 产品名，取自上古水神共工 |
| 共字君 | — | 品牌 IP，扁平的「共」字小人，也是可选的 Bot 角色 |
| 服务器 | server | Fastify + PostgreSQL，负责账号、群、消息与调度 |
| daemon | daemon | 成员机器上的常驻程序，接活并调用本机 Agent |
| gg | gg | daemon 的命令行，`gg run` 启动 daemon，`gg service install` 装成后台服务 |
| 桌面端 | desktop app | 内置 daemon 的图形客户端（Tauri），支持 macOS 与 Windows |
| 共工空间客户端 | client | 界面上对 daemon（命令行或桌面端）的统称 |
| 管理后台 | admin | 系统管理员使用的后台页面 |

## 账号与机器

| 中文 | 英文 | 说明 |
| --- | --- | --- |
| 系统管理员 | sysadmin | 可进入管理后台的角色 |
| 普通成员 | member | 默认角色 |
| 群管理员 | group admin | 可管理某个群的设置、成员与 Bot |
| 团队 | team | Bot、群、Skill 等的归属范围；机器归个人 |
| 机器 | machine | 装有 daemon 并绑定到某个账号的机器 |
| 绑定 | bind / login | 把机器归属到账号的过程，`gg login` |
| 发给你的 Agent | agent onboarding | 把一句话发给本机 Agent，由它安装 `gg`、绑定机器、装成后台服务，并自动建好 Bot 与私聊 |
| 接入码 | bind code | 形如 `XXXX-XXXX` 的一次性码，30 分钟内有效 |
| 接入链接 | bind link | `gonggong://bind?…` 形式的一次性链接，含服务器地址和接入码，用桌面端打开 |
| 接入申请 | link request | 接入码过期或已用时 `gg login` 发起的申请，机器主人在网页核对 4 位核对码后「允许接入」 |
| 后台服务 | service | `gg service install` 安装的常驻服务（macOS launchd、Linux systemd 用户服务） |
| 机器与 Bot | machines | 网页上按机器管理 Bot、Agent 工具、供应商、Git 访问、空间、升级与终端的页面 |
| 终端 | terminal | 机器主人在网页上打开的机器 Shell 会话 |
| 心跳 | heartbeat | daemon 定期发给服务器的在线信号 |
| 吊销 | revoke | 停用账号或移除机器后，服务器拒绝该机器连接 |

## Bot 与 Agent

| 中文 | 英文 | 说明 |
| --- | --- | --- |
| Bot | bot | 群里可 @ 的 AI 成员，固定跑在归属人的某台机器上 |
| 归属人 / Bot 主人 | owner | Bot 属于的成员，唯一能处理其审批卡片、修改审批方式的人 |
| 执行机器 | machine | Bot 运行所在的机器 |
| Agent | agent | 实际干活的 AI 编程工具：Claude Code、Codex、Gemini CLI、CodeBuddy、pi、DeepSeek Harness |
| Agent 插件 | agent plugin | 以插件形式接入的 Agent，Gemini CLI、CodeBuddy、pi、DeepSeek Harness 是内置的 Agent 插件 |
| 角色 | avatar / role | Bot 的头像与性格形象：跟随 Agent、共字君或 12 个性格角色 |
| 系统提示词 | system prompt | Bot 的职责说明，同时作为群内简介 |
| 共享 Bot | shared bot | Bot 主人把 Bot 共享给团队成员，对方可以私聊它 |
| 供应商 | provider | 第三方模型接口地址与 API Key，只保存在本机 |
| ACP | Agent Client Protocol | daemon 驱动 Agent 所用的协议 |
| ACP 适配器 | ACP adapter | 把不自带 ACP 模式的 CLI 包装成 ACP 接口的 npm 包 |
| 内置 MCP | built-in MCP server (`gonggong`) | daemon 为 Agent 提供的工具：读聊天记录、提问、发布预览、交给其他 Bot、知识库、定时任务等 |
| Agent 命令 | agent command | Agent 自带的斜杠命令（如 `/compact`），在群里原样转交给 Agent 执行 |

## 权限与审批

| 中文 | 英文 | 说明 |
| --- | --- | --- |
| 触发范围 | trigger scope | 谁能 @ 这个 Bot：任何群成员（all）/ 指定名单（list）/ 仅本人（self） |
| 审批方式 | approval mode | 每次问我（ask）/ 帮我审批（review）/ 完全允许（full）；可按群单独设置 |
| 帮我审批 | review | 常规开发操作直接放行，其余交给 Agent 内置审核、AI 预审或 Bot 主人 |
| AI 预审 | AI review | 「帮我审批」下由所选小模型先评估请求，只把风险操作交给人，默认关闭 |
| 权限档位 | tier | 审批方式背后的档位：read-only / workspace / full |
| 已允许的命令 | always allow | 审批卡片上「批准，不再询问」记下的命令前缀，之后自动放行 |
| 审批卡片 | approval request | Bot 请求需要把关的操作时出现的卡片，由 Bot 主人批准或拒绝 |
| 本次运行免审批 | allow for this run | 审批卡片上的选项，本次运行临时完全允许，结束后自动恢复 |
| 提问 | question | Bot 向群成员出的选择题或问答题，由触发人、Bot 主人或被 @ 的成员回答 |
| 无权触发 | forbidden | 触发人不在 Bot 的触发范围内 |
| 脱敏 | redaction | 运行过程、diff 等入库前去除密钥等敏感内容 |
| 审计记录 | audit log | 管理操作、审批、指令等的留痕 |

## 群、仓库与工作区

| 中文 | 英文 | 说明 |
| --- | --- | --- |
| 群 | group | 成员和 Bot 一起干活的地方 |
| 公开频道 | public channel | 团队成员可在「浏览频道」里找到并自行加入的群 |
| 私聊 | DM | 只有你和一个 Bot，不用 @ 即可触发 |
| 话题 | thread | 从某条消息展开的讨论，回复不刷主群；Bot 也可以开话题并指派 Bot 接手 |
| 定时任务 | schedule | 群或私聊里按时间自动触发 Bot 的任务 |
| 知识库 | knowledge base | 群内的 markdown 条目，本群所有 Bot 可读，带版本历史 |
| 密钥 | secret | 平台 / 团队 / 群 / 个人四层的敏感值，运行时以环境变量注入并打码 |
| 仓库 | repo | 群绑定的 git 仓库，分主仓库与附加仓库 |
| 基准分支 | base branch | 仓库的主分支，默认 `main`，可设推送保护 |
| 工作区 | workspace | Bot 在某个群里干活的目录，每个「群 × Bot」一个 |
| 托管工作区 | managed workspace | daemon 在 `~/gonggong/workspaces/<群名>/<Bot名>/<仓库名>` 下自动创建的目录 |
| 本机目录（/cd） | cd binding | Bot 主人指定的已有目录 |
| 分区模式 | partition | 群的同步模式：每个 Bot 在自己的工作区独立改动 |
| 强制同步 | force sync | 群的同步模式：不同机器上的 Bot 共用一份工作区，冲突自动三方合并 |
| 基准分支镜像 | mirror | 服务器用自己的 git 凭据保存的基准分支副本，用于 @ 文件候选与搜索 |
| Git 面板 | git panel | 提交、日志、贮藏、分支与冲突处理的集中入口 |

## 运行与结果

| 中文 | 英文 | 说明 |
| --- | --- | --- |
| 运行 / 轮次 | run / turn | @Bot 触发的一轮工作 |
| 运行卡片 | run card | 群里展示一轮运行状态与结果的卡片 |
| 过程 | process | 运行中的思考、工具调用、命令输出 |
| 离线等待 | offline wait | Bot 所在机器离线，请求等待上线 |
| 打断并追加 | append | 运行中追加消息，打断当前轮并补充要求 |
| 接力 | relay / hand off | Bot 通过「交给其他 Bot」工具把任务交给另一个 Bot 继续做（回复里写 @ 只是提及，不会触发） |
| 接力链 | chain（hop） | 由接力串起的多轮运行；每一轮是一跳，链长上限可在群设置调整 |
| 会话 | session | 每个「群 × Bot」持续的 Agent 会话，Bot 据此记得之前的对话 |
| 上下文占用 | context usage | 会话已占用的上下文窗口比例；运行详情的「上下文」页签有构成估算 |
| 压缩上下文 | compact | 把此前对话总结后保留 |
| 开新对话 | new session | 不再带上此前对话，等同 `/new` |
| diff | diff | 代码改动，可按本轮、未提交、相对基准分支查看 |
| 预览 | preview | Bot 发布的网页服务、静态页面、桌面应用或小程序，可在浏览器中打开 |
| 托管服务 | managed service | Bot 在机器上启动并由 daemon 托管的后台服务 |
| 隧道 / 穿透 | tunnel | daemon 与服务器之间转发预览流量的连接 |
| 实时画面 | live view | 桌面应用与小程序预览的实时推流画面 |
| 公开链接 | share link | 给外部人员访问预览或原型的限时链接 |
| 作品 | artifact / work | 服务器托管的原型等产物，带版本，可在画布上批注、交给 Bot 修改 |
| 画布 | canvas | 摆放原型多个屏幕的多屏视图 |
| 插件 | plugin | 可带 MCP 服务、斜杠命令、画布指令、供应商预设或 Agent 的扩展包 |
| Skill 市场 | market | 上传、审核、引入 Skill 与插件的地方 |
| 用量 | usage | Bot 运行消耗的 token 与费用统计 |
| 诊断包 | diagnostics bundle | `gg logs --export` 导出的脱敏 zip |

## 相关页面

- [核心概念](/guide/concepts)
- [系统架构](/guide/architecture)
