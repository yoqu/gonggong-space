原方案已归档到 docs/archive/2026-11/Agent工具与供应商统一管理-设计.md

# Agent 工具与供应商 · 待办（核对于 2026-11-15）

- 工具自动升级：每个托管工具一个开关（默认关），空闲时执行；`ToolsSettings` 目前只有 `mirror`。
- 托管 CLI 升级改为「装到新目录、空闲再切换」：现在 `npm i -g --prefix <home>/tools` 原地替换，可能影响运行中的 adapter（`tools.rs` `install_package`）。
- 回收旧的 `<home>/runtime/node-v*`：切换 `current` 后旧版本一直留着（`tools.rs` `install_node`）。
- Bot 解绑或删除后清理 `providers.json` 的 `bots[botId]` 覆盖项（会话锁定已按 5 个 / 30 天裁剪，覆盖项仍残留）。
- 桌面端或 `gg provider use` 改本机默认后立即上报 `bots.providerState`：现在要等下一轮结束、重连或 Web 改动才刷新横条。
- 第三方供应商模型目录实时探测并提供推理强度档位：现在只取声明值、`efforts` 为空（`manage.rs` `catalog`）。
- Windows 托管 Node 与托管 CLI 安装实测（桌面端已发 Windows 版，路径分支未在真机跑过）。
- 二期：团队供应商模板（服务端维护不含 Key 的模板，成员套用后拷贝到本机）。
- 二期：Codex 的 Agent 设置层（config.toml 对应字段）；`AGENT_SETTING_FIELDS` 目前只有 Claude。
