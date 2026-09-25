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
} as const

export type GonggongToolName = keyof typeof GONGGONG_TOOLS

/** MCP `tools/list` entries (what `gonggong-tools.json` holds). */
export const gonggongToolList = () =>
  Object.entries(GONGGONG_TOOLS).map(([name, t]) => {
    const { $schema: _, ...inputSchema } = z.toJSONSchema(t.input, { io: 'input' })
    return { name, title: t.title, description: t.description, inputSchema }
  })
