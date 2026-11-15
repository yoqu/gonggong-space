# 内置 MCP 扩展开发计划：聊天记录、群信息、运行记录

目标：把群聊上下文从「全部塞进 prompt」改为「内联最近 N 条 + agent 按需查询」。内置 `gonggong` MCP 在「向群成员提问」之外，新增聊天记录读取与检索、群信息与成员、运行记录、提问卡片历史和历史附件下载。群聊和私聊的行为一致。

## 1. 现状

| 项 | 现状 |
| --- | --- |
| 内置 MCP | daemon 在本机回环地址上提供 `gonggong`（`crates/gonggong/src/ask.rs`），每个会话使用独立的密钥 URL。目前只有 `ask_group_members` 一个工具 |
| 每轮上下文 | `scheduler.ts::buildRunStart` 把 `contextSeq` 之后的**全部**人类消息和其他 bot 的最终回复放进 `prompt.context`，没有上限 |
| 恢复失败 | 另外带上最近 `sessionReplayCount`（50）条作为 `fallbackContext` |
| 上下文附件 | daemon 在每轮开始前把上下文里的附件全部下载到 `.gonggong/attachments/` |
| 权限 | `on_permission` 通过标题匹配 `ask_group_members` 自动放行 |
| 配置中心 | 只展示一行只读的「ask-group-members · 内置」 |
| 可复用 | `search/routes.ts` 已有 ilike 搜索；`requireMachine` 负责 daemon 的 REST 鉴权；`/api/daemon/attachments/:id` 用于下载附件 |

## 2. 决策

| #   | 项        | 结论                                                                                                                                                                                                                       |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C1  | 上下文策略    | 内联 `contextSeq` 之后**最近 N 条**，N 由新系统参数 `contextInlineMax` 控制，默认 20。更早的消息只在上下文标题里写一句提示：「此前还有 X 条未展示，需要时用 gonggong 的 list_messages(before=#首条) 或 search_messages 查看」                                                            |
| C2  | 恢复失败     | `fallbackContext` 取 `min(sessionReplayCount, contextInlineMax)` 条，更早的消息让 agent 自己查                                                                                                                                       |
| C3  | 消息引用     | 上下文行和工具输出统一使用 `[#seq 时间] 作者: 正文`（UTC）。agent 用 `#seq` 翻页、定位、查运行记录（`get_run` 接收 bot 回复的 seq）、取附件                                                                                                                           |
| C4  | 读取范围     | 当前会话，加上 bot **当前所在**的所有群（`group_bots.removed_at is null` 且群未归档）。私聊（`kind='dm'`）只在当前会话就是该私聊时可读，不参与跨群读取，避免主人与 bot 的私聊内容被带进公共群（见 §6-1）                                                                                      |
| C5  | 鉴权锚点     | 以**正在进行的运行**为锚：daemon 带机器 token 调用 `/api/daemon/runs/:runId/tools/:name`。服务端校验 run 属于本机 bot，并且处于 running / awaiting_* 状态。群和 bot 都从 run 推出，不信任参数。轮次之间调用工具直接报错                                                             |
| C6  | 工具逻辑放在哪  | 服务端负责查询、鉴权、格式化，返回纯文本；daemon（`ask.rs`）只做转发，外加 `ask_group_members` 和附件落盘。不让 agent 直连服务器，因为自签证书指纹固定只在 daemon 里生效，agent 的 MCP 客户端做不到                                                                                         |
| C7  | 工具定义单一来源 | `packages/protocol/src/tools.ts` 用 zod 定义工具入参，生成 `packages/protocol/gonggong-tools.json`（name / title / description / inputSchema）。daemon 用 `include_str!` 读取后返回给 `tools/list`，服务端用 zod 校验参数。测试断言该文件与 `z.toJSONSchema` 的输出一致 |
| C8  | 输出上限     | 单次最多返回 50 条消息；单条正文超过 2000 字时截断并注明原长；diff 不超过 20000 字；整个结果不超过 32000 字，超出部分截断并注明                                                                                                                                           |
| C9  | 审计       | 跨群读取写入审计（`category: 'run'`，`action: 'tool.cross_group_read'`，detail 记录 runId、目标群、工具）。本群读取不审计，运行卡片上的工具事件已经可见                                                                                                              |
| C10 | 权限       | `gonggong` 下的全部工具免审批，自动放行。判定改为：标题包含 `ask_group_members`，或同时包含 `gonggong` 与某个服务端工具名                                                                                                                                               |
| C11 | 检索实现     | 一期沿用 `ilike`，走 `messages_group_seq` 索引并限定在可读群内。中文分词和全文索引（pg_trgm / zhparser）留到数据量上来以后再做                                                                                                                                  |
| C12 | 系统提示词    | `system_prompt` 增加一句：「需要更早的群聊记录、群成员、其他 bot 的运行结果时，用 gonggong 工具查询，不要猜。」                                                                                                                                                      |
| C13 | 生效时机     | 工具由 daemon 提供，daemon 升级后，新会话和恢复的会话都能在 `tools/list` 看到新工具，不需要强制开新会话                                                                                                                                                       |

## 3. 工具定义

`group` 参数都是可选的，省略时表示当前会话；传值时必须是 `get_group_info` 列出的群 id。

| 工具 | 入参 | 返回 |
| --- | --- | --- |
| `ask_group_members` | 不变 | 不变 |
| `list_messages` | `group?`、`before?`/`after?`/`around?`（seq，最多给一个）、`limit?`（默认 20，最大 50）、`author?`、`since?`/`until?`（ISO 时间） | 按时间正序的消息行，带附件名。取满一页时末尾给出下一页游标 |
| `search_messages` | `query`、`group?`（群 id 或 `all`）、`author?`、`since?`/`until?`、`limit?`（默认 10，最大 20） | 命中片段行 `[#seq 时间] 群名 · 作者: …片段…`，从新到旧排列 |
| `get_group_info` | `group?` | 群名、类型、公告、模式、绑定仓库；成员（人：名字、是否管理员；bot：名字、主人、agent 类型、在线/离线，并标出「你」）；另列出其他可读群（id + 名称） |
| `get_run` | `message`（bot 回复的 seq）或 `run`（id） | 触发消息、bot、状态、步骤、摘要、改动文件、用量、本轮的提问卡片与回答。`include_patch: true` 时附上 diff（已脱敏，保留期外注明「已过期」） |
| `list_questions` | `group?`、`limit?`（默认 10） | 提问卡片：提问的 bot、问题、回答人、回答（格式复用 `format_answers`）、状态（已答 / 超时 / 作废） |
| `fetch_attachments` | `message`（seq） | daemon 把该消息的附件下载到 `.gonggong/attachments/<messageId>/`，返回工作区相对路径，格式复用 `attachment_note` |

输出示例（`list_messages`）：

```
群「支付重构」#2310–#2329（共 20 条，更早：before=2310）
[#2310 2026-09-23 10:12] 王磊: 退款接口要兼容旧版签名（附件：spec.pdf）
[#2311 2026-09-23 10:15] codex-bot: 已完成签名兼容，改动 3 个文件
```

## 4. 切片（TDD，每片测试全绿 + typecheck + lint）

### S1 协议
- 新增 `packages/protocol/src/tools.ts`：定义各工具入参的 zod schema 与工具元数据，导出 `GONGGONG_TOOLS`。
- REST 契约：`POST /api/daemon/runs/:runId/tools/:name`，请求 `{ arguments }`，响应 `{ text, isError, attachments: Attachment[] }`（`ToolCallReq` / `ToolCallRes`，Rust 同名结构）。
- 生成 `gonggong-tools.json`。
- `SystemParams` 增加 `contextInlineMax`（1–200，默认 20）；`RunStart.prompt` 增加 `omitted`（未内联的条数），并更新 `s2d.run.start.json` fixture。
- 测试：`gonggong-tools.json` 与 `z.toJSONSchema` 一致；游标与运行引用的校验。

### S2 服务端：工具接口
- 新模块 `src/modules/agent-tools/`：`routes.ts`（鉴权与分发）和 `service.ts`（各工具的查询与格式化）。
- 鉴权：`requireMachine` → run 存在、`bots.machineId === machine.id`、run 处于进行中（C5）。可读群按 C4 计算，越界返回 `isError` 文本，不抛 HTTP 错误，方便 agent 自行纠正。
- 查询复用 `contextMessages` 的过滤条件：只读 user / bot 消息，排除命令消息。检索复用 `likePattern` 和 `snippet`，把它们从 `search/routes.ts` 提到 `lib/`。
- `get_run` 用 `open()` 解封 patch；`list_questions` 查 `question_sets` 并关联 runs。
- 跨群读取写审计（C9）。
- 测试（`createTestDb`）：每个工具的正常路径；非本机 run、已结束的 run、已移出的群、已归档的群、别人的私聊都被拒；分页游标；截断；跨群读取留下审计记录。

### S3 服务端：上下文瘦身
- `buildRunStart`：`context` 取最近 `contextInlineMax` 条，并算出 `omitted`；`fallbackContext` 取 `min(sessionReplayCount, contextInlineMax)` 条。
- `contextSeq` 仍然推进到触发消息（被省略的消息视为「已告知可查」）。
- 测试：超过 N 条时只内联最近 N 条，`omitted` 正确；不超过 N 条时 `omitted` 为 0；恢复失败的上下文受上限约束。

### S4 daemon
- `ask.rs`（内置 gonggong 服务器）的 `Asker` 增加 `active_run() -> Option<(run_id, cwd)>`；`AskServer::start` 接收服务器配置用于转发。
- `tools/list` 返回 `include_str!` 读入的 `gonggong-tools.json`。`ask_group_members` 仍在本地处理；其余工具带机器 token 转发到服务端；如果响应里有 `attachments`，用 `attachments::fetch` 下载到 cwd，再在 text 后追加路径。
- 没有进行中的 run 时返回 `isError`：「当前不在运行中，无法查询」。
- `on_permission`：`gonggong` 前缀的工具都自动放行（C10）。
- `compose_prompt`：上下文行加 `#seq`；有 `omitted` 时输出提示行；`system_prompt` 加 C12 那句话。
- 预下载附件只处理内联的上下文消息。
- 测试：`tools/list` 包含全部工具；转发时的请求路径和 token 正确（用本地假服务端）；附件落盘；无运行时报错；带前缀的工具自动放行；`compose_prompt` 快照。

### S5 Web
- 配置中心：内置那一行改名为 `gonggong`，下方列出工具清单（「向群成员提问」加 `GONGGONG_TOOLS` 的 title）。右侧的说明文案同步更新。
- 系统参数页：由 `SYSTEM_PARAM_VIEW` 自动出现「每轮随消息附带的群聊上下文」。
- 测试：配置中心渲染出工具清单；参数可以保存。

### S6 集成
- `tools/mock-agent/agent.js` 增加 `mock:tool <name> <json>`，调用任意 gonggong 工具并把结果作为回复发出。
- daemon 集成测试（`crates/gonggong/tests/attachments.rs`）：mock agent 调 `fetch_attachments` → 不经主人审批 → 转发到假服务器 → 附件落盘并出现在回复里。
- Playwright e2e 使用真实 agent，是否能自主调用工具取决于模型，没有加用例；上线前用真实 agent 手工验证一次。

## 5. 验收

- 长群聊中 @bot，prompt 里的上下文不超过 `contextInlineMax` 条，agent 能通过工具取到任意更早的消息。
- bot 能看到群成员和其他 bot 的状态，能读取其他 bot 某一轮的摘要和 diff。
- 跨群检索只命中 bot 当前所在、未归档的群，不命中别人的私聊，并且留下审计记录。
- 私聊与群聊行为一致。
- `pnpm -r test`、`cargo test --workspace`、`pnpm typecheck`、`pnpm lint` 全部通过；`pnpm e2e` 不回归。

## 6. 已确认（2026-09-24）

1. 私聊不参与跨群读取（C4）。
2. 一期不做群级「禁止跨群读取」开关，只保留审计。
3. `contextInlineMax` 默认 20，暂不按群覆盖。
4. 写能力（发进度、主动 @ 其他 bot）另行规划。
5. 需求规格 §4.4、§4.5、§7.2 已同步。
