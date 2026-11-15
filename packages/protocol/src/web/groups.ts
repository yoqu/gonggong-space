import { z } from 'zod'
import { I18nText } from '../i18n.js'
import { LiveRun } from '../live-run.js'
import { NotifyLevel } from './errors-auth.js'

// ── Groups ──────────────────────────────────────────────────────────────────
export const GroupKind = z.enum(['group', 'dm'])
/** 技术 or 业务 (conclusion first, plain words, evidence last); stored in `groups.params`, absent = tech. */
export const ReplyStyle = z.enum(['tech', 'business'])
export type ReplyStyle = z.infer<typeof ReplyStyle>
/** 公开 channels can be found in 浏览频道 and joined by anyone in the team; 私有 ones only by invitation. */
export const GroupVisibility = z.enum(['public', 'private'])
export type GroupVisibility = z.infer<typeof GroupVisibility>
export const GroupDto = z.object({
  id: z.string(),
  teamId: z.string(),
  name: z.string(),
  kind: GroupKind,
  /** Always sent by the server; DMs are private. */
  visibility: GroupVisibility.optional(),
  /** Uploaded image; null = tiled from the members (a DM shows its bot). */
  avatar: z.string().nullable(),
  mode: z.enum(['partition', 'force']),
  /** Only group admins may invite people; members always may pull in their own bots. */
  adminOnlyInvite: z.boolean(),
  /** 禁止直推基准分支: agents commit on feature branches; pushing to the base branch asks the bot owner. */
  protectBase: z.boolean(),
  /** 回复风格: how the bots word their replies; always sent by the server. */
  replyStyle: ReplyStyle.optional(),
  /** Bot回复进话题: replies to an @ in the main timeline go into a thread of the trigger message (plan 话题). */
  botRepliesInThread: z.boolean().optional(),
  notice: z.string(),
  /** The caller closed the current notice for themselves; a newer notice shows again. */
  noticeHidden: z.boolean(),
  /** The main repo: the bots work in it. */
  repo: z.object({ url: z.string(), branch: z.string() }).nullable(),
  /** Extra repos, cloned beside the main one and added to each bot's session (partition groups only). */
  extraRepos: z.array(z.object({ id: z.string(), url: z.string(), branch: z.string() })).optional(),
  members: z.array(
    z.object({ userId: z.string(), name: z.string(), avatar: z.string().nullable(), isAdmin: z.boolean() }),
  ),
  botIds: z.array(z.string()),
  unread: z.number().int(),
  /** Unread messages that @ the caller (or @所有人), up to 99; always sent by the server. */
  mentionCount: z.number().int().optional(),
  lastSeq: z.number().int(),
  /** One-line preview of the latest message, '' when empty. */
  last: z.string(),
  /** `last`'s translatable source for recall notes and events; `last` holds its Chinese rendering. */
  lastI18n: I18nText.optional(),
  /** When the latest message was posted, else when the group was created: the list's order. Always sent by the server. */
  lastAt: z.string().optional(),
  /** The requesting user's own prefs. */
  pinned: z.boolean(),
  /** The caller's sidebar section holding it; null = its kind's default section. Always sent by the server. */
  sectionId: z.string().nullable().optional(),
  /** 团队分区 it is filed under, seen by the whole team; null = none. Always sent by the server. */
  teamSectionId: z.string().nullable().optional(),
  /** 完成: the caller marked it done up to this seq; done while `lastSeq` has not passed it. Always sent by the server. */
  doneSeq: z.number().int().nullable().optional(),
  /** 标记 by the caller; always sent by the server. */
  flagged: z.boolean().optional(),
  notifyLevel: NotifyLevel,
  foldRuns: z.boolean(),
  /** Bot turns live here (running, or waiting on an approval or answer); non-empty tags the conversation. */
  liveRunIds: z.array(z.string()),
  /** Bot turns not ended yet (queued included), as the caller sees them: what the conversation list shows. */
  liveRuns: z.array(LiveRun),
  /** The Feishu chat the group is bound to; absent when unbound. */
  feishu: z.object({ chatId: z.string(), name: z.string() }).optional(),
  /** DMs only: where the Bot works, null until its workspace is set up. */
  workspacePath: z.string().nullable().optional(),
})
export type GroupDto = z.infer<typeof GroupDto>
/** GET /api/groups/:id/notices — every published notice, newest first. */
export const GroupNoticeDto = z.object({
  id: z.string(),
  body: z.string(),
  authorName: z.string(),
  createdAt: z.string(),
  /** Set when an admin removed or replaced it. */
  removedAt: z.string().nullable(),
})
export type GroupNoticeDto = z.infer<typeof GroupNoticeDto>

export const CreateGroupReq = z.object({
  name: z.string().min(1).max(60),
  kind: GroupKind,
  memberIds: z.array(z.string()).default([]),
  botIds: z.array(z.string()).default([]),
  repo: z.object({ url: z.string(), branch: z.string() }).nullable().default(null),
  visibility: GroupVisibility.optional(),
})
export const GroupMemberReq = z.object({ userIds: z.array(z.string()).min(1).max(200) })
export const GroupBotReq = z.object({ botId: z.string() })
/** Moves the read cursor forward; omit `seq` to mark everything read. */
export const MarkReadReq = z.object({ seq: z.number().int().min(0).optional() })
/** PUT /api/groups/:id/unread: 从这里标为未读, the read cursor moves back to just before `seq`. */
export const MarkUnreadReq = z.object({ seq: z.number().int().min(1) })
export const RepoReq = z.object({ url: z.string(), branch: z.string() })
/**
 * POST /api/groups/:id/repos adds an extra repo (RepoReq); PATCH …/repos/:repoId changes its branch, or its URL to
 * another one of the same repo (ssh ↔ http).
 */
export const RepoBranchReq = z.object({ branch: z.string().min(1), url: z.string().optional() })

/** 群标签栏 (docs/archive/2026-11/群标签栏-设计.md): shared tabs under the group header; any member edits them. */
export const MAX_GROUP_TABS = 30
export const GROUP_TAB_TITLE_MAX = 40
export const GROUP_TAB_URL_MAX = 2000
/** Built-in pages a tab can pin; `git-log` needs the bot whose history it shows. */
export const GroupTabEntry = z.enum(['notice', 'pins', 'schedules', 'git-log'])
export type GroupTabEntry = z.infer<typeof GroupTabEntry>
const tabUrl = z
  .string()
  .trim()
  .max(GROUP_TAB_URL_MAX)
  .refine((u) => /^https?:\/\//i.test(u) && URL.canParse(u), '只支持 http/https 链接')
export const GroupTabTargetReq = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('link'), url: tabUrl }),
  z.object({ kind: z.literal('knowledge'), knowledgeId: z.string().uuid() }),
  z.object({ kind: z.literal('file'), botId: z.string().uuid(), path: z.string().trim().min(1).max(500) }),
  z.object({ kind: z.literal('entry'), entry: GroupTabEntry, botId: z.string().uuid().optional() }),
])
export type GroupTabTargetReq = z.infer<typeof GroupTabTargetReq>
/** What a tab opens. A link carries what the server learnt fetching it: favicon, and whether it may be framed. */
export const GroupTabTarget = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('link'),
    url: z.string(),
    icon: z.string().nullable(),
    embeddable: z.boolean(),
  }),
  z.object({ kind: z.literal('knowledge'), knowledgeId: z.string() }),
  z.object({ kind: z.literal('file'), botId: z.string(), path: z.string() }),
  z.object({ kind: z.literal('entry'), entry: GroupTabEntry, botId: z.string().optional() }),
])
export type GroupTabTarget = z.infer<typeof GroupTabTarget>
export const GroupTabDto = z.object({
  id: z.string(),
  title: z.string(),
  target: GroupTabTarget,
  /** The knowledge entry or bot it points at is gone. */
  stale: z.boolean(),
  createdBy: z.object({ name: z.string(), bot: z.boolean() }),
  createdAt: z.string(),
})
export type GroupTabDto = z.infer<typeof GroupTabDto>
/** GET /api/groups/:id/tabs, in bar order; every change answers and broadcasts the whole list. */
export const GroupTabsDto = z.object({ tabs: z.array(GroupTabDto) })
export type GroupTabsDto = z.infer<typeof GroupTabsDto>
const tabTitle = z.string().trim().min(1).max(GROUP_TAB_TITLE_MAX)
/** POST /api/groups/:id/tabs. No title: the link's page title, the entry's or file's name. */
export const CreateGroupTabReq = z.object({ title: tabTitle.optional(), target: GroupTabTargetReq })
/** PATCH /api/groups/:id/tabs/:tabId */
export const UpdateGroupTabReq = z.object({ title: tabTitle })
/** PUT /api/groups/:id/tabs/order: every tab id, in the new order. */
export const ReorderGroupTabsReq = z.object({ ids: z.array(z.string().uuid()).max(MAX_GROUP_TABS) })
/** POST /api/link-meta {url}: what a link tab would show; title null when the page can't be read. */
export const LinkMetaReq = z.object({ url: tabUrl })
export const LinkMetaDto = z.object({
  title: z.string().nullable(),
  icon: z.string().nullable(),
  embeddable: z.boolean(),
})
export type LinkMetaDto = z.infer<typeof LinkMetaDto>

// ── Group settings (spec §10; group admins) ────────────────────────────────
export const GroupParams = z.object({
  approvalTimeoutMin: z
    .number()
    .int()
    .min(1)
    .max(24 * 60),
  chainMaxHops: z.number().int().min(1).max(10),
  offlineWaitMin: z
    .number()
    .int()
    .min(1)
    .max(24 * 60),
})
export type GroupParams = z.infer<typeof GroupParams>
/** PATCH /api/groups/:id (admins). */
export const UpdateGroupReq = z.object({
  name: z.string().trim().min(1, '填写群名称').max(60).optional(),
  notice: z.string().trim().max(500).optional(),
  adminOnlyInvite: z.boolean().optional(),
  protectBase: z.boolean().optional(),
  replyStyle: ReplyStyle.optional(),
  botRepliesInThread: z.boolean().optional(),
  visibility: GroupVisibility.optional(),
})
export type UpdateGroupReq = z.infer<typeof UpdateGroupReq>
/** PUT /api/groups/:id/prefs — only for the caller. */
export const GroupPrefsReq = z
  .object({
    notifyLevel: NotifyLevel,
    pinned: z.boolean(),
    foldRuns: z.boolean(),
    noticeHidden: z.boolean(),
    /** 完成 up to the latest message, or back to the list. */
    done: z.boolean(),
    flagged: z.boolean(),
    /** One of the caller's sidebar sections, null back to the default one. */
    sectionId: z.string().uuid().nullable(),
  })
  .partial()
export type GroupPrefsReq = z.infer<typeof GroupPrefsReq>

/** 侧栏自建分区: the caller's own sections in the current team, in their order (GET/POST /api/sidebar-sections). */
export const SidebarSectionDto = z.object({
  id: z.string(),
  name: z.string(),
  /** The section it nests under; null at the top. */
  parentId: z.string().nullable(),
})
export type SidebarSectionDto = z.infer<typeof SidebarSectionDto>
/** Sections nest at most this deep (研发 › 支付线 › 结算). */
export const SECTION_MAX_DEPTH = 3
/** PATCH /api/sidebar-sections/:id, /api/team-sections/:id */
export const SidebarSectionReq = z.object({ name: z.string().trim().min(1, '填写分区名称').max(40) })
/** POST /api/sidebar-sections, /api/team-sections: under `parentId`, else at the top. */
export const SidebarSectionCreateReq = SidebarSectionReq.extend({
  parentId: z.string().uuid().nullable().optional(),
})

/** Depth of section `id` (1 at the top) in `list`, following parents. */
export function sectionDepth(list: { id: string; parentId: string | null }[], id: string) {
  let depth = 0
  for (let at = list.find((s) => s.id === id); at && depth <= list.length; depth++)
    at = at.parentId ? list.find((s) => s.id === at?.parentId) : undefined
  return depth
}
/** `id` and every section nested under it. */
export function sectionSubtree(list: { id: string; parentId: string | null }[], id: string): string[] {
  return [id, ...list.filter((s) => s.parentId === id).flatMap((s) => sectionSubtree(list, s.id))]
}
/** PUT /api/sidebar-sections/order: every section of mine, in the new order. */
export const SidebarSectionOrderReq = z.object({ ids: z.array(z.string().uuid()) })

/** 团队分区: set by team admins, seen by everyone in the team (GET /api/team-sections). */
export const TeamSectionsDto = z.object({
  sections: z.array(SidebarSectionDto),
  /** The caller is a team admin: may add, rename, reorder and delete them, and file any group. */
  canManage: z.boolean(),
})
export type TeamSectionsDto = z.infer<typeof TeamSectionsDto>
/** PUT /api/groups/:id/team-section (group admins, team admins). */
export const GroupTeamSectionReq = z.object({ teamSectionId: z.string().uuid().nullable() })

/** A group filed under a 团队分区 that the caller has not joined (GET /api/team-directory, GET /api/groups/:id/preview). */
export const DirectoryGroupDto = z.object({
  id: z.string(),
  name: z.string(),
  avatar: z.string().nullable(),
  notice: z.string(),
  memberCount: z.number().int(),
  visibility: GroupVisibility,
  teamSectionId: z.string(),
  admins: z.array(z.string()),
  /** The caller's pending join request, null when none. */
  requestId: z.string().nullable(),
})
export type DirectoryGroupDto = z.infer<typeof DirectoryGroupDto>
/** POST /api/groups/:id/join-requests: asks to join a private group filed under a 团队分区. */
export const JoinRequestReq = z.object({ note: z.string().trim().max(200).default('') })
/** GET /api/groups/:id/join-requests (group admins): pending requests, oldest first. */
export const JoinRequestDto = z.object({
  id: z.string(),
  groupId: z.string(),
  userId: z.string(),
  userName: z.string(),
  note: z.string(),
  createdAt: z.string(),
})
export type JoinRequestDto = z.infer<typeof JoinRequestDto>

/** GET /api/channels[?q=]: the team's public channels, joined or not, and the private groups I am in (浏览频道). */
export const ChannelDto = z.object({
  id: z.string(),
  name: z.string(),
  avatar: z.string().nullable(),
  notice: z.string(),
  memberCount: z.number().int(),
  joined: z.boolean(),
  visibility: GroupVisibility,
  createdByName: z.string(),
  /** Its latest message; null when it has none. */
  lastActivityAt: z.string().nullable(),
})
export type ChannelDto = z.infer<typeof ChannelDto>
