# Changelog

## v0.1.0 — 2026-10-01

首个公开版本 / First public release.

- 群聊协作：在群里 @ Bot，成员机器上的 Claude Code / Codex 开工；追加、打断、`/stop`，Bot 之间接力
- 自托管：server（Fastify + PostgreSQL）只做路由、中继与审计；daemon `gg`（Rust）只向外连接，模型 Key 与 git 凭据留在成员机器
- 过程与改动：思考、工具调用、命令输出实时回传；diff、Git 状态、文件树、token 与上下文用量
- 结果预览：网页、接口、静态报告、桌面应用窗口、微信小程序模拟器在群里打开，可生成限时公开链接
- 权限与审批：只读 / 工作区可写 / 完全访问三档，越档操作由 Bot 主人审批；Bot 可在群里向成员提问
- 国内开箱即用：默认 npmmirror，一键安装 Node、Claude Code、Codex，内置模型厂商预设，可导入 CC Switch 配置
- macOS 桌面端（内置 daemon，已签名公证）；`gg` 支持 macOS / Linux / Windows
- Docker Compose 一键部署
- 中文 / English 界面
