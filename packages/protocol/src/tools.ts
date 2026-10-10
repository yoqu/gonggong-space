import { z } from 'zod'
import { SkillFile } from './daemon.js'
import { GONGGONG_TOOL_TITLES } from './tool-titles.js'
import { SKILL_MAX_FILES } from './web.js'

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

export const HandOffArgs = z.object({
  bot: z.string().min(1).max(64).describe('接手的 Bot 名字（get_group_info 列出的本群 Bot）'),
  task: z.string().min(1).max(2000).describe('交代给它的任务：要做什么、需要的上下文、做到什么程度算完成'),
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
  enabled: z.boolean().describe('true = 启用，false = 停用（保留内容与版本）'),
})
export const SkillVersionsArgs = z.object({ name: skillName, layer: skillLayer.optional() })
export const SkillRollbackArgs = z.object({
  name: skillName,
  layer: skillLayer.optional(),
  version: z.number().int().min(1).describe('skill_versions 列出的版本号；当前版本切回该版本，不新增版本'),
})

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
  hand_off: {
    title: GONGGONG_TOOL_TITLES.hand_off,
    description:
      '让本群另一个 Bot 接手工作：本轮结束后，群里会发出一条你 @ 它并交代任务的消息，它随即开始运行。' +
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
      '本群可见的团队 Skill（平台、团队、群三层，含已停用的）：名称、层级、说明、版本、是否生效（同名时下层覆盖上层）、发起人能否修改。',
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
    description: `启用或停用 Skill。${SKILL_WRITE}`,
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

/**
 * Tools of the built-in `gonggong` MCP server answered by the daemon itself (it owns the processes); generated into
 * `gonggong-daemon-tools.json`. `service_start` is not auto-approved: it runs an arbitrary command.
 */
export const DAEMON_TOOLS = {
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
