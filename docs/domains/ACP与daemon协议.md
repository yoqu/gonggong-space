# ACP 与 daemon 协议 · 现状

> 范围：daemon 与服务端的连接与消息、能力协商与版本兼容、daemon 用 ACP 驱动 Agent（会话、权限、MCP、系统提示词）、运行生命周期与审批、网页终端、重连与离线。只写仍有效的决定，以代码为准，更新于 2026-11-22。

## 契约与 fixture
- 全部线上消息在 `packages/protocol/src/daemon/`（zod，`daemon.ts` 为桶文件）：`DaemonToServer`（d2s）、`ServerToDaemon`（s2d），按字段 `t` 区分（如 `run.start`、`run.done`）；Rust 镜像在 `crates/gonggong/src/protocol/`（serde，子模块与 TS `src/daemon/` 对齐）。
- 共享样例 `packages/protocol/fixtures/*.json`，文件名前缀决定类型：`d2s.*`、`s2d.*`、`tunnel.*`、`terminal.*`、`http.*`（机器 token 的 REST 体）、`data.agent-setting-fields`。
- 往返校验两边都跑：TS `packages/protocol/test/fixtures.test.ts`，Rust `crates/gonggong/tests/it/contract.rs`（`every_shared_fixture_round_trips`）；改协议先改 protocol，再加 fixture、同步 `protocol/`。
- 新字段一律可选或带默认值（`.default(...)` / `#[serde(default)]`），旧端缺字段照常解析。
- daemon 收到不认识的 s2d 消息只记日志忽略（`service.rs`）；服务端收到解析失败的 d2s 消息打日志丢弃（`apps/server/src/daemon/gateway.ts`）。

## 连接与握手
- 单条 WebSocket `/ws/daemon`；首条必须是 `hello`（`protocol`、`token`、`daemonVersion`、`machine`、`agents`、`activeRuns`、`services`、`features`、`terminals`）。
- 服务端回 `welcome`（`machineId`、`heartbeatSec`、`upgrade`、`tunnel`、`release`）或 `reject`（`RejectReason`：protocol / revoked / unauthorized）。
- 关闭码 `CLOSE`：4000 握手不对/token 未知、4001 协议过低、4002 被同机新连接顶替、4003 机器吊销或主人停用、4004 心跳超时（`gateway.ts`）。
- 协议版本 `PROTOCOL_VERSION = 1`（TS 与 Rust 各一处）；`hello.protocol` 低于它即 `reject protocol`，附 `minProtocol` 与可用的 `upgrade`，daemon 收到后 `apply_now` 立即升级。
- 同一机器只保留一条连接（`DaemonHub.register` 关掉旧的）；请求-应答走 `hub.request(requestId, 期望的回复 t, 超时)`，离线或超时得 undefined。
- 心跳：daemon 每 `heartbeatSec` 发 `heartbeat` + WebSocket ping，上个 ping 未回 pong 即判链路死；服务端 `heartbeatSec × offlineMisses` 没收到任何消息即断开。
- TLS：非本机只允许 https/wss，默认系统 CA，私有 CA `--ca-file`、自签 `--fingerprint`；HTTP 与 WS 共用 `tls.rs` 配置；`GONGGONG_INSECURE_DEV=1` 仅限本地开发。

## 能力协商与版本兼容
- 可选能力用 `hello.features`（`DaemonFeature` 枚举，Rust 侧 `FEATURE_*` 常量）声明，服务端存在 `DaemonHub.caps`，`hub.features(machineId)` 查询；未知能力名保留不报错。
- 能力决定服务端发什么：如 `plugins` 才下发 `RunStart.plugins`、`pluginMcp` 才带插件 MCP、`artifacts` 才带产物、`gitOps*` / `gitRepos` 决定 git 面板可用操作、`sync` 决定能否参与强制同步（缺则本轮不同步）。
- 后加的 Agent（gemini/codebuddy/pi/deepseek/antigravity）以同名 feature 声明；缺能力的机器上这类 Bot 的运行停在 `offline_wait`，提示「客户端版本过低」（`scheduler.ts` 的 `LATER_AGENTS`）。
- `container`、`noAutoUpgrade` 不是能力，只是告知服务端该 daemon 不会自行升级；`upgrade` 仅 Linux CLI daemon 且启用升级器时声明。
- `terminal-v2`、`terminal-dir` 只在 macOS/Linux 声明，Windows 不暴露终端（`engine.rs` `features()`）。

## 重连与离线
- daemon 断线后指数退避 1→2→4…最多 30 秒（`MAX_BACKOFF`），每次带 ±50% 抖动；连上过再断则从 1 秒重来（`service.rs`）。
- 未发出的 d2s 消息存 `Backlog`，跨重连按序补发；超 16MB 只丢 `run.event`，其余必留；流式文本 80ms 内合并。
- `run.done` 写出后要等下一个 pong 确认，否则下次连接重发（服务端对重复 `run.done` 幂等）。
- 重连 hello 的 `activeRuns` 含本机仍在跑和已结束待补发的运行；服务端 `reconcileRuns` 把该机器其余 running/等待审批/等待回答的运行标为「daemon 重启，本轮已中断」，并作废其审批与提问。
- `hello.services` 对账托管服务、`hello.terminals` 对账终端；机器上线（`online`）后服务端重新 `schedule` 该机器所有 Bot 并补完 `finalizing` 的运行。
- Bot 离线时触发的运行进 `offline_wait`，超过群参数 `offlineWaitMin`（默认 30 分钟）作废并通知触发人（`runs/stop.ts` `expireOfflineRuns`）。

## 运行生命周期
- 调度以服务端为准（`runs/scheduler.ts` `schedule`）：按 Bot 加 advisory 锁，按触发消息 seq 顺序派发；同一（会话, Bot）同时只跑一轮，其余排队，会话指群主时间线或某个话题（话题有独立 session，与主会话、其他话题互不排队；共用工作目录的并行写由 daemon 目录忙提问卡兜底）。按触发消息所在话题算，「Bot 回复进话题」的群里主时间线的轮次仍算主会话。daemon 按（群, Bot, 话题）各开一个会话（`RunStart.threadRootId`，特性 `threadSessions`）；不带该特性的旧 daemon 和强制同步群（单副本一次只给一轮）仍按群串行；占用并发槽位的状态为 `ACTIVE`（running / awaiting_approval / awaiting_answer）。
- 不派发的原因写进 `step`：本群/本话题上一轮未结束、强制同步挂起、工作区准备中、客户端版本过低、Bot 忙、Bot 离线。
- 事务内先标 running 再提交后发送 `run.start`；发送失败退回 `offline_wait`，提交后崩溃由下次 hello 对账中断。
- `RunStart` 携带：bot（agentKind、systemPrompt、tier、model/effort、approval、allowlist、alwaysAllow、aiReview、git 身份、agentSettings）、`workspace`、`resumeSessionId`/`newSessionReason`、prompt（text、context、omitted、fallbackContext、attachments、quote）、`mcpServers`、`skills`、`plugins`、`hiddenTools`、`command`、`sync`、`artifacts`、`env`（密钥，仅内存）。
- 过程以 `run.event` 上报（`RunEvent`：text / thought / tool / status / usage / task / subagent / compaction / plan），服务端按机器串行处理，积压超 32MB 时丢流式片段（`runs/engine.ts`）。
- `plan`：ACP 标准 `plan` 更新（Claude Code 的 TodoWrite/Task*、Codex 的计划、CodeBuddy 的 TodoWrite 都转成它；Gemini、Pi、DeepSeek 不发）。daemon 只收主 Agent 的、整份替换、与上一份相同不发，最多 100 条、每条 500 字（`turn.rs`）。服务端照常记入 `run_events`，最新一份另存 `runs.plan`（空条目置空）随 `RunDto.plan` 返回，用于运行卡片「计划」块、任务栏圆环和运行页顶部面板；与 `progress_card` 是两套：进度卡由 Bot 主动调用，计划是 Agent 自己的清单，两者并存时进度卡在前、计划折叠。旧服务端会把 `plan` 当无效消息丢弃并记日志，所以服务端先于客户端上线。
- 结束 `run.done`：`outcome` 为 completed / interrupted / failed，带 `reply`、`usage`、`sessionId`、`newSessionReason`、`git`、`patch`、`repos`、`appendsApplied`、`sync`。
- Antigravity CLI 不发子 agent / 异步任务扩展（子 agent 只是一条立即返回的 `invoke_subagent` 调用，转后台的 `run_command` 回合结束后才完成）：daemon 跟读它的 transcript（`<agy home>/brain/<会话>/.system_generated/logs/transcript.jsonl`，子 agent 各一份），转成 `subagent` / `task` 及子 agent 自己的过程事件（`antigravity.rs`）。它们归属发起时的运行（嵌套子 agent 归父 agent 的），运行结束后照常上报，服务端对 `subagent`、`task` 及带 `agentId` 的事件接受已结束运行；适配器进程退出时仍在跑的报 `disconnected` / `stopped`。主 agent 在 transcript 里写出不调用工具的回复即视为本周期结束，回合间的续跑运行 3 秒无新输出就收尾（不等 5 分钟静默）。
- s2d 控制：`run.cancel`（/stop，daemon 发 ACP `session/cancel`）、`run.append`（打断并追加，未应用的追加由服务端退化成新一轮）、`run.discard`→`run.discarded`（只还原本轮动过的文件）、`run.tier`（中途改档位）、`task.stop`（停后台任务）。
- Agent 在上一轮结束后自行继续（后台任务完成）时 daemon 发 `run.continue`，服务端以 `run.continued` 回新 runId 或拒绝。

## ACP 驱动 Agent
- 用 Rust crate `agent-client-protocol`，只实现 ACP v1（`ProtocolVersion::V1`）；Claude、Codex 适配器固定版本装在 `<home>/adapters/`（`engine.rs` `ADAPTERS`：claude-agent-acp 0.81.0、codex-acp 2.2.2）。
- 声明式 Agent（gemini、codebuddy、pi、deepseek、antigravity）由内置插件清单描述，`include_str!` 编入二进制（`adapters.rs`）。
- 客户端能力只声明 `session.compaction` 与 `_meta`，不声明 `fs`、`terminal`：文件与命令由 Agent 自己的工具执行（`turn.rs` `client_capabilities`）。
- 会话：有 `resumeSessionId` 先 `session/resume`，不支持则 `session/load`，都失败才 `session/new`，原因记 `resume_failed`；每次 new/resume/load 都带 cwd、`additionalDirectories`（附加目录/仓库）、MCP 列表、`_meta`（`session.rs`）。
- 适配器进程闲置 10 分钟回收（`IDLE_REAP`），下一轮新进程 resume；Skill 名单、供应商变化同样换进程接续会话。
- 系统提示词：固定前缀 + Bot 自定义（`turn.rs` `system_prompt`）。Claude 走 `_meta.systemPrompt.append`；Codex 走进程级 `CODEX_CONFIG` 的 `developer_instructions`；声明式 Agent 按清单 `systemPrompt.via`（arg / env / script / meta）。
- MCP：`RunStart.mcpServers`（全局 + 插件）转成 ACP stdio/http，再追加 daemon 内置的 `gonggong` HTTP MCP（提问、hand_off、预览等工具），清单 `mcp.gonggong: script` 的 Agent 除外（`mcp_servers_for`）。
- 档位→ACP 模式（`turn.rs` `mode_for`，用 `session/set_mode` 切）：Claude full=bypassPermissions、workspace=acceptEdits、read_only=default；Codex full=agent-full-access、workspace=workspace-write、read_only=read-only。
- 「帮我审批」交给 Agent 自带审查（`builtin_mode`）：仅 workspace 档 + 开 aiReview + 官方登录，Claude 用 `auto`、Codex 用 `agent`。
- 模型与推理强度按 configOption 的 category（model / thought_level）查找，与当前值不同才 `session/set_config_option`，先模型后强度；无效值不让本轮失败。
- 改动文件数取 ACP 编辑类工具位置去重与 git 前后对比两者的较大值（Codex 多用 shell 改文件，只靠前者会是 0）。

## 权限与审批
- Agent 的 `session/request_permission` 先在 daemon 本机判定（`session.rs` `permission_in`、`local.rs` `decide`）：内置 gonggong 工具直接放行；full 档全部放行（不保留红线）。
- 非 full 档：红线命令（`floor_hit`）和推送基准分支（`protectBase`）一律问主人；其余按 `approval`（ask / allowlist / all）+ `alwaysAllow` + 工作区内读写规则判定，可本地放行（规则见 `local.rs` 与 `local/trust.rs`：临时目录、工作区外只读、脚本内容、团队 CLI 只读、功能分支推送）。AI 预审已移除；`approval.request` 的 `review` 与 `ai_*` 原因只来自旧客户端。
- 需要人决定时发 `approval.request`（带 `reason`、`options`、`remember`、`rememberSession`、`review`、`mcp`）；本地或 AI 放行的发 `approval.ai_approved` 只记审计。
- 服务端（`modules/approvals/service.ts`）：脱敏后入库，只有 Bot 主人能决定，过期按 `approvalTimeoutMin` 自动选拒绝；别人发起、该人群为「自动审批」的运行立即拒绝（见 供应商与Agent设置 · 按人群分档）；运行结束或 /stop 作废（`voidReason`）；「始终允许」写回 `bots.alwaysAllow`；改到 full 档时自动批准挂起请求。
- 决定以 `approval.decision` 回 daemon（`optionId` null = 取消，`session: true` = 本会话不再问）；等待决定不阻塞 ACP 消息分发。
- 审批规则、白名单只存服务端、只有 Bot 主人能改，随 `run.start` 下发、下一轮生效；机器 token 没有写 Bot 的接口。

## 网页终端
- 仅机器主人可用；daemon 持有 PTY，以（sessionId, groupId, botId）定位，工作目录由服务端从库里解析，浏览器不能传 cwd（`docs/plan/terminal-protocol.md`）。
- 复用预览隧道 framing，独立 target `tunnel.terminal`；操作 create / attach / terminate，控制 head：resize / terminate / ping 与 state / exit。
- 限额（`packages/protocol/src/terminal.ts`）：每机 8、每用户 4 个活动会话；闲置 24 小时由 daemon 结束；daemon 重放缓冲 1MiB / 4096 段；浏览器积压超 4MiB 即 reset。
- 断线不结束 PTY；服务端不落库终端内容与按键。

## 主要代码入口
- 协议：`packages/protocol/src/daemon.ts`、`terminal.ts`、`fixtures/`；`crates/gonggong/src/protocol/`。
- 服务端：`apps/server/src/daemon/{gateway,hub}.ts`、`modules/runs/{scheduler,engine,reconcile,stop}.ts`、`modules/approvals/service.ts`、`modules/terminals/`。
- daemon：`service.rs`（连接/补发/重连）、`engine.rs`（消息分派、进程启动、能力）、`session.rs`（ACP 会话与权限）、`turn.rs`（提示词、模式、能力）、`local.rs`（审批规则）、`adapters.rs`、`terminal.rs`、`tls.rs`、`upgrade.rs`。

## 来源
- `docs/plan/acp-research.md`、`docs/plan/acp-capabilities.md`、`docs/plan/terminal-protocol.md`、`docs/plan/安全说明.md`
- `docs/archive/2026-11/P1-总验收报告.md`、`M1-验收报告.md` ~ `M5-验收报告.md`
