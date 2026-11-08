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
const group = z.string().describe('Group id (from get_group_info); default: this conversation').optional()
const author = z.string().describe('Only this author (person or bot name, substring match)').optional()
const since = z.string().describe('From, ISO 8601').optional()
const until = z.string().describe('Until, ISO 8601').optional()

export const ListMessagesArgs = z
  .object({
    group,
    before: seq.describe('Messages before #seq').optional(),
    after: seq.describe('Messages after #seq').optional(),
    around: seq.describe('Messages around #seq, itself included').optional(),
    limit: z.number().int().min(1).max(50).describe('Default 20').optional(),
    thread: seq.describe('Read the thread of root message #seq instead of the main chat').optional(),
    author,
    since,
    until,
  })
  .refine((a) => [a.before, a.after, a.around].filter((x) => x !== undefined).length <= 1, {
    message: 'before / after / around 最多给一个',
  })

export const SearchMessagesArgs = z.object({
  query: z.string().min(1).max(200).describe('Keyword (case-insensitive substring)'),
  group: z
    .string()
    .describe('Group id, or all = every group you can read; default: this conversation')
    .optional(),
  author,
  since,
  until,
  limit: z.number().int().min(1).max(20).describe('Default 10').optional(),
})

export const GetGroupInfoArgs = z.object({ group })

export const GetRunArgs = z
  .object({
    message: seq.describe('#seq of the bot reply').optional(),
    run: z.string().describe('Run id').optional(),
    include_patch: z.boolean().describe('Include the run diff').optional(),
  })
  .refine((a) => (a.message === undefined) !== (a.run === undefined), {
    message: 'message 与 run 需要且只能给一个',
  })

export const ListQuestionsArgs = z.object({
  group,
  limit: z.number().int().min(1).max(20).describe('Default 10').optional(),
})

export const FetchAttachmentsArgs = z.object({ message: seq.describe('Message #seq') })

export const SendAttachmentsArgs = z.object({
  paths: z
    .array(z.string().min(1).max(500).describe('Workspace-relative path'))
    .min(1)
    .max(10)
    .describe('Workspace files to send, 1 to 10'),
  text: z.string().max(20000).describe('Text sent with the files').optional(),
})

export const ListFeishuMessagesArgs = z.object({
  limit: z.number().int().min(1).max(50).describe('Default 20').optional(),
  before: z
    .string()
    .describe('Messages before this time, ISO 8601 (given at the end of the previous page)')
    .optional(),
})

const serviceName = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,31}$/)
  .describe('Service name (lowercase letters, digits, hyphens, up to 32), unique per group and bot')
const port = z.number().int().min(1).max(65535)

export const PreviewExposeArgs = z
  .object({
    port: port.describe('Local port').optional(),
    service: serviceName.describe('A service_start service; uses its port').optional(),
    miniprogram: z.string().min(1).max(1000).describe('Set by preview_miniprogram; do not use').optional(),
    title: z.string().min(1).max(60).describe('Card title: what this is'),
    path: z
      .string()
      .regex(/^\//)
      .max(500)
      .describe('Path to open (starts with /, may have a query), default /')
      .optional(),
  })
  .refine((a) => [a.port, a.service, a.miniprogram].filter((x) => x !== undefined).length === 1, {
    message: 'port、service 与 miniprogram 需要且只能给一个',
  })

export const PreviewGuiArgs = z.object({
  service: serviceName.describe('A desktop app started with service_start; its windows are streamed'),
  title: z.string().min(1).max(60).describe('Card title: what this is'),
})

export const PreviewCloseArgs = z.object({
  preview: z.string().describe('Preview id returned by preview_expose'),
})

const progressStage = z.object({
  name: z.string().min(1).max(40).describe('Stage name, e.g. 构建, 部署'),
  status: z.enum(['pending', 'running', 'done', 'failed', 'skipped']),
})
export const ProgressCardArgs = z.object({
  id: z.string().describe('Card id to update (from progress_card); omit to create one').optional(),
  title: z
    .string()
    .min(1)
    .max(80)
    .describe('Title, e.g. 「部署 luke-server 到 test」; required to create')
    .optional(),
  stages: z
    .array(progressStage)
    .min(1)
    .max(12)
    .describe('All stages with their status (replaces them); required to create')
    .optional(),
  percent: z.number().int().min(0).max(100).nullable().describe('Overall percent; null clears').optional(),
  detail: z
    .string()
    .max(500)
    .nullable()
    .describe('One line, e.g. build number or failure reason; null clears')
    .optional(),
  link: z
    .object({ label: z.string().min(1).max(40), url: z.string().url() })
    .nullable()
    .describe('One link, e.g. build log; null clears')
    .optional(),
})

export const HandOffArgs = z.object({
  bot: z.string().min(1).max(64).describe('Bot to take over (a bot of the target group, see get_group_info)'),
  task: z
    .string()
    .min(1)
    .max(2000)
    .describe('The task: what to do, the context it needs, and when it is done'),
  group: z
    .string()
    .describe(
      'Group id when the bot is in another group (listed by get_group_info; you must both be in it); default: this group',
    )
    .optional(),
})

// Undescribed: schedule_update reuses them and points at schedule_create for their meaning.
const scheduleCron = z.string().min(9).max(100)
const scheduleAt = z.iso.datetime({ offset: true })
const scheduleBots = z.array(z.string().min(1).max(64)).min(1).max(10)
const scheduleRunOptions = z
  .array(
    z.object({
      bot: z.string().min(1).max(64),
      model: z.string().max(100).optional().describe('e.g. opus, sonnet; default if omitted'),
      effort: z.string().max(40).optional().describe('e.g. low, medium, high; default if omitted'),
    }),
  )
  .max(10)
const scheduleTz = z.string()
const atMostOneTiming = (a: { cron?: unknown; at?: unknown }) => !(a.cron !== undefined && a.at !== undefined)

export const ScheduleCreateArgs = z
  .object({
    name: z.string().min(1).max(60).describe('Short name of what it does'),
    prompt: z
      .string()
      .min(1)
      .max(4000)
      .describe(
        'Full instruction sent to the bot when due; it does not see this conversation, so state the task, scope and output',
      ),
    cron: scheduleCron
      .describe(
        '5-field cron: min hour day month weekday (0=Sunday), in timezone; e.g. 0 9 * * 1-5 = weekdays 9:00. At least 5 minutes apart',
      )
      .optional(),
    at: scheduleAt.describe('One-off time with offset, e.g. 2026-10-05T09:00:00+08:00').optional(),
    timezone: scheduleTz.describe('IANA time zone, default Asia/Shanghai').optional(),
    bots: scheduleBots
      .describe(
        'Candidate bots of this group, best first; the first online and idle one runs it. Default: only you',
      )
      .optional(),
    run_options: scheduleRunOptions
      .describe(
        'Model and effort per candidate, only when the user asks; give the full list when changing, [] = all default',
      )
      .optional(),
  })
  .refine((a) => atMostOneTiming(a) && (a.cron !== undefined || a.at !== undefined), {
    message: 'cron 与 at 需要且只能给一个',
  })
export const ScheduleListArgs = z.object({})
export const ScheduleUpdateArgs = z
  .object({
    id: z.string().describe('Task id from schedule_list'),
    name: z.string().min(1).max(60).optional(),
    prompt: z.string().min(1).max(4000).optional(),
    cron: scheduleCron.optional(),
    at: scheduleAt.optional(),
    timezone: scheduleTz.optional(),
    bots: scheduleBots.optional(),
    run_options: scheduleRunOptions.optional(),
    enabled: z.boolean().describe('false = pause, true = resume').optional(),
  })
  .refine(atMostOneTiming, { message: 'cron 与 at 最多给一个' })
export const ScheduleDeleteArgs = z.object({ id: z.string().describe('Task id from schedule_list') })

const skillName = z.string().min(1).max(64).describe('Skill name (frontmatter name, see skill_list)')
const skillLayer = z
  .enum(['group', 'team'])
  .describe('group: this group (default) / team: all groups of the team')
const skillFiles = z
  .array(SkillFile)
  .min(1)
  .max(SKILL_MAX_FILES)
  .describe(
    'Files: relative paths (SKILL.md, scripts/run.sh, references/api.md); binary files with encoding=base64',
  )
export const SkillListArgs = z.object({})
export const SkillGetArgs = z.object({
  name: skillName,
  layer: z
    .enum(['platform', 'team', 'group'])
    .describe('Layer to read; default: the one in effect here')
    .optional(),
  version: z.number().int().min(1).describe('Past version; default current').optional(),
})
export const SkillCreateArgs = z.object({ layer: skillLayer.optional(), files: skillFiles })
export const SkillUpdateArgs = z.object({
  name: skillName,
  layer: skillLayer.optional(),
  files: skillFiles
    .min(0)
    .describe('Files to add or overwrite (others are kept); renaming the SKILL.md name renames it')
    .optional(),
  remove: z.array(z.string().min(1).max(255)).max(SKILL_MAX_FILES).describe('Paths to delete').optional(),
})
export const SkillDeleteArgs = z.object({ name: skillName, layer: skillLayer.optional() })
export const SkillToggleArgs = z.object({
  name: skillName,
  layer: skillLayer.optional(),
  enabled: z
    .boolean()
    .describe(
      'false = disable (content kept). With layer=group and no group-layer skill of that name, turns the inherited one on or off here only',
    ),
})
export const SkillVersionsArgs = z.object({ name: skillName, layer: skillLayer.optional() })
export const SkillRollbackArgs = z.object({
  name: skillName,
  layer: skillLayer.optional(),
  version: z
    .number()
    .int()
    .min(1)
    .describe('Version from skill_versions; becomes current without a new version'),
})

const kbId = z.string().describe('Entry id (from kb_list / kb_search)')
const kbTitle = z.string().trim().min(1).max(KNOWLEDGE_TITLE_MAX).describe('Title that says what it is about')
const kbBody = z
  .string()
  .max(KNOWLEDGE_BODY_MAX)
  .describe('Markdown body: the facts, not the chat that led to them')
const kbTags = z
  .array(z.string().trim().min(1).max(30))
  .max(KNOWLEDGE_TAGS_MAX)
  .describe('Tags, e.g. 约定, 环境, 部署; the full list when changing')
export const KbListArgs = z.object({ tag: z.string().describe('Only entries with this tag').optional() })
export const KbGetArgs = z.object({ id: kbId })
export const KbSearchArgs = z.object({
  query: z.string().min(1).max(200).describe('Keyword matched against title, body and tags'),
  limit: z.number().int().min(1).max(50).describe('Default 10').optional(),
})
export const KbCreateArgs = z.object({ title: kbTitle, body: kbBody, tags: kbTags.optional() })
export const KbUpdateArgs = z.object({
  id: kbId,
  base_version: z
    .number()
    .int()
    .min(1)
    .describe('Version you read (from kb_get); fails if the entry changed since'),
  title: kbTitle.optional(),
  body: kbBody.describe('Full new body (replaces it)').optional(),
  tags: kbTags.optional(),
})
export const KbDeleteArgs = z.object({ id: kbId })

export const TabListArgs = z.object({})
export const TabCreateArgs = z.object({
  kind: z
    .enum(['link', 'knowledge', 'file'])
    .describe('link: a web page; knowledge: a knowledge base entry; file: a file in your workspace'),
  url: z.string().max(GROUP_TAB_URL_MAX).describe('Required for link: http(s) URL').optional(),
  knowledge_id: z.string().describe('Required for knowledge: entry id (from kb_list)').optional(),
  path: z.string().max(500).describe('Required for file: workspace-relative path').optional(),
  title: z
    .string()
    .trim()
    .min(1)
    .max(GROUP_TAB_TITLE_MAX)
    .describe('Short tab name; default: the page title, entry title or file name')
    .optional(),
})

const mcpName = z.string().min(1).max(64).describe('MCP name (see mcp_list)')
const mcpLayer = z
  .enum(['platform', 'team', 'group'])
  .describe('group: this group (default) / team: all groups of the team / platform: everywhere')
const forceNewSession = z
  .boolean()
  .describe(
    'true = affected bots start a new session next turn so it applies at once (loses session context); default keeps sessions',
  )
  .optional()
const secretValues = z
  .record(z.string(), z.string())
  .describe('Values may only be ${secret:NAME} references (see secret_list), filled in at run time')
const McpConfigArg = z.discriminatedUnion('transport', [
  z.object({
    transport: z.literal('stdio'),
    name: mcpName,
    command: z.string().min(1).describe('Command, e.g. npx'),
    args: z.array(z.string()).describe('Arguments; no secrets').default([]),
    env: secretValues.describe('Env vars; values only ${secret:NAME}').default({}),
  }),
  z.object({
    transport: z.literal('http'),
    name: mcpName,
    url: z.string().min(1).describe('Server URL; no secrets in it'),
    headers: secretValues.describe('Headers; values only ${secret:NAME}').default({}),
  }),
])
export const McpListArgs = z.object({})
export const McpGetArgs = z.object({
  name: mcpName,
  layer: mcpLayer.describe('Layer to read; default: the one in effect here').optional(),
})
export const McpCreateArgs = z.object({
  layer: mcpLayer.optional(),
  config: McpConfigArg,
  enabled: z.boolean().describe('Default true').optional(),
  forceNewSession,
})
export const McpUpdateArgs = z.object({
  name: mcpName,
  layer: mcpLayer.optional(),
  config: McpConfigArg.describe(
    'Full new config (replaces it; a new name renames it). Existing env / headers keys keep their values when given their placeholder',
  ),
  forceNewSession,
})
export const McpToggleArgs = z.object({
  name: mcpName,
  layer: mcpLayer.optional(),
  enabled: z
    .boolean()
    .describe(
      'false = disable (config kept). With layer=group and no group-layer MCP of that name, turns the inherited one on or off here only',
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
    .describe('Secrets to fill, defined and visible here (see secret_list)'),
  forceNewSession,
})
export const ArtifactCheckoutArgs = z.object({
  artifact: z.string().min(1).max(80).describe('Artifact id, or its title in this group'),
})
export const PluginCatalogArgs = z.object({
  plugin: z.string().max(40).describe('Plugin name; omit to list the enabled plugins').optional(),
})
export const CreationProposeArgs = z.object({
  plugin: z.string().max(40).describe('Plugin name (from plugin_catalog)'),
  template: z.string().max(40).describe('Template id; omit when the plugin has none').optional(),
  designSystem: z
    .string()
    .max(40)
    .describe(
      'Design system id, auto (picks a preset for the request) or group:<id> (imported here, see plugin_catalog); omit when the template uses none (then input-box plugins use auto, others the first)',
    )
    .optional(),
  inputs: z
    .record(z.string(), z.union([z.string().max(2000), z.boolean()]))
    .describe(
      "Input id → value, only the template's inputs; leave unsure required ones empty and the card asks members",
    )
    .optional(),
  directions: z
    .boolean()
    .describe('Offer 2–3 visual directions to choose from first; default false')
    .optional(),
  note: z.string().max(200).describe('One line for members, e.g. why this template').optional(),
})

const MCP_WRITE =
  ' Needs the turn initiator to administer the layer (group/team/system); applies to new sessions from the next turn.'
const MCP_SECRET =
  ' env / headers values may only be ${secret:NAME} (see secret_list), never plain text; when a value is missing, secret_request it instead of asking in the chat.'

const SKILL_WRITE =
  ' Needs the turn initiator to administer the layer (group/team; platform is read-only); applies from the next turn.'
const SKILL_FORMAT =
  ' A skill is a folder with SKILL.md starting with YAML frontmatter: name (lowercase letters, digits, hyphens, ≤64, unique in the layer) ' +
  'and description (≤1024: what it does and when to use it; agents load it by this). The body gives the steps, kept short; ' +
  'details go in references/ read on demand, scripts in scripts/. At most 5 MB and 200 files.'

export const GONGGONG_TOOLS = {
  list_messages: {
    title: GONGGONG_TOOL_TITLES.list_messages,
    description:
      'Read the group chat in time order (people and bot final replies). Messages are #seq; page or jump with before / after / around. Thread replies are not in the main chat: a root shows its reply count; read them with thread.',
    input: ListMessagesArgs,
  },
  search_messages: {
    title: GONGGONG_TOOL_TITLES.search_messages,
    description: 'Search the chat by keyword, newest first; group=all searches every group you are in.',
    input: SearchMessagesArgs,
  },
  get_group_info: {
    title: GONGGONG_TOOL_TITLES.get_group_info,
    description:
      'Group name, notice, mode, repos, members (people and bots with status) and other groups you can read.',
    input: GetGroupInfoArgs,
  },
  get_run: {
    title: GONGGONG_TOOL_TITLES.get_run,
    description:
      "A bot run's trigger, status, summary, changed files, usage, questions and answers; include_patch adds the diff.",
    input: GetRunArgs,
  },
  list_questions: {
    title: GONGGONG_TOOL_TITLES.list_questions,
    description: 'Past question cards and their answers: reuse decisions already made.',
    input: ListQuestionsArgs,
  },
  fetch_attachments: {
    title: GONGGONG_TOOL_TITLES.fetch_attachments,
    description: "Download a message's attachments into .gonggong/attachments/ and return their paths.",
    input: FetchAttachmentsArgs,
  },
  list_feishu_messages: {
    title: GONGGONG_TOOL_TITLES.list_feishu_messages,
    description:
      'Read recent messages of the bound Feishu chat live, as the requester (nothing stored). ' +
      'Only messages to bots sync here: use it for earlier discussion in Feishu.',
    input: ListFeishuMessagesArgs,
  },
  preview_expose: {
    title: GONGGONG_TOOL_TITLES.preview_expose,
    description:
      'Publish a web page or service on a local port to members: returns a preview link and posts a preview card. Start the service with service_start first.',
    input: PreviewExposeArgs,
  },
  preview_gui: {
    title: GONGGONG_TOOL_TITLES.preview_gui,
    description:
      'Stream the windows of a desktop app started with service_start (e.g. Electron, Tauri) to members through a preview card; ' +
      "with the bot owner's consent they can control it. Only that process's windows, never the whole screen.",
    input: PreviewGuiArgs,
  },
  preview_close: {
    title: GONGGONG_TOOL_TITLES.preview_close,
    description: 'Close a preview link (the service keeps running).',
    input: PreviewCloseArgs,
  },
  progress_card: {
    title: GONGGONG_TOOL_TITLES.progress_card,
    description:
      'Post a live progress card (build, deploy…); pass its id to update the same card, also in later turns (only given fields change). ' +
      'For long tasks polling outside state; at the end mark stages done or failed with the reason.',
    input: ProgressCardArgs,
  },
  hand_off: {
    title: GONGGONG_TOOL_TITLES.hand_off,
    description:
      'Hand work to another bot: after this turn a message from you @-mentions it with the task and it starts. ' +
      'group hands to a bot of another group you are in. Writing @name in a reply does not start it.',
    input: HandOffArgs,
  },
  schedule_create: {
    title: GONGGONG_TOOL_TITLES.schedule_create,
    description:
      'Schedule a task here: when due, a bot is @-mentioned with prompt on behalf of the turn initiator. Use it for recurring or later work ' +
      'instead of sleeping. Returns the next run times: report them for the user to check.',
    input: ScheduleCreateArgs,
  },
  schedule_list: {
    title: GONGGONG_TOOL_TITLES.schedule_list,
    description: "This group's scheduled tasks: id, name, bots, timing, enabled, next run and last result.",
    input: ScheduleListArgs,
  },
  schedule_update: {
    title: GONGGONG_TOOL_TITLES.schedule_update,
    description:
      'Change a scheduled task, only the fields to change (as in schedule_create). Only tasks you created or are a candidate of.',
    input: ScheduleUpdateArgs,
  },
  schedule_delete: {
    title: GONGGONG_TOOL_TITLES.schedule_delete,
    description:
      'Delete a scheduled task. A scheduled turn may delete its own task once it is no longer needed (e.g. the awaited condition is met).',
    input: ScheduleDeleteArgs,
  },
  skill_list: {
    title: GONGGONG_TOOL_TITLES.skill_list,
    description:
      'Team skills visible here (platform, team, group layers, disabled ones too): name, layer, description, version, in effect (lower layers override same names), editable by the initiator.',
    input: SkillListArgs,
  },
  skill_get: {
    title: GONGGONG_TOOL_TITLES.skill_get,
    description: "Read all of a skill's files, optionally of a layer or past version.",
    input: SkillGetArgs,
  },
  skill_create: {
    title: GONGGONG_TOOL_TITLES.skill_create,
    description: `Create a team skill.${SKILL_FORMAT}${SKILL_WRITE}`,
    input: SkillCreateArgs,
  },
  skill_update: {
    title: GONGGONG_TOOL_TITLES.skill_update,
    description: `Change a skill's files; each change is a new version, format as in skill_create.${SKILL_WRITE}`,
    input: SkillUpdateArgs,
  },
  skill_delete: {
    title: GONGGONG_TOOL_TITLES.skill_delete,
    description: `Delete a skill with all its versions for good; skill_toggle disables it instead.${SKILL_WRITE}`,
    input: SkillDeleteArgs,
  },
  skill_toggle: {
    title: GONGGONG_TOOL_TITLES.skill_toggle,
    description: `Enable or disable a skill.${SKILL_WRITE}`,
    input: SkillToggleArgs,
  },
  skill_versions: {
    title: GONGGONG_TOOL_TITLES.skill_versions,
    description: "A skill's versions: number, size, editor, time; the current one marked.",
    input: SkillVersionsArgs,
  },
  skill_rollback: {
    title: GONGGONG_TOOL_TITLES.skill_rollback,
    description: `Roll a skill back to a past version.${SKILL_WRITE}`,
    input: SkillRollbackArgs,
  },
  kb_list: {
    title: GONGGONG_TOOL_TITLES.kb_list,
    description: 'Knowledge base entries of this group: title, id, version, tags, pinned (no body).',
    input: KbListArgs,
  },
  kb_get: {
    title: GONGGONG_TOOL_TITLES.kb_get,
    description: 'Read a knowledge base entry with its version.',
    input: KbGetArgs,
  },
  kb_search: {
    title: GONGGONG_TOOL_TITLES.kb_search,
    description: "Search this group's knowledge base (title, body, tags) by keyword.",
    input: KbSearchArgs,
  },
  kb_create: {
    title: GONGGONG_TOOL_TITLES.kb_create,
    description:
      'Add a Markdown entry to the knowledge base every bot here reads: lasting facts of this group (conventions, environments, decisions, pitfalls). ' +
      'kb_search first and extend a related entry with kb_update instead of duplicating it. Never store secrets or passwords.',
    input: KbCreateArgs,
  },
  kb_update: {
    title: GONGGONG_TOOL_TITLES.kb_update,
    description:
      'Change an entry (only the fields to change); each change is a version members can roll back. base_version is the one kb_get gave you; ' +
      'if someone changed it since, the call fails: read it again, merge, retry.',
    input: KbUpdateArgs,
  },
  kb_delete: {
    title: GONGGONG_TOOL_TITLES.kb_delete,
    description:
      'Delete an entry. Needs the turn initiator to be a group admin; prefer fixing outdated content with kb_update.',
    input: KbDeleteArgs,
  },
  tab_list: {
    title: GONGGONG_TOOL_TITLES.tab_list,
    description: "The group's top tab bar: title, kind and target (link, knowledge entry, file, built-in).",
    input: TabListArgs,
  },
  tab_create: {
    title: GONGGONG_TOOL_TITLES.tab_create,
    description:
      'Pin a link, knowledge entry or workspace file to the top tab bar for reports, docs and dashboards people return to; ' +
      'check tab_list first, never duplicate, never pin one-off content.',
    input: TabCreateArgs,
  },
  mcp_list: {
    title: GONGGONG_TOOL_TITLES.mcp_list,
    description:
      'MCP servers visible here (platform, team, group layers, disabled ones too): name, layer, transport, command or URL, in effect (lower layers override same names), editable by the initiator; secrets only as filled or not.',
    input: McpListArgs,
  },
  mcp_get: {
    title: GONGGONG_TOOL_TITLES.mcp_get,
    description: "An MCP server's config, secrets masked.",
    input: McpGetArgs,
  },
  mcp_create: {
    title: GONGGONG_TOOL_TITLES.mcp_create,
    description: `Create an MCP server (stdio: command/args/env; http: url/headers).${MCP_SECRET}${MCP_WRITE}`,
    input: McpCreateArgs,
  },
  mcp_update: {
    title: GONGGONG_TOOL_TITLES.mcp_update,
    description: `Change an MCP server's config, secrets as in mcp_create.${MCP_WRITE}`,
    input: McpUpdateArgs,
  },
  mcp_toggle: {
    title: GONGGONG_TOOL_TITLES.mcp_toggle,
    description: `Enable or disable an MCP server.${MCP_WRITE}`,
    input: McpToggleArgs,
  },
  mcp_delete: {
    title: GONGGONG_TOOL_TITLES.mcp_delete,
    description: `Delete an MCP server for good; mcp_toggle disables it instead.${MCP_WRITE}`,
    input: McpDeleteArgs,
  },
  secret_list: {
    title: GONGGONG_TOOL_TITLES.secret_list,
    description:
      'Secrets usable here: name, purpose, mode (shared / shared_overridable: shared, personal override allowed / personal), layer, filled, injected this turn. ' +
      'Injected ones are env vars of the same name: read $NAME; never print values or put them in files, messages or commits.',
    input: SecretListArgs,
  },
  secret_request: {
    title: GONGGONG_TOOL_TITLES.secret_request,
    description:
      'Post a 「填写密钥」 card: the initiator fills personal / overridable secrets, a layer admin shared ones; values never pass through you, the chat or logs. ' +
      'Returns at once; filled values are injected from the next turn. Never ask for secrets in the chat.',
    input: SecretRequestArgs,
  },
  plugin_catalog: {
    title: GONGGONG_TOOL_TITLES.plugin_catalog,
    description:
      'Creation plugins enabled here (slides, prototypes…). Without plugin: plugins, template and design system counts, whether you can use each. ' +
      'With plugin: its templates (id, title, group, inputs, uses a design system), design systems (id, title, category, palette) and inputs. ' +
      'When members ask for such work in the chat, pick a template here, then creation_propose.',
    input: PluginCatalogArgs,
  },
  creation_propose: {
    title: GONGGONG_TOOL_TITLES.creation_propose,
    description:
      'Post a creation card with plugin, template, design system and inputs; a member clicking 「开始」 sends you the formal request on their behalf ' +
      '(or 「改参数」 / 「不用了」). Returns at once; do not start before the formal request arrives.',
    input: CreationProposeArgs,
  },
  artifact_checkout: {
    title: GONGGONG_TOOL_TITLES.artifact_checkout,
    description:
      'Check out a hosted artifact of this group (design/<slug>/, the server copy wins) that this turn did not get and you need to read or change. ' +
      'It arrives in the workspace before the next turn, not this one; returns its dir, version and screens.',
    input: ArtifactCheckoutArgs,
  },
} as const

export type GonggongToolName = keyof typeof GONGGONG_TOOLS

type ToolDefs = Record<string, { title: string; description: string; input: z.ZodType; alwaysLoad?: true }>
const toolList = (tools: ToolDefs) =>
  Object.entries(tools).map(([name, t]) => {
    const { $schema: _, ...inputSchema } = z.toJSONSchema(t.input, {
      io: 'input',
      // A `format` says it already; zod's spelled-out regex (hundreds of chars for date-time) only costs tokens.
      override: ({ jsonSchema: s }) => {
        if (s.format) delete s.pattern
      },
    })
    // Claude Code otherwise defers MCP tools behind ToolSearch, where the agent sees only their names.
    const meta = t.alwaysLoad ? { _meta: { 'anthropic/alwaysLoad': true } } : {}
    return { name, title: t.title, description: t.description, inputSchema, ...meta }
  })

/** MCP `tools/list` entries (what `gonggong-tools.json` holds). */
export const gonggongToolList = () => toolList(GONGGONG_TOOLS)

export const ServiceStartArgs = z.object({
  name: serviceName,
  command: z.string().min(1).max(2000).describe('Shell command run in the workspace'),
  cwd: z.string().max(500).describe('Workspace-relative dir, default the root').optional(),
  port: port.describe('Port it listens on; waits until ready (up to 60 s)').optional(),
  env: z.record(z.string(), z.string()).describe('Extra env vars').optional(),
  display: z
    .enum(['virtual'])
    .describe(
      "Desktop apps: virtual runs on a new virtual display (Xvfb), not the owner's screen, and preview_gui streams all of it; Linux only",
    )
    .optional(),
})
export const ServiceListArgs = z.object({})
export const ServiceLogsArgs = z.object({
  name: serviceName,
  tail: z.number().int().min(1).max(1000).describe('Last lines, default 100').optional(),
})
export const ServiceStopArgs = z.object({ name: serviceName })
export const PreviewStaticArgs = z.object({
  dir: z
    .string()
    .max(500)
    .describe('Workspace dir to publish (e.g. dist, docs/report), default the root')
    .optional(),
  title: z.string().min(1).max(60).describe('Card title: what this is'),
  path: z.string().regex(/^\//).max(500).describe('Path to open, default / (index.html)').optional(),
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
  title: z.string().min(1).max(HTML_RENDER_TITLE_MAX).describe('What the page shows.'),
  height: z
    .number()
    .int()
    .min(HTML_RENDER_MIN_HEIGHT)
    .max(HTML_RENDER_MAX_HEIGHT)
    .describe(
      `Frame height in CSS pixels, ${HTML_RENDER_MIN_HEIGHT} to ${HTML_RENDER_MAX_HEIGHT}. Default: the page's own, measured; set it only to cut a long page short.`,
    )
    .optional(),
})

const PAGE_RULES =
  'Inline <style> and <script>. Local images given as absolute paths are inlined. Remote URLs load as-is.'

export const PreviewMiniprogramArgs = z.object({
  dir: z
    .string()
    .max(500)
    .describe('Workspace dir of the mini program (with project.config.json), default the root')
    .optional(),
  page: z
    .string()
    .regex(/^[^/?]/)
    .max(300)
    .describe('Page to open, e.g. pages/goods/detail, default the home page')
    .optional(),
  query: z.string().regex(/^[^?]/).max(500).describe('Page query, e.g. id=42&from=share').optional(),
  title: z.string().min(1).max(60).describe('Card title: what this is'),
})

export const ClientReleasePublishArgs = z
  .object({
    file: z
      .string()
      .min(1)
      .max(500)
      .describe(
        'One build output, workspace-relative (e.g. dist/0.3.1/gonggong-0.3.1-macos-aarch64), named as scripts/release.sh names it',
      )
      .optional(),
    dir: z
      .string()
      .min(1)
      .max(500)
      .describe(
        'A whole dir, workspace-relative (e.g. dist/0.3.1): uploads every release file and RELEASE_NOTES.md, skipping SHA256SUMS, manifest.json and subdirs',
      )
      .optional(),
    kind: z
      .literal('daemon')
      .describe('Only gg and gg-cast (no desktop app); dir needs every platform')
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
  version: DaemonRelease.shape.version.describe('The current release version, e.g. 0.3.5'),
  releaseNotes: ReleaseNotesReq.shape.releaseNotes.describe(
    'Full Markdown release notes, shown in desktop and daemon update prompts',
  ),
})

export const FEISHU_CARD_IMAGES_MAX = 10

export const FeishuSendCardArgs = z.object({
  card: z
    .record(z.string(), z.unknown())
    .describe(
      'Feishu card JSON 2.0 (see the feishu-card skill); a local image goes in as a placeholder img_key such as "chart"',
    ),
  images: z
    .record(z.string().regex(/^[\w-]{1,40}$/), z.string().min(1).max(500))
    .describe(
      `Placeholder → workspace image path, e.g. {"chart": "out/chart.png"}; up to ${FEISHU_CARD_IMAGES_MAX}, 10 MB each`,
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
      'Send workspace images, videos or other files as your group message, previewable in the chat. ' +
      'Use it whenever members should see media you produced.',
    input: SendAttachmentsArgs,
  },
  service_start: {
    title: '启动托管服务',
    description:
      'Start a long-running service managed by gonggong (e.g. a dev server) that outlives the turn; then preview_expose it. ' +
      'Restarting a name keeps its preview cards working, no need to publish again.',
    input: ServiceStartArgs,
  },
  service_list: {
    title: '托管服务列表',
    description: 'Your managed services here: name, state, port, uptime.',
    input: ServiceListArgs,
  },
  service_logs: {
    title: '托管服务日志',
    description: "Tail of a managed service's output (stdout and stderr).",
    input: ServiceLogsArgs,
  },
  service_stop: {
    title: '停止托管服务',
    description:
      'Stop a managed service and its children. Its preview cards stay and show it stopped until it is started again.',
    input: ServiceStopArgs,
  },
  preview_static: {
    title: '发布静态页面',
    description:
      'Publish workspace static files (HTML reports, builds…) as a site with a preview card; no server needed.',
    input: PreviewStaticArgs,
  },
  html_preview: {
    title: '预览 HTML',
    description: `Optional check before html_render: returns a PNG, contentHeight and console output. ${PAGE_RULES} Rules are in html_render.`,
    input: HtmlPreviewArgs,
    alwaysLoad: true,
  },
  html_render: {
    title: '在群聊中展示 HTML',
    description: `Show a finished HTML page inline in your final reply; the result gives its id to place it there; do not restate it. Height fits the page up to ${HTML_RENDER_MAX_FIT_HEIGHT}px. ${PAGE_RULES} ${HTML_RENDER_LAYOUT_GUIDE} ${HTML_RENDER_THEME_GUIDE}`,
    input: HtmlRenderArgs,
    alwaysLoad: true,
  },
  client_release_publish: {
    title: '发布客户端到当前空间',
    description:
      'Upload client builds from scripts/release.sh (gg, gg-cast, desktop installers and updates) to this space; members update from here. ' +
      'Prefer dir for a whole dist/<version> (one approval), file for one more file, dir with kind="daemon" for gg only. Sysadmin turns only.',
    input: ClientReleasePublishArgs,
  },
  client_release_notes: {
    title: '更新客户端版本说明',
    description:
      'Write the Markdown notes of the current release, shown at the next update check. Sysadmin turns only.',
    input: ClientReleaseNotesArgs,
  },
  feishu_send_card: {
    title: GONGGONG_TOOL_TITLES.feishu_send_card,
    description:
      "Send a custom card to the bound Feishu chat as this bot's Feishu app, replying to the message that started the turn. " +
      'Read the feishu-card skill first. Ordinary replies sync to Feishu by themselves.',
    input: FeishuSendCardArgs,
  },
  preview_miniprogram: {
    title: '发布小程序预览',
    description:
      'Open the workspace mini program in WeChat DevTools on this machine at a page and post a card with a simulator screenshot; call again to switch pages. ' +
      'It handles launch, login (QR code on the card) and trust: never drive DevTools yourself or send QR codes.',
    input: PreviewMiniprogramArgs,
  },
} as const

export const daemonToolList = () => toolList(DAEMON_TOOLS)
