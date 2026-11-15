import { z } from 'zod'
import { McpServer, OPEN_APPS, SkillFile } from '../daemon.js'

// ── Composer candidates (spec §8.7) ────────────────────────────────────────
export const FileCandidatesDto = z.object({
  /** workspace = the @-ed bot's workspace (incl. uncommitted); mirror = base-branch mirror on the server; authority = P2. */
  source: z.enum(['workspace', 'mirror', 'none']),
  /** e.g. 「小王的 Claude 工作区 · 含未提交」 / 「main 镜像 · 3 分钟前更新」 */
  label: z.string(),
  entries: z.array(
    z.object({
      path: z.string(),
      dir: z.boolean(),
      uncommitted: z.boolean(),
      /** Only in the mirror, not in the @-ed bot's workspace → 「该文件不在你的工作区，可能需要拉取」. */
      notInWorkspace: z.boolean(),
    }),
  ),
})
export type FileCandidatesDto = z.infer<typeof FileCandidatesDto>

export const CommandCandidatesDto = z.object({
  system: z.array(z.object({ name: z.string(), hint: z.string() })),
  /**
   * Team skills merged over the platform, team and group layers, as the agents name them; `personal` marks the
   * caller's own installs, which apply to the runs they start.
   */
  skill: z
    .array(z.object({ name: z.string(), hint: z.string(), personal: z.literal(true).optional() }))
    .default([]),
  /** Chat commands of the plugins the group turned on (plan 插件扩展点 §7); system commands win a clash. */
  plugin: z.array(z.object({ name: z.string(), hint: z.string(), plugin: z.string() })).default([]),
  /** Agent commands reported over ACP (Claude reports repo skills as commands), minus the team skills above. */
  agent: z.array(z.object({ name: z.string(), hint: z.string(), botId: z.string(), botName: z.string() })),
})
export type CommandCandidatesDto = z.infer<typeof CommandCandidatesDto>

// ── 用本地应用打开工作区 (on the bot's machine, for its owner) ──────────────
/** GET /api/groups/:id/bots/:botId/open-apps — what the machine can open the workspace with, in menu order. */
export const OpenAppsDto = z.object({ apps: z.array(z.enum(OPEN_APPS)) })
export type OpenAppsDto = z.infer<typeof OpenAppsDto>
/** POST /api/groups/:id/bots/:botId/open */
export const OpenWorkspaceReq = z.object({ app: z.enum(OPEN_APPS) })

// ── MCP layers (spec §7; platform → team → group, plan 团队层级 D8) ─────────
export const McpServerDto = z.object({
  id: z.string(),
  enabled: z.boolean(),
  config: McpServer,
  updatedAt: z.string(),
})
export type McpServerDto = z.infer<typeof McpServerDto>
export const SaveMcpReq = z.object({
  enabled: z.boolean(),
  config: McpServer,
  /** 「强制相关 bot 下一轮开新会话」 (spec §7.4), default off. */
  forceNewSession: z.boolean().default(false),
})
/** A platform / team server in effect for the group, which its admins may turn off for the group alone. */
export const InheritedMcpDto = McpServerDto.extend({
  scope: z.enum(['platform', 'team']),
  enabledInGroup: z.boolean(),
})
export type InheritedMcpDto = z.infer<typeof InheritedMcpDto>
/** POST /api/mcp-secrets/:id — the values go straight into the server's env / headers. */
export const FillMcpSecretReq = z.object({ values: z.record(z.string(), z.string().min(1).max(8192)) })

// ── Team skills (plan 团队Skill): platform → team → group layers, versioned ────
export const SKILL_MAX_BYTES = 5 * 1024 * 1024
export const SKILL_MAX_FILES = 200
/** `name` / `description` come from the SKILL.md frontmatter of the current version. */
export const SkillDto = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  enabled: z.boolean(),
  versionId: z.string(),
  version: z.number().int(),
  size: z.number().int(),
  updatedBy: z.string().nullable(),
  updatedAt: z.string(),
})
export type SkillDto = z.infer<typeof SkillDto>
export const SkillDetailDto = SkillDto.extend({ files: z.array(SkillFile) })
export type SkillDetailDto = z.infer<typeof SkillDetailDto>
export const SkillVersionDto = z.object({
  id: z.string(),
  version: z.number().int(),
  digest: z.string(),
  size: z.number().int(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  current: z.boolean(),
})
export type SkillVersionDto = z.infer<typeof SkillVersionDto>
export const SkillVersionDetailDto = SkillVersionDto.extend({ files: z.array(SkillFile) })
export type SkillVersionDetailDto = z.infer<typeof SkillVersionDetailDto>
const SkillFiles = z.array(SkillFile).min(1).max(SKILL_MAX_FILES)
export const CreateSkillReq = z.object({ enabled: z.boolean().default(true), files: SkillFiles })
/** New files make a new version unless identical to the current one. */
export const UpdateSkillReq = z.object({ enabled: z.boolean().optional(), files: SkillFiles.optional() })
export const RollbackSkillReq = z.object({ versionId: z.string() })
/** A platform / team skill in effect for the group, which its admins may turn off for the group alone. */
export const InheritedSkillDto = z.object({
  name: z.string(),
  description: z.string(),
  scope: z.enum(['platform', 'team']),
  version: z.number().int(),
  enabledInGroup: z.boolean(),
})
export type InheritedSkillDto = z.infer<typeof InheritedSkillDto>
export const ToggleInheritedReq = z.object({ enabled: z.boolean() })

// ── Group knowledge base (群知识库): markdown entries every bot of the group reads, versioned ────
export const KNOWLEDGE_MAX_ENTRIES = 200
export const KNOWLEDGE_TITLE_MAX = 100
export const KNOWLEDGE_BODY_MAX = 20000
export const KNOWLEDGE_TAGS_MAX = 10
/** Who made a change: a member, or a bot through the gonggong kb_* tools. */
export const KnowledgeAuthor = z.object({ kind: z.enum(['user', 'bot']), id: z.string(), name: z.string() })
export type KnowledgeAuthor = z.infer<typeof KnowledgeAuthor>
const KnowledgeTags = z.array(z.string().trim().min(1).max(30)).max(KNOWLEDGE_TAGS_MAX)
/** A list row; `excerpt` is the head of the body (GET the entry for all of it). */
export const KnowledgeEntryDto = z.object({
  id: z.string(),
  title: z.string(),
  excerpt: z.string(),
  tags: z.array(z.string()),
  pinned: z.boolean(),
  version: z.number().int(),
  updatedBy: KnowledgeAuthor.nullable(),
  updatedAt: z.string(),
})
export type KnowledgeEntryDto = z.infer<typeof KnowledgeEntryDto>
export const KnowledgeDetailDto = KnowledgeEntryDto.omit({ excerpt: true }).extend({ body: z.string() })
export type KnowledgeDetailDto = z.infer<typeof KnowledgeDetailDto>
/** GET /api/groups/:id/knowledge[?q=]: pinned first, then most recently updated. `canManage`: may pin and delete. */
export const GroupKnowledgeDto = z.object({ entries: z.array(KnowledgeEntryDto), canManage: z.boolean() })
export type GroupKnowledgeDto = z.infer<typeof GroupKnowledgeDto>
export const KnowledgeVersionDto = z.object({
  version: z.number().int(),
  title: z.string(),
  body: z.string(),
  tags: z.array(z.string()),
  action: z.enum(['create', 'update', 'rollback']),
  by: KnowledgeAuthor.nullable(),
  at: z.string(),
  current: z.boolean(),
})
export type KnowledgeVersionDto = z.infer<typeof KnowledgeVersionDto>
/** POST /api/groups/:id/knowledge. `pinned` needs a group admin. */
export const CreateKnowledgeReq = z.object({
  title: z.string().trim().min(1).max(KNOWLEDGE_TITLE_MAX),
  body: z.string().max(KNOWLEDGE_BODY_MAX),
  tags: KnowledgeTags.default([]),
  pinned: z.boolean().optional(),
})
export type CreateKnowledgeReq = z.infer<typeof CreateKnowledgeReq>
/**
 * PATCH /api/knowledge/:id. `baseVersion`: the version edited; a newer current version → 409 conflict. Changing only
 * `pinned` (group admins) skips that check and keeps the version.
 */
export const UpdateKnowledgeReq = z.object({
  baseVersion: z.number().int(),
  title: z.string().trim().min(1).max(KNOWLEDGE_TITLE_MAX).optional(),
  body: z.string().max(KNOWLEDGE_BODY_MAX).optional(),
  tags: KnowledgeTags.optional(),
  pinned: z.boolean().optional(),
})
export type UpdateKnowledgeReq = z.infer<typeof UpdateKnowledgeReq>
/** POST /api/knowledge/:id/rollback: the old version's content becomes a new version. */
export const RollbackKnowledgeReq = z.object({ version: z.number().int() })
export type RollbackKnowledgeReq = z.infer<typeof RollbackKnowledgeReq>

// ── Search (⌘K, plan D9) ────────────────────────────────────────────────────
export const SearchQuery = z.object({ q: z.string().min(1).max(200), tab: z.enum(['msg', 'file', 'run']) })
export const SearchResultDto = z.object({
  kind: z.enum(['msg', 'file', 'run']),
  title: z.string(),
  sub: z.string(),
  groupId: z.string(),
  messageId: z.string().nullable(),
  /** A thread reply's root: the hit opens in its thread. */
  threadRootId: z.string().nullable().optional(),
  runId: z.string().nullable(),
  /** When the message was sent / the run was queued; null for base-branch files. */
  at: z.string().nullable(),
})
export type SearchResultDto = z.infer<typeof SearchResultDto>
