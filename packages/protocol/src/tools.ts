import { z } from 'zod'
import { SkillFile } from './daemon.js'
import {
  HTML_RENDER_COLUMN_WIDTH,
  HTML_RENDER_HTML_MAX,
  HTML_RENDER_LAYOUT_GUIDE,
  HTML_RENDER_MAX_FIT_HEIGHT,
  HTML_RENDER_MAX_HEIGHT,
  HTML_RENDER_MIN_HEIGHT,
  HTML_RENDER_THEME_GUIDE,
  HTML_RENDER_TITLE_MAX,
} from './html-render.js'
import { GONGGONG_TOOL_TITLES } from './tool-titles.js'
import {
  DaemonRelease,
  GROUP_TAB_TITLE_MAX,
  GROUP_TAB_URL_MAX,
  KNOWLEDGE_BODY_MAX,
  KNOWLEDGE_TAGS_MAX,
  KNOWLEDGE_TITLE_MAX,
  ReleaseNotesReq,
  SKILL_MAX_FILES,
} from './web.js'

/**
 * Tools of the built-in `gonggong` MCP server answered by the server (the daemon forwards them; `ask_group_members`
 * stays in the daemon). `gonggong-tools.json` is generated from these for the daemon's `tools/list`.
 */
const seq = z.number().int().min(1)
const group = z.string().describe('群 id（get_group_info 列出）；省略 = 当前会话').optional()
const author = z.string().describe('只看该作者（人或 bot 名字，包含匹配）').optional()
const since = z.string().describe('起始时间，ISO 8601').optional()
const until = z.string().describe('截止时间，ISO 8601').optional()

export const ListMessagesArgs = z
  .object({
    group,
    before: seq.describe('取 #seq 之前的消息').optional(),
    after: seq.describe('取 #seq 之后的消息').optional(),
    around: seq.describe('取 #seq 前后的消息（含它本身）').optional(),
    limit: z.number().int().min(1).max(50).describe('条数，默认 20').optional(),
    author,
    since,
    until,
  })
  .refine((a) => [a.before, a.after, a.around].filter((x) => x !== undefined).length <= 1, {
    message: 'before / after / around 最多给一个',
  })

export const SearchMessagesArgs = z.object({
  query: z.string().min(1).max(200).describe('关键词（不区分大小写的包含匹配）'),
  group: z.string().describe('群 id，或 all = 所有可读的群；省略 = 当前会话').optional(),
  author,
  since,
  until,
  limit: z.number().int().min(1).max(20).describe('条数，默认 10').optional(),
})

export const GetGroupInfoArgs = z.object({ group })

export const GetRunArgs = z
  .object({
    message: seq.describe('bot 回复消息的 #seq').optional(),
    run: z.string().describe('运行 id').optional(),
    include_patch: z.boolean().describe('附带本轮 diff').optional(),
  })
  .refine((a) => (a.message === undefined) !== (a.run === undefined), {
    message: 'message 与 run 需要且只能给一个',
  })

export const ListQuestionsArgs = z.object({
  group,
  limit: z.number().int().min(1).max(20).describe('条数，默认 10').optional(),
})

export const FetchAttachmentsArgs = z.object({ message: seq.describe('消息 #seq') })

export const SendAttachmentsArgs = z.object({
  paths: z
    .array(z.string().min(1).max(500).describe('工作区内的相对路径'))
    .min(1)
    .max(10)
    .describe('要发送的工作区文件，1 至 10 个'),
  text: z.string().max(20000).describe('随附件发送的说明，可省略').optional(),
})

export const ListFeishuMessagesArgs = z.object({
  limit: z.number().int().min(1).max(50).describe('条数，默认 20').optional(),
  before: z.string().describe('取该时间之前的消息，ISO 8601（上一页末尾给出）').optional(),
})

const serviceName = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,31}$/)
  .describe('服务名（小写字母、数字、连字符，最长 32），在本群本 bot 内唯一')
const port = z.number().int().min(1).max(65535)

export const PreviewExposeArgs = z
  .object({
    port: port.describe('本机端口').optional(),
    service: serviceName.describe('service_start 启动的服务名，使用它的端口').optional(),
    miniprogram: z
      .string()
      .min(1)
      .max(1000)
      .describe('小程序项目在本机的绝对路径；由 preview_miniprogram 填写，不要直接使用')
      .optional(),
    title: z.string().min(1).max(60).describe('卡片标题，说明这是什么'),
    path: z
      .string()
      .regex(/^\//)
      .max(500)
      .describe('打开时的路径（以 / 开头，可带查询串），默认 /')
      .optional(),
  })
  .refine((a) => [a.port, a.service, a.miniprogram].filter((x) => x !== undefined).length === 1, {
    message: 'port、service 与 miniprogram 需要且只能给一个',
  })

export const PreviewGuiArgs = z.object({
  service: serviceName.describe('service_start 启动的桌面应用服务名，推送它的窗口'),
  title: z.string().min(1).max(60).describe('卡片标题，说明这是什么'),
})

export const PreviewCloseArgs = z.object({ preview: z.string().describe('preview_expose 返回的预览 id') })

const progressStage = z.object({
  name: z.string().min(1).max(40).describe('阶段名，如 排队、构建、部署、完成'),
  status: z
    .enum(['pending', 'running', 'done', 'failed', 'skipped'])
    .describe('等待 / 进行中 / 完成 / 失败 / 跳过'),
})
export const ProgressCardArgs = z.object({
  id: z.string().describe('要更新的卡片 id（上次 progress_card 返回）；不传则新建一张').optional(),
  title: z.string().min(1).max(80).describe('标题，如「部署 luke-server 到 test」；新建时必填').optional(),
  stages: z
    .array(progressStage)
    .min(1)
    .max(12)
    .describe('全部阶段及当前状态（整体替换）；新建时必填')
    .optional(),
  percent: z.number().int().min(0).max(100).nullable().describe('总进度百分比；null 清除').optional(),
  detail: z.string().max(500).nullable().describe('一行说明，如构建号、失败原因；null 清除').optional(),
  link: z
    .object({ label: z.string().min(1).max(40), url: z.string().url() })
    .nullable()
    .describe('一个链接，如构建日志、预览二维码；null 清除')
    .optional(),
})

export const HandOffArgs = z.object({
  bot: z.string().min(1).max(64).describe('接手的 Bot 名字（get_group_info 列出的目标群 Bot）'),
  task: z.string().min(1).max(2000).describe('交代给它的任务：要做什么、需要的上下文、做到什么程度算完成'),
  group: z
    .string()
    .describe(
      '交给其他群的 Bot 时填该群 id（get_group_info 的「其他可读的群」列出，你和它都要在该群）；省略 = 本群',
    )
    .optional(),
})

const scheduleCron = z
  .string()
  .min(9)
  .max(100)
  .describe(
    '5 段 cron：分 时 日 月 周（0=周日），按 timezone 解释；如 0 9 * * 1-5 = 每个工作日 9:00，*/30 * * * * = 每 30 分钟。间隔不得小于 5 分钟',
  )
const scheduleAt = z.iso
  .datetime({ offset: true })
  .describe('只执行一次的时刻，带时区偏移的 ISO 8601，如 2026-10-05T09:00:00+08:00')
const scheduleBots = z
  .array(z.string().min(1).max(64))
  .min(1)
  .max(10)
  .describe(
    '候选 Bot 名字（get_group_info 列出的本群 Bot），按擅长此任务的程度从高到低排列；到点时由第一个可用（在线、空闲）的执行。默认只有你自己',
  )
const scheduleRunOptions = z
  .array(
    z.object({
      bot: z.string().min(1).max(64).describe('候选 Bot 的名字'),
      model: z.string().max(100).optional().describe('模型取值，如 opus、sonnet；省略 = 跟随默认'),
      effort: z.string().max(40).optional().describe('推理强度，如 low、medium、high；省略 = 跟随默认'),
    }),
  )
  .max(10)
  .describe(
    '按候选 Bot 指定执行时用的模型与推理强度，不给的 Bot 跟随默认。用户明确要求时才填；修改时给完整列表，[] = 全部恢复默认',
  )
const scheduleTz = z.string().describe('IANA 时区，默认 Asia/Shanghai')
const atMostOneTiming = (a: { cron?: unknown; at?: unknown }) => !(a.cron !== undefined && a.at !== undefined)

export const ScheduleCreateArgs = z
  .object({
    name: z.string().min(1).max(60).describe('任务名称，简短说明做什么'),
    prompt: z
      .string()
      .min(1)
      .max(4000)
      .describe('到点发给执行 Bot 的完整指令：它看不到本轮对话，写清要做什么、范围和产出'),
    cron: scheduleCron.optional(),
    at: scheduleAt.optional(),
    timezone: scheduleTz.optional(),
    bots: scheduleBots.optional(),
    run_options: scheduleRunOptions.optional(),
  })
  .refine((a) => atMostOneTiming(a) && (a.cron !== undefined || a.at !== undefined), {
    message: 'cron 与 at 需要且只能给一个',
  })
export const ScheduleListArgs = z.object({})
export const ScheduleUpdateArgs = z
  .object({
    id: z.string().describe('schedule_list 列出的任务 id'),
    name: z.string().min(1).max(60).optional(),
    prompt: z.string().min(1).max(4000).optional(),
    cron: scheduleCron.optional(),
    at: scheduleAt.optional(),
    timezone: scheduleTz.optional(),
    bots: scheduleBots.optional(),
    run_options: scheduleRunOptions.optional(),
    enabled: z.boolean().describe('false = 暂停，true = 恢复').optional(),
  })
  .refine(atMostOneTiming, { message: 'cron 与 at 最多给一个' })
export const ScheduleDeleteArgs = z.object({ id: z.string().describe('schedule_list 列出的任务 id') })

const skillName = z
  .string()
  .min(1)
  .max(64)
  .describe('Skill 名称（SKILL.md frontmatter 的 name，skill_list 可查）')
const skillLayer = z
  .enum(['group', 'team'])
  .describe('作用层级：group = 仅本群，team = 本群所属团队的所有群。默认 group')
const skillFiles = z
  .array(SkillFile)
  .min(1)
  .max(SKILL_MAX_FILES)
  .describe(
    '文件列表：path 为相对路径（SKILL.md、scripts/run.sh、references/api.md），二进制文件用 encoding=base64',
  )
export const SkillListArgs = z.object({})
export const SkillGetArgs = z.object({
  name: skillName,
  layer: z
    .enum(['platform', 'team', 'group'])
    .describe('读哪一层的同名 Skill，默认本群实际生效的那一个')
    .optional(),
  version: z.number().int().min(1).describe('读历史版本，默认当前版本').optional(),
})
export const SkillCreateArgs = z.object({ layer: skillLayer.optional(), files: skillFiles })
export const SkillUpdateArgs = z.object({
  name: skillName,
  layer: skillLayer.optional(),
  files: skillFiles
    .min(0)
    .describe('新增或覆盖的文件（未列出的保留）；改 SKILL.md 的 name 即重命名')
    .optional(),
  remove: z.array(z.string().min(1).max(255)).max(SKILL_MAX_FILES).describe('要删除的文件路径').optional(),
})
export const SkillDeleteArgs = z.object({ name: skillName, layer: skillLayer.optional() })
export const SkillToggleArgs = z.object({
  name: skillName,
  layer: skillLayer.optional(),
  enabled: z
    .boolean()
    .describe(
      'true = 启用，false = 停用（保留内容与版本）。layer=group 且本群没有同名群层 Skill 时，开关的是本群继承的平台层/团队层 Skill，只影响本群',
    ),
})
export const SkillVersionsArgs = z.object({ name: skillName, layer: skillLayer.optional() })
export const SkillRollbackArgs = z.object({
  name: skillName,
  layer: skillLayer.optional(),
  version: z.number().int().min(1).describe('skill_versions 列出的版本号；当前版本切回该版本，不新增版本'),
})

const kbId = z.string().describe('条目 id（kb_list / kb_search 列出）')
const kbTitle = z.string().trim().min(1).max(KNOWLEDGE_TITLE_MAX).describe('标题，一眼能看出讲什么')
const kbBody = z.string().max(KNOWLEDGE_BODY_MAX).describe('Markdown 正文，写清事实本身，不写聊天过程')
const kbTags = z
  .array(z.string().trim().min(1).max(30))
  .max(KNOWLEDGE_TAGS_MAX)
  .describe('标签，如 约定、环境、部署；修改时给完整列表')
export const KbListArgs = z.object({ tag: z.string().describe('只看带该标签的条目').optional() })
export const KbGetArgs = z.object({ id: kbId })
export const KbSearchArgs = z.object({
  query: z.string().min(1).max(200).describe('关键词，匹配标题、正文与标签'),
  limit: z.number().int().min(1).max(50).describe('最多返回几条，默认 10').optional(),
})
export const KbCreateArgs = z.object({ title: kbTitle, body: kbBody, tags: kbTags.optional() })
export const KbUpdateArgs = z.object({
  id: kbId,
  base_version: z.number().int().min(1).describe('你读到的版本号（kb_get 返回）；条目已被改过时修改失败'),
  title: kbTitle.optional(),
  body: kbBody.describe('完整的新正文（整体替换）').optional(),
  tags: kbTags.optional(),
})
export const KbDeleteArgs = z.object({ id: kbId })

export const TabListArgs = z.object({})
export const TabCreateArgs = z.object({
  kind: z
    .enum(['link', 'knowledge', 'file'])
    .describe('link 网页链接；knowledge 知识库条目；file 你工作区里的文件'),
  url: z.string().max(GROUP_TAB_URL_MAX).describe('kind=link 时必填，http/https 地址').optional(),
  knowledge_id: z.string().describe('kind=knowledge 时必填，条目 id（kb_list 列出）').optional(),
  path: z.string().max(500).describe('kind=file 时必填，工作区内的相对路径').optional(),
  title: z
    .string()
    .trim()
    .min(1)
    .max(GROUP_TAB_TITLE_MAX)
    .describe('标签名，简短；不填时取网页标题、条目标题或文件名')
    .optional(),
})

const mcpName = z.string().min(1).max(64).describe('MCP 名称（mcp_list 可查）')
const mcpLayer = z
  .enum(['platform', 'team', 'group'])
  .describe('作用层级：group = 仅本群，team = 本群所属团队的所有群，platform = 全平台。默认 group')
const forceNewSession = z
  .boolean()
  .describe(
    'true = 相关 Bot 下一轮开新会话以立即生效（会丢失当前会话上下文）；默认 false，已有会话继续用旧配置',
  )
  .optional()
const secretValues = z
  .record(z.string(), z.string())
  .describe('值只能写 ${secret:名称} 引用密钥（secret_list 列出），运行时替换为实值')
const McpConfigArg = z.discriminatedUnion('transport', [
  z.object({
    transport: z.literal('stdio'),
    name: mcpName,
    command: z.string().min(1).describe('启动命令，如 npx'),
    args: z.array(z.string()).describe('命令参数，不要写密钥').default([]),
    env: secretValues.describe('环境变量；值只能写占位符 ${secret:名称}').default({}),
  }),
  z.object({
    transport: z.literal('http'),
    name: mcpName,
    url: z.string().min(1).describe('MCP 服务地址，不要把密钥写进地址'),
    headers: secretValues.describe('请求头；值只能写占位符 ${secret:名称}').default({}),
  }),
])
export const McpListArgs = z.object({})
export const McpGetArgs = z.object({
  name: mcpName,
  layer: mcpLayer.describe('读哪一层的同名 MCP，默认本群实际生效的那一个').optional(),
})
export const McpCreateArgs = z.object({
  layer: mcpLayer.optional(),
  config: McpConfigArg,
  enabled: z.boolean().describe('默认 true').optional(),
  forceNewSession,
})
export const McpUpdateArgs = z.object({
  name: mcpName,
  layer: mcpLayer.optional(),
  config: McpConfigArg.describe(
    '完整的新配置（整体替换；改 name 即重命名）。已有的 env / headers 键写占位符即保留原值',
  ),
  forceNewSession,
})
export const McpToggleArgs = z.object({
  name: mcpName,
  layer: mcpLayer.optional(),
  enabled: z
    .boolean()
    .describe(
      'true = 启用，false = 停用（保留配置）。layer=group 且本群没有同名群层 MCP 时，开关的是本群继承的平台层/团队层 MCP，只影响本群',
    ),
  forceNewSession,
})
export const McpDeleteArgs = z.object({ name: mcpName, layer: mcpLayer.optional(), forceNewSession })
export const SecretListArgs = z.object({})
export const SecretRequestArgs = z.object({
  names: z
    .array(z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/))
    .min(1)
    .max(20)
    .describe('要填写的密钥名称，须已在本群可见的定义里（secret_list 列出）'),
  forceNewSession,
})
export const PluginCatalogArgs = z.object({
  plugin: z.string().max(40).describe('插件 name；省略时列出本群启用的插件').optional(),
})
export const CreationProposeArgs = z.object({
  plugin: z.string().max(40).describe('插件 name（plugin_catalog 列出）'),
  template: z.string().max(40).describe('模板 id；插件没有模板时省略').optional(),
  designSystem: z
    .string()
    .max(40)
    .describe('设计系统 id；模板不用设计系统时省略，需要但省略时用第一个')
    .optional(),
  inputs: z
    .record(z.string(), z.union([z.string().max(2000), z.boolean()]))
    .describe('输入项 id → 值，只填该模板的输入项；拿不准的必填项留空，卡片会提示成员补充')
    .optional(),
  directions: z.boolean().describe('是否先出 2–3 个视觉方向让大家选，默认否').optional(),
  note: z.string().max(200).describe('给群成员的一句话说明，如为什么选这个模板').optional(),
})

const MCP_WRITE =
  '以发起本轮的人的身份执行：群层需其为本群管理员，团队层需其为团队管理员，平台层需其为系统管理员。改动下一轮新会话生效。'
const MCP_SECRET =
  'env / headers 的值一律视为密钥：只能写 ${secret:名称} 引用本群可见的密钥（secret_list 列出），不接受明文；密钥缺值时用 secret_request 请人在卡片上填写，你看不到也不要在对话里索要。'

const SKILL_WRITE =
  '以发起本轮的人的身份执行：群层需其为本群管理员，团队层需其为团队管理员；平台层只读。改动下一轮生效。'
const SKILL_FORMAT =
  'Skill 是一个文件夹，必须有 SKILL.md，开头是 YAML frontmatter：name（小写字母、数字、连字符，≤64 字符，同层唯一）' +
  '与 description（≤1024 字符，写清做什么、何时使用，agent 靠它决定是否加载）；正文写给 agent 的操作步骤，保持精简，' +
  '细节拆到 references/ 下按需读取，可执行脚本放 scripts/。整个文件夹不超过 5 MB、200 个文件。'

export const GONGGONG_TOOLS = {
  list_messages: {
    title: GONGGONG_TOOL_TITLES.list_messages,
    description:
      '按时间顺序读取群聊记录（人的发言与 bot 的最终回复）。消息以 #seq 标识；用 before / after / around 翻页或定位。',
    input: ListMessagesArgs,
  },
  search_messages: {
    title: GONGGONG_TOOL_TITLES.search_messages,
    description: '按关键词检索聊天记录，返回命中片段（从新到旧）；group=all 检索你所在的所有群。',
    input: SearchMessagesArgs,
  },
  get_group_info: {
    title: GONGGONG_TOOL_TITLES.get_group_info,
    description: '群名、公告、模式、绑定仓库、成员（人与 bot 及其状态），以及你还能读取的其他群。',
    input: GetGroupInfoArgs,
  },
  get_run: {
    title: GONGGONG_TOOL_TITLES.get_run,
    description: 'bot 某一轮的触发消息、状态、摘要、改动文件、用量、提问与回答；include_patch 附带 diff。',
    input: GetRunArgs,
  },
  list_questions: {
    title: GONGGONG_TOOL_TITLES.list_questions,
    description: '群里过往的提问卡片与群成员的回答，复用已拍板的决策。',
    input: ListQuestionsArgs,
  },
  fetch_attachments: {
    title: GONGGONG_TOOL_TITLES.fetch_attachments,
    description: '把某条消息的附件下载到工作区 .gonggong/attachments/ 下，返回相对路径。',
    input: FetchAttachmentsArgs,
  },
  list_feishu_messages: {
    title: GONGGONG_TOOL_TITLES.list_feishu_messages,
    description:
      '实时读取当前群绑定的飞书群的近期消息（以触发人的飞书身份读取，结果不保存）。' +
      '飞书里只有与 Bot 交互的消息会同步到共工，需要了解飞书群里此前的讨论时用它。',
    input: ListFeishuMessagesArgs,
  },
  preview_expose: {
    title: GONGGONG_TOOL_TITLES.preview_expose,
    description:
      '把本机端口上的网页或服务发布给群成员：返回预览链接，并在群里发一张可内嵌打开的预览卡片。服务请先用 service_start 启动。',
    input: PreviewExposeArgs,
  },
  preview_gui: {
    title: GONGGONG_TOOL_TITLES.preview_gui,
    description:
      '把 service_start 启动的桌面应用（如 Electron、Tauri 应用）的窗口实时推给群成员：群里出现一张预览卡片，' +
      '成员打开后看到实时画面，经 Bot 主人同意可以远程操作。只推这个服务进程的窗口，不推整个屏幕。',
    input: PreviewGuiArgs,
  },
  preview_close: {
    title: GONGGONG_TOOL_TITLES.preview_close,
    description: '关闭一个预览链接（服务本身不停止）。',
    input: PreviewCloseArgs,
  },
  progress_card: {
    title: GONGGONG_TOOL_TITLES.progress_card,
    description:
      '在群里发一张可实时更新的进度卡片（如构建、部署），之后传 id 更新同一张，不必每次发新消息；飞书群同步显示。' +
      '只更新传入的字段，stages 整体替换。适合需要轮询外部状态的长任务：每次查到新状态就更新，结束时把阶段标为完成或失败并写明原因。' +
      '本 Bot 在之后的轮次也可以继续更新这张卡片。',
    input: ProgressCardArgs,
  },
  hand_off: {
    title: GONGGONG_TOOL_TITLES.hand_off,
    description:
      '让另一个 Bot 接手工作：本轮结束后，群里会发出一条你 @ 它并交代任务的消息，它随即开始运行。' +
      '默认交给本群的 Bot；传 group 可交给你所在的其他群里的 Bot，消息发在那个群并注明来自本群。' +
      '回复正文里写 @名字 只是提及、不会让对方开始工作；只有需要对方真正动手时才调用本工具。',
    input: HandOffArgs,
  },
  schedule_create: {
    title: GONGGONG_TOOL_TITLES.schedule_create,
    description:
      '在本群建一个定时任务，立即生效：到点以发起本轮的人的名义 @ 一个 Bot 执行 prompt（按 bots 顺序选第一个可用的），群里会出现任务卡片。' +
      '用户要求定期、或在将来某个时间做某事时用它；不要自己 sleep 等待或要求用户回头再来。返回接下来几次执行时间，请回报给用户核对。',
    input: ScheduleCreateArgs,
  },
  schedule_list: {
    title: GONGGONG_TOOL_TITLES.schedule_list,
    description: '本群的定时任务：id、名称、候选 Bot、执行时间、启用状态、下次执行与最近结果。',
    input: ScheduleListArgs,
  },
  schedule_update: {
    title: GONGGONG_TOOL_TITLES.schedule_update,
    description:
      '修改本群的定时任务（只给要改的字段），enabled=false 暂停、true 恢复。只能改你创建或候选里有你的任务。',
    input: ScheduleUpdateArgs,
  },
  schedule_delete: {
    title: GONGGONG_TOOL_TITLES.schedule_delete,
    description:
      '删除本群的定时任务。由定时任务触发的一轮里，任务已完成使命（如等待的条件已满足）时可删除它自己。',
    input: ScheduleDeleteArgs,
  },
  skill_list: {
    title: GONGGONG_TOOL_TITLES.skill_list,
    description:
      '本群可见的团队 Skill（平台、团队、群三层，含已停用和本群已关闭的）：名称、层级、说明、版本、是否生效（同名时下层覆盖上层）、发起人能否修改。',
    input: SkillListArgs,
  },
  skill_get: {
    title: GONGGONG_TOOL_TITLES.skill_get,
    description: '读取 Skill 的全部文件内容，可指定层级与历史版本。',
    input: SkillGetArgs,
  },
  skill_create: {
    title: GONGGONG_TOOL_TITLES.skill_create,
    description: `新建团队 Skill。${SKILL_FORMAT}${SKILL_WRITE}`,
    input: SkillCreateArgs,
  },
  skill_update: {
    title: GONGGONG_TOOL_TITLES.skill_update,
    description: `修改 Skill 的文件，每次修改生成一个新版本。${SKILL_FORMAT}${SKILL_WRITE}`,
    input: SkillUpdateArgs,
  },
  skill_delete: {
    title: GONGGONG_TOOL_TITLES.skill_delete,
    description: `删除 Skill 及其全部版本，不可恢复；只想暂时不用时用 skill_toggle 停用。${SKILL_WRITE}`,
    input: SkillDeleteArgs,
  },
  skill_toggle: {
    title: GONGGONG_TOOL_TITLES.skill_toggle,
    description: `启用或停用 Skill。要在本群关掉继承自团队或平台的 Skill（不影响其他群）时，用 layer=group 并给出它的名称，需发起人为本群管理员。${SKILL_WRITE}`,
    input: SkillToggleArgs,
  },
  skill_versions: {
    title: GONGGONG_TOOL_TITLES.skill_versions,
    description: 'Skill 的版本历史：版本号、大小、修改人、时间，标出当前版本。',
    input: SkillVersionsArgs,
  },
  skill_rollback: {
    title: GONGGONG_TOOL_TITLES.skill_rollback,
    description: `把 Skill 回滚到某个历史版本。${SKILL_WRITE}`,
    input: SkillRollbackArgs,
  },
  kb_list: {
    title: GONGGONG_TOOL_TITLES.kb_list,
    description: '本群知识库的条目：标题、id、版本、标签、是否置顶（不含正文）。',
    input: KbListArgs,
  },
  kb_get: {
    title: GONGGONG_TOOL_TITLES.kb_get,
    description: '读取知识库条目的全文与当前版本号。',
    input: KbGetArgs,
  },
  kb_search: {
    title: GONGGONG_TOOL_TITLES.kb_search,
    description: '按关键词检索本群知识库（标题、正文、标签），返回命中条目与片段。',
    input: KbSearchArgs,
  },
  kb_create: {
    title: GONGGONG_TOOL_TITLES.kb_create,
    description:
      '在本群知识库新建一条 Markdown 条目，本群所有 Bot 都能读到。用来记下值得长期记住的本群事实（约定、环境、决策、踩过的坑）；' +
      '先用 kb_search 查有没有相关条目，有就用 kb_update 补充，不要重复新建。不要写入密钥、密码。',
    input: KbCreateArgs,
  },
  kb_update: {
    title: GONGGONG_TOOL_TITLES.kb_update,
    description:
      '修改知识库条目（只给要改的字段），每次修改生成新版本，群成员可回滚。base_version 填你 kb_get 读到的版本；' +
      '条目已被别人改过时修改失败，按提示重新读取、合并后再改。',
    input: KbUpdateArgs,
  },
  kb_delete: {
    title: GONGGONG_TOOL_TITLES.kb_delete,
    description: '删除知识库条目。需要发起本轮的人是本群管理员；内容过时优先用 kb_update 修正。',
    input: KbDeleteArgs,
  },
  tab_list: {
    title: GONGGONG_TOOL_TITLES.tab_list,
    description: '本群顶部标签栏的标签：标题、类型、指向（链接、知识库条目、文件、内置入口）。',
    input: TabListArgs,
  },
  tab_create: {
    title: GONGGONG_TOOL_TITLES.tab_create,
    description:
      '把链接、知识库条目或你工作区里的文件钉到本群顶部标签栏，群成员一键打开。用于需要长期反复查看的报告、文档、看板；' +
      '先用 tab_list 看是否已经有了，不要重复添加，一次性内容不要钉。',
    input: TabCreateArgs,
  },
  mcp_list: {
    title: GONGGONG_TOOL_TITLES.mcp_list,
    description:
      '本群可见的 MCP（平台、团队、群三层，含已停用和本群已关闭的）：名称、层级、类型、启动命令或地址、是否生效（同名时下层覆盖上层）、发起人能否修改；密钥只显示是否已填写。',
    input: McpListArgs,
  },
  mcp_get: {
    title: GONGGONG_TOOL_TITLES.mcp_get,
    description: '查看一个 MCP 的配置，密钥打码，只显示是否已填写。',
    input: McpGetArgs,
  },
  mcp_create: {
    title: GONGGONG_TOOL_TITLES.mcp_create,
    description: `新建 MCP（stdio：command/args/env；http：url/headers）。${MCP_SECRET}${MCP_WRITE}`,
    input: McpCreateArgs,
  },
  mcp_update: {
    title: GONGGONG_TOOL_TITLES.mcp_update,
    description: `修改 MCP 的配置。${MCP_SECRET}${MCP_WRITE}`,
    input: McpUpdateArgs,
  },
  mcp_toggle: {
    title: GONGGONG_TOOL_TITLES.mcp_toggle,
    description: `启用或停用 MCP。要在本群关掉继承自团队或平台的 MCP（不影响其他群）时，用 layer=group 并给出它的名称，需发起人为本群管理员。${MCP_WRITE}`,
    input: McpToggleArgs,
  },
  mcp_delete: {
    title: GONGGONG_TOOL_TITLES.mcp_delete,
    description: `删除 MCP，不可恢复；只想暂时不用时用 mcp_toggle 停用。${MCP_WRITE}`,
    input: McpDeleteArgs,
  },
  secret_list: {
    title: GONGGONG_TOOL_TITLES.secret_list,
    description:
      '列出本群可用的密钥：名称、用途、模式（shared 统一值 / shared_overridable 统一值可个人覆盖 / personal 每人自填）、来源层、是否已填写、本轮是否注入。' +
      '已注入的密钥在你的进程环境变量里（同名），直接用 $名称 读取；永远不要把值打印、写进文件、消息或提交。',
    input: SecretListArgs,
  },
  secret_request: {
    title: GONGGONG_TOOL_TITLES.secret_request,
    description:
      '在群里发一张「填写密钥」卡片：personal / 可覆盖的密钥请发起本轮的人填写自己的值，shared 密钥请该层管理员填写；值不经过你，也不进聊天记录和日志。' +
      '工具立即返回，不等待填写；填写后下一轮注入。不要在对话里索要密钥。',
    input: SecretRequestArgs,
  },
  plugin_catalog: {
    title: GONGGONG_TOOL_TITLES.plugin_catalog,
    description:
      '本群启用的创作插件（幻灯片、产品原型等）。不传 plugin：列出插件、模板数、设计系统数和本 Bot 能否使用；' +
      '传 plugin：列出它的模板（id、标题、分组、要填的输入项、是否用设计系统）、设计系统（id、标题、分类、色板）和输入项定义。' +
      '群成员在对话里提出创作需求时先用它挑模板，再用 creation_propose 发确认卡。',
    input: PluginCatalogArgs,
  },
  creation_propose: {
    title: GONGGONG_TOOL_TITLES.creation_propose,
    description:
      '在群里发一张「创作确认卡」：写明插件、模板、设计系统和参数，群成员点「开始」后会以该成员的名义发出正式的创作请求并 @ 你，' +
      '也可以先「改参数」或「不用了」。工具立即返回；在收到正式的创作请求之前不要开始出稿。',
    input: CreationProposeArgs,
  },
} as const

export type GonggongToolName = keyof typeof GONGGONG_TOOLS

type ToolDefs = Record<string, { title: string; description: string; input: z.ZodType }>
const toolList = (tools: ToolDefs) =>
  Object.entries(tools).map(([name, t]) => {
    const { $schema: _, ...inputSchema } = z.toJSONSchema(t.input, { io: 'input' })
    return { name, title: t.title, description: t.description, inputSchema }
  })

/** MCP `tools/list` entries (what `gonggong-tools.json` holds). */
export const gonggongToolList = () => toolList(GONGGONG_TOOLS)

export const ServiceStartArgs = z.object({
  name: serviceName,
  command: z.string().min(1).max(2000).describe('在工作区里用 shell 执行的启动命令'),
  cwd: z.string().max(500).describe('工作区内的相对目录，默认工作区根目录').optional(),
  port: port.describe('服务监听的本机端口；给出时等待端口就绪（最多 60 秒）').optional(),
  env: z.record(z.string(), z.string()).describe('额外的环境变量').optional(),
  display: z
    .enum(['virtual'])
    .describe(
      '桌面应用的显示位置：virtual 表示在本机新建的虚拟显示（Xvfb）上运行，不占用机器主人的屏幕，preview_gui 推送整块虚拟屏幕；仅 Linux',
    )
    .optional(),
})
export const ServiceListArgs = z.object({})
export const ServiceLogsArgs = z.object({
  name: serviceName,
  tail: z.number().int().min(1).max(1000).describe('最后多少行，默认 100').optional(),
})
export const ServiceStopArgs = z.object({ name: serviceName })
export const PreviewStaticArgs = z.object({
  dir: z
    .string()
    .max(500)
    .describe('工作区内要发布的目录（如 dist、docs/report），默认工作区根目录')
    .optional(),
  title: z.string().min(1).max(60).describe('卡片标题，说明这是什么'),
  path: z.string().regex(/^\//).max(500).describe('打开时的路径，默认 /（目录下的 index.html）').optional(),
})

const page = z.string().min(1).max(HTML_RENDER_HTML_MAX).describe('A complete, self-contained HTML document.')

export const HtmlPreviewArgs = z.object({
  html: page,
  width: z
    .number()
    .int()
    .min(240)
    .max(1600)
    .describe(`CSS pixels, 240 to 1600. Default ${HTML_RENDER_COLUMN_WIDTH}. Use about 390 for phones.`)
    .optional(),
  appearance: z.enum(['light', 'dark']).describe('Default light.').optional(),
})

export const HtmlRenderArgs = z.object({
  html: page,
  title: z.string().min(1).max(HTML_RENDER_TITLE_MAX).describe('What the page shows; names its message.'),
  height: z
    .number()
    .int()
    .min(HTML_RENDER_MIN_HEIGHT)
    .max(HTML_RENDER_MAX_HEIGHT)
    .describe(
      `Frame height in CSS pixels, ${HTML_RENDER_MIN_HEIGHT} to ${HTML_RENDER_MAX_HEIGHT}. Use the contentHeight from html_preview.`,
    ),
})

const PAGE_RULES =
  'Inline <style> and <script>. Local images given as absolute paths are inlined. Remote URLs load as-is.'

export const PreviewMiniprogramArgs = z.object({
  dir: z
    .string()
    .max(500)
    .describe('工作区内小程序项目的目录（含 project.config.json），默认工作区根目录')
    .optional(),
  page: z
    .string()
    .regex(/^[^/?]/)
    .max(300)
    .describe('打开的页面路径，如 pages/goods/detail，默认首页')
    .optional(),
  query: z.string().regex(/^[^?]/).max(500).describe('页面参数，如 id=42&from=share').optional(),
  title: z.string().min(1).max(60).describe('卡片标题，说明这是什么'),
})

export const ClientReleasePublishArgs = z
  .object({
    file: z
      .string()
      .min(1)
      .max(500)
      .describe(
        '要发布的一个产物路径（工作区内的相对路径，如 dist/0.3.1/gonggong-0.3.1-macos-aarch64）；文件名须是 scripts/release.sh 的产物名',
      )
      .optional(),
    dir: z
      .string()
      .min(1)
      .max(500)
      .describe(
        '要整体发布的目录（工作区内的相对路径，如 dist/0.3.1）：上传其中所有发布产物与 RELEASE_NOTES.md，SHA256SUMS、manifest.json 与子目录跳过',
      )
      .optional(),
    kind: z
      .literal('daemon')
      .describe('仅发布 daemon 与 gg-cast（不包含桌面端）；dir 需有全部平台产物，桌面端沿用原发布流程')
      .optional(),
  })
  .refine((a) => (a.file === undefined) !== (a.dir === undefined), {
    message: 'file 与 dir 需要且只能给一个',
  })
  .refine((a) => a.kind === undefined || a.dir !== undefined, {
    message: 'kind 仅支持 dir',
    path: ['kind'],
  })
export const ClientReleaseNotesArgs = z.object({
  version: DaemonRelease.shape.version.describe('要更新说明的已发布版本，如 0.3.5；必须与当前发布版本一致'),
  releaseNotes: ReleaseNotesReq.shape.releaseNotes.describe(
    '完整的 Markdown 版本说明，会展示在桌面端和 daemon 升级提示里',
  ),
})

export const FEISHU_CARD_IMAGES_MAX = 10

export const FeishuSendCardArgs = z.object({
  card: z
    .record(z.string(), z.unknown())
    .describe(
      '飞书卡片 JSON 2.0：{"schema":"2.0","header":{…},"body":{"elements":[…]}}；本地图片的位置（如 img 元素的 img_key）写占位符，如 "chart"',
    ),
  images: z
    .record(z.string().regex(/^[\w-]{1,40}$/), z.string().min(1).max(500))
    .describe(
      `占位符 → 工作区内图片的相对路径，如 {"chart": "out/chart.png"}；至多 ${FEISHU_CARD_IMAGES_MAX} 张，png/jpg/gif/webp 等，单张不超过 10 MB`,
    )
    .optional(),
})

/**
 * Tools of the built-in `gonggong` MCP server answered by the daemon itself (it owns the processes); generated into
 * `gonggong-daemon-tools.json`. `service_start` is not auto-approved: it runs an arbitrary command.
 */
export const DAEMON_TOOLS = {
  send_attachments: {
    title: '发送文件到群聊',
    description:
      '把工作区里的图片、视频或其他文件作为本 Bot 的群消息发送，成员可直接在聊天中预览。' +
      'paths 使用工作区相对路径，一次 1 至 10 个文件；需要成员查看本次生成的媒体文件时主动使用。',
    input: SendAttachmentsArgs,
  },
  service_start: {
    title: '启动托管服务',
    description:
      '在工作区里启动一个长期运行的服务（如 dev server），由 gonggong 托管：本轮结束后仍在运行，可查看日志、随时停止。' +
      '需要给群里看运行中的网页时用它启动，再用 preview_expose 发布，不要自己在后台起进程。同名服务会先停止再启动；' +
      '群里已有的预览卡片会自动接上重启后的服务，不必重新发布。',
    input: ServiceStartArgs,
  },
  service_list: {
    title: '托管服务列表',
    description: '你在本群托管的服务：名字、状态、端口、运行时长。',
    input: ServiceListArgs,
  },
  service_logs: {
    title: '托管服务日志',
    description: '查看托管服务的输出（stdout 与 stderr 合并）末尾若干行。',
    input: ServiceLogsArgs,
  },
  service_stop: {
    title: '停止托管服务',
    description:
      '停止托管服务及其子进程。它的预览卡片保留并显示服务已停止，重新启动同名服务或成员在卡片上点启动即可恢复。',
    input: ServiceStopArgs,
  },
  preview_static: {
    title: '发布静态页面',
    description:
      '把工作区里的静态文件（HTML 报告、构建产物等）作为站点发布给群成员，并在群里发一张预览卡片；无需自己起服务。',
    input: PreviewStaticArgs,
  },
  html_preview: {
    title: '预览 HTML',
    description: `Check an HTML page before html_render. Returns a PNG, contentHeight and console output. ${PAGE_RULES} Theme and layout rules are in html_render.`,
    input: HtmlPreviewArgs,
  },
  html_render: {
    title: '在群聊中展示 HTML',
    description: `Show a finished HTML page (chart, diagram, dashboard, mockup) inline in the group chat, as its own message above your final reply. Do not announce or restate the page. The frame fits its height to the page up to ${HTML_RENDER_MAX_FIT_HEIGHT}px. ${PAGE_RULES} ${HTML_RENDER_LAYOUT_GUIDE} ${HTML_RENDER_THEME_GUIDE}`,
    input: HtmlRenderArgs,
  },
  client_release_publish: {
    title: '发布客户端到当前空间',
    description:
      '把本机构建好的客户端产物（gg daemon、gg-cast、桌面端安装包 Gonggong_<版本>_*.dmg / *-setup.exe，' +
      '或桌面端更新包 Gonggong_<版本>_*.app.tar.gz 及其 .sig 签名、*-setup.exe.sig）上传到当前空间，' +
      '成员的 daemon 随后自动升级、桌面端从这里检查更新、可在网页下载安装包。' +
      '推荐用 dir 一次发布 scripts/release.sh 的整个输出目录（dist/<版本>），只需审批一次；补传单个文件时用 file。' +
      '快速发版用 dir 加 kind="daemon"，只上传 daemon 与缓存的 gg-cast，不等待桌面端。' +
      '只有系统管理员发起的对话可以发布。',
    input: ClientReleasePublishArgs,
  },
  client_release_notes: {
    title: '更新客户端版本说明',
    description:
      '写入或更新当前空间已发布版本的 Markdown 更新说明，桌面端与 daemon 的下一次更新检查会拿到具体内容。' +
      '必须指定当前发布版本；只有系统管理员发起的对话可以使用。',
    input: ClientReleaseNotesArgs,
  },
  feishu_send_card: {
    title: GONGGONG_TOOL_TITLES.feishu_send_card,
    description:
      '以本 Bot 的飞书应用身份，往本群绑定的飞书群发一张自定义消息卡片，回复在触发本轮的消息下；' +
      '卡片引用的工作区图片会自动上传并换成 img_key。本群未绑定飞书群时不可用。普通回复不需要它，最终回复会自动同步到飞书。',
    input: FeishuSendCardArgs,
  },
  preview_miniprogram: {
    title: '发布小程序预览',
    description:
      '在本机微信开发者工具里打开工作区的小程序项目并跳到指定页面，在群里发一张带模拟器截图的预览卡片；' +
      '同一项目再次调用会切换卡片的页面并重新截图。开发者工具的启动、登录（未登录时卡片上显示登录二维码，扫码后自动恢复）' +
      '和「信任此项目」都由它处理：不要自己用 wechatide、cli 或其他命令操作开发者工具，也不要另发登录二维码。',
    input: PreviewMiniprogramArgs,
  },
} as const

export const daemonToolList = () => toolList(DAEMON_TOOLS)
