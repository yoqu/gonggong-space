# 术语表

本页按主题列出共工空间中的常用术语及对应的英文（代码与协议里的叫法），方便对照阅读界面、日志和源码。

## 产品与组件

| 中文 | 英文 | 说明 |
| --- | --- | --- |
| 共工空间 | gonggong-space | 产品名，取自上古水神共工 |
| 共字君 | — | 品牌 IP，扁平的「共」字小人，也是 Bot 的默认角色 |
| 服务器 | server | Fastify + PostgreSQL，负责账号、群、消息与调度 |
| daemon | daemon | 成员机器上的常驻程序，接活并调用本机 Agent |
| gg | gg | daemon 的命令行，`gg run` 启动 daemon |
| 桌面端 | desktop app | 内置 daemon 的 macOS 图形客户端（Tauri） |
| 共工客户端 | client | 界面上对 daemon（命令行或桌面端）的统称 |
| 管理后台 | admin | 系统管理员使用的后台页面 |

## 账号与机器

| 中文 | 英文 | 说明 |
| --- | --- | --- |
| 系统管理员 | sysadmin | 可进入管理后台的角色 |
| 普通成员 | member | 默认角色 |
| 群管理员 | group admin | 可管理某个群的设置、成员与 Bot |
| 机器 | machine | 装有 daemon 并绑定到某个账号的机器 |
| 绑定 | bind / login | 把机器归属到账号的过程，`gg login` |
| 接入链接 | bind link | `gonggong://bind?…` 形式的一次性链接，含服务器地址、绑定码和证书指纹 |
| 绑定码 | bind code | 形如 `XXXX-XXXX` 的一次性码，有有效期 |
| 证书指纹 | certificate fingerprint | 服务器证书的 SHA-256，daemon 据此固定（pin）服务器证书 |
| 心跳 | heartbeat | daemon 定期发给服务器的在线信号 |
| 吊销 | revoke | 停用账号或移除机器后，服务器拒绝该机器连接 |

## Bot 与 Agent

| 中文 | 英文 | 说明 |
| --- | --- | --- |
| Bot | bot | 群里可 @ 的 AI 成员，固定跑在归属人的某台机器上 |
| 归属人 / Bot 主人 | owner | Bot 属于的成员，唯一能审批其越权操作、修改命令审批的人 |
| 执行机器 | machine | Bot 运行所在的机器 |
| Agent | agent | 实际干活的 AI 编程工具：Claude Code（`claude`）或 Codex（`codex`） |
| 角色 | avatar / role | Bot 的头像与性格形象：共字君或 12 个性格角色 |
| 系统提示词 | system prompt | Bot 的职责说明，同时作为群内简介 |
| 供应商 | provider | 第三方模型接口地址与 API Key，只保存在本机 |
| ACP | Agent Client Protocol | daemon 驱动 Agent 所用的协议 |
| ACP 适配器 | ACP adapter | 把 Claude Code / Codex 包装成 ACP 接口的 npm 包 |
| 内置 MCP | built-in MCP server (`gonggong`) | daemon 为 Agent 提供的工具：读聊天记录、提问、发布预览、交给其他 Bot 等 |
| Agent 命令 | agent command | Agent 自带的斜杠命令（如 `/compact`），在群里原样转交给 Agent 执行 |

## 权限与审批

| 中文 | 英文 | 说明 |
| --- | --- | --- |
| 触发范围 | trigger scope | 谁能 @ 这个 Bot：任何群成员（all）/ 指定名单（list）/ 仅本人（self） |
| 权限档位 | tier | 只读（read-only）/ 工作区写入（workspace）/ 完全访问（full） |
| 命令审批 | approval | 越权请求的处理方式：每次询问（ask）/ 白名单自动（allowlist）/ 全部自动（all） |
| 命令白名单 | allowlist | 白名单自动模式下自动放行的命令前缀，如 `go build` |
| 权限审批 | approval request | Bot 请求越权操作时出现的卡片，由 Bot 主人批准或拒绝 |
| 提问 | question | Bot 向群成员出的选择题或问答题，由触发人或 Bot 主人回答 |
| 无权触发 | forbidden | 触发人不在 Bot 的触发范围内 |
| 脱敏 | redaction | 运行过程、diff 等入库前去除密钥等敏感内容 |
| 审计记录 | audit log | 管理操作、审批、指令等的留痕 |

## 群、仓库与工作区

| 中文 | 英文 | 说明 |
| --- | --- | --- |
| 群 | group | 成员和 Bot 一起干活的地方 |
| 私聊 | DM | 只有你和你的 Bot |
| 仓库 | repo | 群绑定的 git 仓库 |
| 基准分支 | base branch | 群仓库的主分支，默认 `main` |
| 工作区 | workspace | Bot 在某个群里干活的目录，每个「群 × Bot」一个 |
| 托管工作区 | managed workspace | daemon 在 `~/.gonggong/workspaces/` 下自动创建的目录，绑定仓库时是托管克隆 |
| 本机目录（/cd） | cd binding | Bot 主人用 `/cd` 指定的已有目录 |
| 默认工作区 | default workspace | 未绑定仓库的群和私聊中 Bot 使用的目录 |
| 分区模式 | partition | 群的同步模式：每个 Bot 在自己的工作区独立改动 |
| 基准分支镜像 | mirror | 服务器用自己的 git 凭据保存的基准分支副本，用于 @ 文件候选与搜索 |

## 运行与结果

| 中文 | 英文 | 说明 |
| --- | --- | --- |
| 运行 / 轮次 | run / turn | @Bot 触发的一轮工作 |
| 运行卡片 | run card | 群里展示一轮运行状态与结果的卡片 |
| 过程 | process | 运行中的思考、工具调用、命令输出 |
| 离线等待 | offline wait | Bot 所在机器离线，请求等待上线 |
| 打断并追加 | append | 运行中追加消息，打断当前轮并补充要求 |
| 接力 | relay / hand off | Bot 通过「交给其他 Bot」工具把任务交给群里另一个 Bot 继续做（回复里写 @ 只是提及，不会触发） |
| 接力链 | chain（hop） | 由接力串起的多轮运行；每一轮是一跳，链长上限可在群设置调整 |
| 会话 | session | 每个「群 × Bot」持续的 Agent 会话，Bot 据此记得之前的对话 |
| 上下文占用 | context usage | 会话已占用的上下文窗口比例 |
| 压缩上下文 | compact | 把此前对话总结后保留 |
| 开新对话 | new session | 不再带上此前对话，等同 `/new` |
| diff | diff | 代码改动，可按本轮、未提交、相对基准分支查看 |
| 预览 | preview | Bot 发布的网页服务、静态页面、桌面应用或小程序，可在浏览器中打开 |
| 托管服务 | managed service | Bot 在机器上启动并由 daemon 托管的后台服务 |
| 隧道 / 穿透 | tunnel | daemon 与服务器之间转发预览流量的连接 |
| 实时画面 | live view | 桌面应用与小程序预览的实时推流画面 |
| 公开链接 | share link | 给外部人员访问预览的限时链接 |
| 用量 | usage | Bot 运行消耗的 token 与费用统计 |
| 诊断包 | diagnostics bundle | `gg logs --export` 导出的脱敏 zip |

## 相关页面

- [核心概念](/guide/concepts)
- [系统架构](/guide/architecture)
