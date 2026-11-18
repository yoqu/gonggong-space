# Skill 密钥声明与配置引导 方案（草案 v0.2）

> 状态：评审中（2026-11-18，待 2 轮评审）。承接 `团队密钥-方案.md` 二期「Skill 声明密钥并做缺失检查」。

## 1. 问题

以市场 Skill `dw-query` 为例：它要每人自己的 `DW_MANAGER_API_KEY`（正式，必需）和 `DW_MANAGER_TEST_API_KEY`（测试，可选），但只写在 SKILL.md 正文里。

| 环节 | 现状（代码核实） | 后果 |
|---|---|---|
| 创建/发布 | 只有插件清单 `secrets: string[]`（仅名字）；Skill 包没有声明位置 | 平台不知道 Skill 要密钥，市场详情、审核都看不到 |
| 引入 | 引入流程不碰密钥；密钥定义要管理员另去设置页手工建，名字、mode 全靠猜 | 引入完就「坏着」 |
| 运行 | Agent 读正文才发现要密钥 → `secret_request`；若本群没有该名字的定义，工具直接回「新定义只能由管理员在设置里添加」（`agent-tools/secrets.ts:74`） | 用户跑到一半才知道，且常常死路 |
| 填写 | 「我的密钥」只列已有定义，没有「为什么要填、去哪申请」 | 成员不知道要填、不知道怎么拿 Key |

## 2. 目标

密钥需求**在创建时声明** → **发布/审核时可见** → **引入时一键建好定义** → **成员各自被引导填写** → **运行前就知道缺什么**。值的存储、加密、注入、打码沿用团队密钥一期，不改。

## 3. 声明格式（创建时规定）

统一一个结构 `SecretRequirement`（`packages/protocol`），Skill 和插件共用：

```yaml
# SKILL.md frontmatter
secrets:
  - name: DW_MANAGER_API_KEY
    title: 数仓 Manager Key（正式）
    description: 在 Manager「个人中心 → API Key」签发，只读权限即可
    url: https://…/manager/keys        # 可选：申请入口
    mode: personal                    # 建议模式：personal | shared | shared_overridable
    required: true                    # false = 可选（如测试环境 Key）
  - name: DW_MANAGER_TEST_API_KEY
    title: 数仓 Manager Key（测试）
    mode: personal
    required: false
```

- 插件清单 `secrets` 同时接受旧的字符串和新的对象（字符串 = `{name, mode: shared, required: true}`），向后兼容。
- 手写 Skill（`skills` 表）同样解析 frontmatter，`skill_create`/`skill_update` 工具描述里写明格式。
- 上传时校验：名字合法、≤10 个、不能和平台保留名冲突；声明写进版本快照 `manifest`，**不需要数据库迁移**。
- 待核实：Agent Skills 规范的 `metadata` 只允许 string→string，放顶层 `secrets` 是否会被 Codex/Claude/Gemini 的 Skill 加载器拒绝；若拒绝，下发时由服务端去掉该字段。

## 4. 发布与审核

- 市场详情页、引入对话框加「需要的密钥」区块：名称、用途、必需/可选、建议模式、申请链接。
- 审核 diff 里声明变化单独高亮（新增必需密钥 = 已引入方升级后会缺值，要提醒）。
- 预检提示（`PublishRes.warnings`）：脚本或正文里出现 `os.environ["X"]`、`$X`、`process.env.X` 形状的大写变量且没声明时提示「可能漏声明 X」（只提示不拦截）。

## 5. 引入时：一键建定义

- 群管理员/团队 admin 引入（或审批「申请引入」）时，对话框列出声明，逐项显示本群现状：
  - 已有同名定义（任一层继承）→ 显示「已有 · 来源层 · mode」，mode 与建议不同时提示但不改；
  - 没有 → 默认勾选「创建定义」，name/描述/mode 按声明预填，可改；`shared` 类可当场填统一值（`SecureField`），也可以稍后填。
- 定义建在引入所在层：群引入 → 群层，团队/仓库引入 → 团队层。
- 个人引入：见第 8 节待定 1。

## 6. 成员填写引导（各自填写）

- **群内待办条**（唯一的主动引导，已拍板）：输入框上方显示「本群 dw-query 需要你配置 1 个密钥 · 去配置」，只对还没填必需个人值的人显示，可「稍后」收起 7 天；填完消失。不刷群消息、不发通知。
- 「去配置」打开填写弹窗：每项显示 Skill 名、title、description、申请链接、必需/可选，`SecureField` 输入，带「允许在他人机器上的 Bot 使用」开关（同「我的密钥」）。
- 统一值缺失时，待办条只对该层管理员显示「dw-query 缺统一值 · 去填写」。

## 7. 运行时：提前知道缺什么

- 服务端组 `run.start` 时已有 `enabledSkills` 与 `resolveSecrets` 结果，算出「本轮生效 Skill 的必需密钥中缺哪些」：
  - 不阻断运行、照常下发 Skill；
  - 在运行上下文附一句：`dw-query 缺 DW_MANAGER_API_KEY（personal），用到时先 secret_request`，Agent 不必先 `secret_list` 再读正文。
- `secret_request` 补洞：请求的名字没有定义、但在本群生效 Skill 的声明里时，**按声明自动建定义**（层 = 该 Skill 的引入层，description 取自声明而非 Agent，守住「Agent 不能建定义写值」的底线），再发卡片。
- 卡片显示来源 Skill、title、description、申请链接。

## 8. 已拍板（姜维川 2026-11-18）

1. 个人引入的 Skill 要密钥：若群/团队都没有定义，在**团队层自动建 `personal` 定义**（只建定义不填值，团队 admin 可见可删），不加 `user` 层，无迁移。
2. 声明位置：**SKILL.md frontmatter 顶层 `secrets`**。
3. 引导：只做**群输入框上方待办条**（只对没填的人），不发通知、不加徽标。
4. 缺必需密钥时 Skill **照发**，靠运行上下文提示 + `secret_request` 卡片（与插件「缺密钥不下发」不同，有意为之）。

## 9. 分期

| 期 | 范围 |
|---|---|
| 一期 | `SecretRequirement` 协议 + Skill/插件解析校验；市场详情与引入对话框展示；引入一键建定义；`secret_request` 按声明自动建定义；运行上下文缺失提示；群内待办条 + 填写弹窗；`dw-query`、`feishu-devops-cli` 补声明 |
| 二期 | 审核 diff 高亮声明变化；预检扫描漏声明变量 |

涉及：protocol、server、web、desktop（只读展示），不涉及 daemon 与数据库迁移。
