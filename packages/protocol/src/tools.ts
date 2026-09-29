import { z } from 'zod'

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

export const GONGGONG_TOOLS = {
  list_messages: {
    title: '读取聊天记录',
    description:
      '按时间顺序读取群聊记录（人的发言与 bot 的最终回复）。消息以 #seq 标识；用 before / after / around 翻页或定位。',
    input: ListMessagesArgs,
  },
  search_messages: {
    title: '检索聊天记录',
    description: '按关键词检索聊天记录，返回命中片段（从新到旧）；group=all 检索你所在的所有群。',
    input: SearchMessagesArgs,
  },
  get_group_info: {
    title: '群信息与成员',
    description: '群名、公告、模式、绑定仓库、成员（人与 bot 及其状态），以及你还能读取的其他群。',
    input: GetGroupInfoArgs,
  },
  get_run: {
    title: '查看运行记录',
    description: 'bot 某一轮的触发消息、状态、摘要、改动文件、用量、提问与回答；include_patch 附带 diff。',
    input: GetRunArgs,
  },
  list_questions: {
    title: '提问卡片历史',
    description: '群里过往的提问卡片与群成员的回答，复用已拍板的决策。',
    input: ListQuestionsArgs,
  },
  fetch_attachments: {
    title: '下载历史附件',
    description: '把某条消息的附件下载到工作区 .gonggong/attachments/ 下，返回相对路径。',
    input: FetchAttachmentsArgs,
  },
  preview_expose: {
    title: '发布预览',
    description:
      '把本机端口上的网页或服务发布给群成员：返回预览链接，并在群里发一张可内嵌打开的预览卡片。服务请先用 service_start 启动。',
    input: PreviewExposeArgs,
  },
  preview_gui: {
    title: '发布桌面应用预览',
    description:
      '把 service_start 启动的桌面应用（如 Electron、Tauri 应用）的窗口实时推给群成员：群里出现一张预览卡片，' +
      '成员打开后看到实时画面，经 Bot 主人同意可以远程操作。只推这个服务进程的窗口，不推整个屏幕。',
    input: PreviewGuiArgs,
  },
  preview_close: {
    title: '关闭预览',
    description: '关闭一个预览链接（服务本身不停止）。',
    input: PreviewCloseArgs,
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
