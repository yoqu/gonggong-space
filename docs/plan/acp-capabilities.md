# ACP 适配器能力矩阵（M1 实测，2026-09-23）

环境：macOS arm64，Node v24.15.0，Claude Code 2.1.280，codex-cli 0.156.1。daemon 通过 `npm install --prefix ~/.aiws/adapters` 安装锁定版本，并用 `CLAUDE_CODE_EXECUTABLE` / `CODEX_PATH` 指向本机 CLI。
测试方式：进程内 server + 真实 `aiws run` + 真实 agent，私聊群无仓库（托管空工作区 `_empty/`），bot 档位 `workspace`。每个 agent 跑 5 轮：建文件 → 追问（同进程复用会话）→ 重启 daemon 后改文件（新进程恢复会话）→ 长回复中途 `run.cancel` → 再发一轮。

| 能力 | Claude（claude-agent-acp 0.81.0） | Codex（codex-acp 1.13.0） |
| --- | --- | --- |
| initialize 声明 | loadSession、sessionCapabilities.resume、promptCapabilities.image 均为 true | 同左 |
| 在空工作区建文件 | 通过（`Write` 工具，kind=edit） | 通过（用 shell `printf 'hi' > hello.txt`，kind=execute） |
| 同进程多轮复用会话 | 通过 | 通过 |
| 适配器新进程中恢复会话（session/resume） | 通过，记得上一轮的文件 | 通过，记得上一轮的文件 |
| 取消后在同一会话继续 | 通过：`stopReason=cancelled` → 已中断；下一轮正常完成 | 通过：同左 |
| 用量上报 | PromptResponse.usage（input/output/total）+ usage_update 的累计 cost（USD）。**取消的那一轮 usage 全为 0**，daemon 视为未上报 | PromptResponse.usage（input/output/total），usage_update 无 cost |
| 改动文件数 | 准确（按 edit/delete/move 工具的 locations 去重） | **通常为 0**：Codex 多用 shell 命令改文件，ACP 里是 execute 工具，不带文件位置 |
| 权限请求 | `workspace` 档位下工作区内写文件走 acceptEdits，未出现权限请求 | `agent` 模式下工作区内命令未出现权限请求 |
| 系统提示词注入 | `session/new` 的 `_meta.systemPrompt.append` | 进程级 `CODEX_CONFIG={"developer_instructions":…}` |
| 首轮耗时 | ~40 s（含 adapter 冷启动） | ~20 s |

## 结论与后续
- 会话恢复、取消后继续两边都可用，M3 的「打断并追加」可按「cancel + 新 prompt」实现。
- 改动文件数对 Codex 不可靠，M2 接入 git 后应改为以 `git status` 统计（本轮前后对比）。
- Claude 的 cost 是会话累计值，不是单轮值；用量汇总（M3）需要按轮取差或只用 token 数。
- 本机 `~/.codex/config.toml` 的 `model = "custom/gpt-6"` 在 ChatGPT 账号下直接报 400（`codex exec` 同样失败），实测时用临时 `CODEX_HOME` 把 model 改为 `gpt-5.5`。daemon 应在 Agent 自检（M6 日志与诊断）中暴露这类配置错误；当前错误会作为 agent 的回复文本出现，运行状态仍是「已完成」。
- 图片：两边都声明 `promptCapabilities.image=true`，M4 附件可直接发 ACP image 内容，尚未实测。
