import { z } from 'zod'
import { AgentSettings, AgentSettingValues, RunSettingsSnapshot } from './agent-settings.js'
import {
  AgentKind,
  Allowlist,
  Answer,
  Approval,
  Attachment,
  ContextUsage,
  DevtoolsBlocker,
  DiffRepo,
  GitStatus,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  MAX_QUESTIONS,
  Permission,
  Question,
  RunConfigPick,
  RunStatus,
  Tier,
  TriggerScope,
  Usage,
} from './common.js'
import {
  AgentCatalog,
  AgentInfo,
  CcSwitchCandidate,
  DiffScope,
  FileTreeEntry,
  GitActionArgs,
  GitActionKind,
  GitBlameCommit,
  GitBlameRange,
  GitBranch,
  GitChange,
  GitCommit,
  GitConflict,
  GitConflictPick,
  GitHeadCommit,
  GitOngoing,
  GitProtocol,
  GitRemote,
  GitStash,
  GitTag,
  GitWorkChange,
  MachineInfo,
  McpServer,
  OfficialInput,
  OPEN_APPS,
  PermissionOption,
  ProviderInput,
  ProviderStateItem,
  ProviderStoreView,
  RepoAccessReason,
  RunEvent,
  SkillFile,
  TOOL_VERSION,
  ToolStatus,
  ToolsSettings,
} from './daemon.js'
import { I18nText } from './i18n.js'
import { LiveRun } from './live-run.js'
import { MessageCard } from './plugins.js'
import { GroupSchedulesDto } from './schedules.js'
import { RunSecret, SecretCard } from './secrets.js'
import { RunSyncDone, SyncStatusDto } from './sync.js'
import { ActionAnswer } from './ui-blocks.js'

/** REST base: /api. Auth: httpOnly cookie `gonggong_session`. Errors: { error: ErrorCode, message }. */
export const ErrorCode = z.enum([
  'unauthorized',
  'forbidden',
  'not_found',
  'invalid',
  'conflict',
  'must_change_password',
  'code_expired',
  'code_locked',
  /** POST /api/messages/:id/recall past RECALL_WINDOW_MS. */
  'recall_expired',
  /** PATCH /api/messages/:id past RECALL_WINDOW_MS. */
  'edit_expired',
])
export const ApiError = z.object({ error: ErrorCode, message: z.string() })

// ── Users & auth ────────────────────────────────────────────────────────────
export const Role = z.enum(['sysadmin', 'member'])
export const UserDto = z.object({
  id: z.string(),
  account: z.string(),
  name: z.string(),
  role: Role,
  mustChangePassword: z.boolean(),
  disabled: z.boolean(),
  gitProtocol: GitProtocol,
  email: z.string().nullable(),
  /** Image URL (uploaded file or Feishu avatar); null = generated from the name. */
  avatar: z.string().nullable(),
})
export type UserDto = z.infer<typeof UserDto>
/** PATCH /api/me: the caller's own preferences and profile (same name rule as sign-up); `email: ''` clears it. */
export const UpdateMeReq = z.object({
  gitProtocol: GitProtocol.optional(),
  name: z.string().trim().min(1).max(40).optional(),
  email: z.union([z.literal(''), z.string().trim().toLowerCase().pipe(z.email().max(120))]).optional(),
})
/** PUT /api/{me,teams/:id,bots/:id,groups/:id}/avatar (multipart `file`): raster images only, SVG could carry script. */
export const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024

export const LoginReq = z.object({ account: z.string(), password: z.string() })
export const ChangePasswordReq = z.object({ oldPassword: z.string(), newPassword: z.string().min(8) })
/** Minimal user reference for pickers (GET /api/users). */
export const UserBriefDto = z.object({
  id: z.string(),
  name: z.string(),
  account: z.string(),
  avatar: z.string().nullable(),
})
export type UserBriefDto = z.infer<typeof UserBriefDto>
/** GET /api/users/:id/card?groupId= — hover card; `groupAdmin` is for `groupId`, `online` = has a live web session. */
export const UserCardDto = UserBriefDto.extend({ role: Role, groupAdmin: z.boolean(), online: z.boolean() })
export type UserCardDto = z.infer<typeof UserCardDto>

const Account = z.string().regex(/^[a-z0-9_.-]{2,32}$/)
export const CreateUserReq = z.object({
  account: Account,
  name: z.string().min(1),
  role: Role,
  password: z.string().min(8),
})
/** POST /api/auth/register — self sign-up, only while the sysadmin has opened it (系统参数 · 开放注册). */
export const RegisterReq = z.object({
  account: Account,
  name: z.string().trim().min(1).max(40),
  password: z.string().min(8),
  /** A valid team invite allows signing up while registration is closed, and joins its team (plan D12). */
  inviteToken: z.string().optional(),
})
/** GET /api/auth/options — public: what the login page may offer. */
export const AuthOptionsDto = z.object({
  registrationOpen: z.boolean(),
  /** The main Feishu app is configured: the login page offers 飞书登录. */
  feishuLogin: z.boolean(),
})
export type AuthOptionsDto = z.infer<typeof AuthOptionsDto>
export const UpdateUserReq = z.object({ name: z.string().min(1).optional(), role: Role.optional() })
/** POST /api/admin/users/:id/password — temporary password; the member must change it at next login. */
export const ResetPasswordReq = z.object({ password: z.string().min(8) })
/** Row of the admin 账号与角色 table. */
export const AdminUserDto = UserDto.extend({
  machineCount: z.number().int(),
  online: z.boolean(),
  /** Names of the live teams the account belongs to. */
  teams: z.array(z.string()),
})
export type AdminUserDto = z.infer<typeof AdminUserDto>

// ── Teams (plan 团队层级) ─────────────────────────────────────────────────────
export const TeamRole = z.enum(['owner', 'admin', 'member'])
export type TeamRole = z.infer<typeof TeamRole>
export const TeamDto = z.object({
  id: z.string(),
  name: z.string(),
  /** An uploaded image's URL (`/api/avatars/…`), else one character or emoji; null = the name's initial. */
  avatar: z.string().nullable(),
  /** The caller's role in it. */
  role: TeamRole,
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  /** The caller's unread messages in its groups plus its unread notifications. */
  unread: z.number().int(),
})
export type TeamDto = z.infer<typeof TeamDto>
/** GET /api/me (and the other endpoints returning the signed-in account): live teams, earliest joined first. */
export const MeDto = UserDto.extend({
  teams: z.array(TeamDto),
  /** Hides the team switcher (plan D11). */
  singleTeamMode: z.boolean(),
  /** 系统参数 · teamCreation allows the caller to create teams, and single-team mode is off. */
  canCreateTeam: z.boolean(),
  demoMode: z.boolean(),
  /** 系统参数 · the plugin master switch: group settings offer the 插件 tab while it is on. */
  pluginsEnabled: z.boolean(),
})
export type MeDto = z.infer<typeof MeDto>
const TeamName = z.string().trim().min(1).max(40)
/** One character or emoji shown instead of the name's initial. */
const TeamAvatar = z.string().trim().max(8).nullable()
export const CreateTeamReq = z.object({ name: TeamName })
export const AddTeamMemberReq = z.object({
  account: z.string().trim().min(1),
  role: TeamRole.default('member'),
})
export const UpdateTeamMemberReq = z.object({ role: TeamRole })
export const TransferTeamReq = z.object({ userId: z.string() })
export const CreateTeamInviteReq = z.object({
  role: z.enum(['admin', 'member']).default('member'),
  expiresInDays: z.number().int().min(1).max(30),
  /** null = unlimited. */
  maxUses: z.number().int().min(1).max(1000).nullable(),
})
export const TeamMemberDto = z.object({
  userId: z.string(),
  name: z.string(),
  account: z.string(),
  avatar: z.string().nullable(),
  role: TeamRole,
  joinedAt: z.string(),
})
export type TeamMemberDto = z.infer<typeof TeamMemberDto>
/** The token itself is only shown once, when the invite is created. */
export const TeamInviteDto = z.object({
  id: z.string(),
  teamId: z.string(),
  role: TeamRole,
  maxUses: z.number().int().nullable(),
  uses: z.number().int(),
  expiresAt: z.string(),
  createdBy: z.string(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
})
export type TeamInviteDto = z.infer<typeof TeamInviteDto>
export const CreatedTeamInviteDto = z.object({ invite: TeamInviteDto, token: z.string() })
export type CreatedTeamInviteDto = z.infer<typeof CreatedTeamInviteDto>
/** GET /api/invites/:token — public; `valid` is false once expired, used up, revoked or the team archived. */
export const InvitePreviewDto = z.object({
  teamName: z.string(),
  inviterName: z.string(),
  valid: z.boolean(),
})
export type InvitePreviewDto = z.infer<typeof InvitePreviewDto>
/** Row of 管理后台 · 团队 (archived teams included). */
export const AdminTeamDto = z.object({
  id: z.string(),
  name: z.string(),
  avatar: z.string().nullable(),
  /** Earliest-joined owner. */
  ownerId: z.string().nullable(),
  ownerName: z.string().nullable(),
  members: z.number().int(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
})
export type AdminTeamDto = z.infer<typeof AdminTeamDto>
/** POST /api/admin/teams — the chosen account becomes its owner. */
export const CreateAdminTeamReq = z.object({ name: TeamName, ownerId: z.string() })
/** PUT /api/admin/teams/:id/owner — the account becomes an owner (joining if needed); other owners become admins. */
export const SetTeamOwnerReq = z.object({ userId: z.string() })

// ── Machines ────────────────────────────────────────────────────────────────
/** `link` is the 接入链接 `gonggong://bind?server=…&code=…` the desktop app opens or parses. */
export const BindCodeDto = z.object({
  code: z.string(),
  expiresAt: z.string(),
  link: z.string(),
})
export type BindCodeDto = z.infer<typeof BindCodeDto>
/** `name` is the owner's label when set, else `hostname`. */
export const MachineDto = MachineInfo.omit({ hardwareId: true }).extend({
  id: z.string(),
  ownerId: z.string(),
  hostname: z.string(),
  boundAt: z.string(),
  createdAt: z.string(),
  online: z.boolean(),
  agents: z.array(AgentInfo),
  daemonVersion: z.string().nullable(),
  lastSeenAt: z.string().nullable(),
  /** DaemonFeature values of the connected daemon; empty while offline or for daemons that predate them. */
  features: z.array(z.string()),
})
export type MachineDto = z.infer<typeof MachineDto>
/** PATCH /api/machines/:id; an empty name falls back to the hostname. */
export const UpdateMachineReq = z.object({ name: z.string().trim().max(64) })

/*
 * Agent tools and providers of a machine (owner only, relayed live to its daemon; nothing is stored server-side).
 * Offline → 409 「机器离线」; a daemon without the feature → 409 「请先升级该机器的 daemon」.
 *   GET    /api/machines/:id/tools                          → ToolsStateDto
 *   POST   /api/machines/:id/tools/:kind/install  InstallToolReq → ToolOpDto (progress + result over realtime)
 *   POST   /api/machines/:id/tools/:kind/upgrade             → ToolOpDto
 *   PUT    /api/machines/:id/tools/settings   ToolsSettings  → ToolsStateDto
 *   GET    /api/machines/:id/providers                      → ProviderStoreView
 *   GET    /api/machines/:id/providers/presets?agent=        → ProviderPreset[]
 *   POST   /api/machines/:id/providers        SaveProviderReq → ProviderSavedDto
 *   PUT    /api/machines/:id/providers/:pid   SaveProviderReq → ProviderSavedDto
 *   DELETE /api/machines/:id/providers/:pid                 → ProviderStoreView
 *   PUT    /api/machines/:id/providers/default  UseProviderReq → ProviderStoreView
 *   PUT    /api/machines/:id/providers/official OfficialProviderReq → ProviderStoreView
 *   PUT    /api/machines/:id/agent-settings   AgentSettingsReq → ProviderStoreView (machine owner)
 *   POST   /api/machines/:id/providers/import-link ImportLinkReq → ProviderSavedDto
 *   GET    /api/machines/:id/ccswitch                       → CcSwitchPreviewDto
 *   POST   /api/machines/:id/ccswitch/apply   CcSwitchApplyReq → CcSwitchImportedDto
 *   PUT    /api/bots/:id/provider             BotProviderReq  → ProviderStoreView (bot owner who owns its machine)
 *   GET    /api/bots/:id/catalog                            → BotCatalogDto (its owner, sysadmins and its groups' members)
 *   GET    /api/machines/:id/catalog?agent=&provider=       → BotCatalogDto (a new bot's models on that provider)
 *   GET    /api/groups/:id/provider-state                   → GroupProviderStateDto
 */
export const ToolsStateDto = z.object({ tools: z.array(ToolStatus), settings: ToolsSettings })
export type ToolsStateDto = z.infer<typeof ToolsStateDto>
export const InstallToolReq = z.object({ version: z.string().regex(TOOL_VERSION).optional() })
/** A started install / upgrade: its lines arrive as machine.tools.progress, its end as machine.tools.result. */
export const ToolOpDto = z.object({ opId: z.string() })
export type ToolOpDto = z.infer<typeof ToolOpDto>
export const SaveProviderReq = ProviderInput.omit({ id: true }).extend({
  setDefault: z.boolean().default(false),
})
export type SaveProviderReq = z.input<typeof SaveProviderReq>
export const ProviderSavedDto = z.object({ id: z.string(), view: ProviderStoreView })
export type ProviderSavedDto = z.infer<typeof ProviderSavedDto>
/** `choice`: a provider id of `agent` or `official`. */
export const UseProviderReq = z.object({ agent: AgentKind, choice: z.string().min(1) })
export const OfficialProviderReq = OfficialInput.extend({ agent: AgentKind })
export type OfficialProviderReq = z.input<typeof OfficialProviderReq>
export const AgentSettingsReq = AgentSettings.extend({ agent: AgentKind })
export type AgentSettingsReq = z.input<typeof AgentSettingsReq>
/** `choice`: a provider id of the bot's agent, `official` or `inherit`. */
export const BotProviderReq = z.object({ choice: z.string().min(1) })
/** What a new session of the bot may pick: asked live of its machine, else what it reported. */
export const BotCatalogDto = z.object({ catalog: AgentCatalog.nullable() })
export type BotCatalogDto = z.infer<typeof BotCatalogDto>
export const ImportLinkReq = z.object({
  link: z.string().trim().startsWith('ccswitch://').max(16_384),
  setDefault: z.boolean().default(false),
})
export const CcSwitchPreviewDto = z.object({ candidates: z.array(CcSwitchCandidate) })
export type CcSwitchPreviewDto = z.infer<typeof CcSwitchPreviewDto>
export const CcSwitchApplyReq = z.object({
  keys: z.array(z.string()).min(1),
  setDefault: z.boolean().default(false),
})
export const CcSwitchImportedDto = z.object({ imported: z.array(z.string()), view: ProviderStoreView })
export type CcSwitchImportedDto = z.infer<typeof CcSwitchImportedDto>
/** The group's bots whose session keeps an older provider (群聊横条); memory only, empty while their machine is offline. */
export const GroupProviderStateDto = z.object({ items: z.array(ProviderStateItem.omit({ groupId: true })) })
export type GroupProviderStateDto = z.infer<typeof GroupProviderStateDto>

// ── Bots ────────────────────────────────────────────────────────────────────
export const BotBinding = z.enum(['pending_bind', 'pending_confirm', 'bound'])
/** Derived presence shown in UI. */
export const BotPresence = z.enum([
  'pending_bind',
  'pending_confirm',
  'online',
  'running',
  'offline',
  'agent_missing',
])
/** Built-in bot characters: 共字君 (the default) and twelve blended work personalities; art lives in the web app. */
export const BOT_AVATARS = [
  'role-gong',
  'role-hammock',
  'role-braces',
  'role-focus',
  'role-steps',
  'role-blank',
  'role-no',
  'role-abacus',
  'role-invert',
  'role-sentry',
  'role-spring',
  'role-compass',
  'role-loop',
] as const
export const BotAvatar = z.enum(BOT_AVATARS)
export type BotAvatar = z.infer<typeof BotAvatar>

export const BotDto = z.object({
  id: z.string(),
  teamId: z.string(),
  name: z.string(),
  ownerId: z.string(),
  ownerName: z.string(),
  agentKind: AgentKind,
  avatar: BotAvatar,
  /** Uploaded image shown instead of the role's face; null = the role. */
  avatarUrl: z.string().nullable(),
  machineId: z.string().nullable(),
  machineName: z.string().nullable(),
  binding: BotBinding,
  presence: BotPresence,
  systemPrompt: z.string(),
  tier: Tier,
  triggerScope: TriggerScope,
  triggerList: z.array(z.string()),
  concurrency: z.number().int(),
  createdBy: z.string(),
  /** Version of this agent kind last reported by the bound machine. */
  agentVersion: z.string().nullable(),
  /** The adapter's minimum for that CLI; `agentVersion` below it gets a warning. */
  agentMinVersion: z.string().nullable(),
  groupCount: z.number().int(),
  /** Owner's directory the bot works in when a group has no binding of its own (plan W1). */
  defaultWorkspace: z.string().nullable(),
  /** Default model and thought level; null = the adapter's default. */
  model: z.string().nullable(),
  effort: z.string().nullable(),
  /** What the bound machine's adapter offers; null until probed (or without a machine). */
  catalog: AgentCatalog.nullable(),
  approval: Approval,
  allowlist: z.array(z.string()),
  /** Rules from 始终允许 (see RunStart.bot.alwaysAllow). */
  alwaysAllow: z.array(z.string()),
  /** Git commit identity; null = the bot name / `gitDefaultEmail`. */
  gitName: z.string().nullable(),
  gitEmail: z.string().nullable(),
  gitDefaultEmail: z.string(),
  /** Overrides of `botOverride` agent settings (field id → value); empty = the machine's defaults. */
  agentSettings: AgentSettingValues,
  /** Members the owner shared the bot with: each may DM it (in a managed workspace of its own) and see its details. */
  sharedWith: z.array(z.string()),
})
export type BotDto = z.infer<typeof BotDto>
/** GET /api/daemon/bots (machine token): a machine serves bots of several teams, so each names its own (plan D20). */
export const DaemonBotDto = BotDto.extend({ teamName: z.string() })
export type DaemonBotDto = z.infer<typeof DaemonBotDto>

/** GET /api/machines/:id/dirs?path= — a machine's directories for the workspace picker (its owner only). */
export const DirListingDto = z.object({
  path: z.string(),
  entries: z.array(z.object({ name: z.string(), git: z.boolean() })),
  git: z.object({ root: z.string(), remotes: z.array(z.string()), branch: z.string().nullable() }).nullable(),
  /** Why `path` cannot be a workspace; null = selectable. */
  unusable: z.string().nullable(),
  /** Filesystem roots of the machine (Windows drives, `/` elsewhere). */
  roots: z.array(z.string()),
})
export type DirListingDto = z.infer<typeof DirListingDto>
/** PUT /api/bots/:id/default-workspace; null clears it. */
export const DefaultWorkspaceReq = z.object({ path: z.string().min(1).nullable() })
/** PUT /api/groups/:id/bots/:botId/workspace (bot owner): a local directory, or null = managed workspace. */
export const BindWorkspaceReq = z.object({
  path: z.string().min(1).nullable(),
  /** Bind even if `path` is not a work tree of the group repo (the owner confirmed the warning). */
  force: z.boolean().optional(),
})
/** GET /api/groups/:id/bots/:botId/diff?scope=&runId= — a bot workspace's changes (group members). */
export const WorkspaceDiffDto = z.object({
  scope: DiffScope,
  /** Unified patch, null when nothing changed. */
  patch: z.string().nullable(),
  /** Main branch compared against (scope base); null when HEAD is on it. */
  base: z.string().nullable(),
  branch: z.string().nullable(),
  /** Repos the patch spans; the web groups files by the longest matching `path`. */
  repos: z.array(DiffRepo),
})
export type WorkspaceDiffDto = z.infer<typeof WorkspaceDiffDto>
/**
 * Files browser (group members, read-only; `path` relative to the workspace root, '' = the root):
 * GET /api/groups/:id/bots/:botId/files/tree?path=&ignored=1 — one directory level.
 */
export const FilesTreeDto = z.object({
  path: z.string(),
  entries: z.array(FileTreeEntry),
  truncated: z.boolean(),
})
export type FilesTreeDto = z.infer<typeof FilesTreeDto>
/** GET …/files/find?name= — workspace paths named `name` (see FilesFind); empty when none. */
export const FilesFindDto = z.object({ paths: z.array(z.string()) })
export type FilesFindDto = z.infer<typeof FilesFindDto>
/** GET …/files/text?path= — `text` null when binary or over FILE_TEXT_MAX_BYTES. */
export const FileTextDto = z.object({
  path: z.string(),
  size: z.number().int(),
  binary: z.boolean(),
  mime: z.string(),
  text: z.string().nullable(),
})
export type FileTextDto = z.infer<typeof FileTextDto>
// ── Manual git (plan Git增强, docs/plan/Git管理-IDEA对标-开发计划.md) ─────────────────────────────────────────────
// Reads (any member): GET /api/groups/:id/bots/:botId/git/{refs,log,show,tree,text,compare,diff,changes,blame,stashes,
// conflict}. Writes: POST …/git/actions — the bot owner's run at once; anyone else's wait for the owner's approval.
// Partition groups with a repo only; writes are refused with 409 while a run of the bot (or of a bot sharing its
// directory) is live. Anything beyond what a daemon supports (see DaemonFeature gitOps3) is refused with 409.
/** Which repo of the workspace (see GitStatus.repos `path`); omitted = the root repo. */
const gitRepoPath = z.string().min(1).max(4096).optional()
/** A query flag: 1 / true. */
const queryFlag = z
  .enum(['0', '1', 'false', 'true'])
  .transform((v) => v === '1' || v === 'true')
  .optional()
/** A branch, tag, commit or rev expression (`main..feat`, `stash@{0}^1`); never an option (`-x`) nor spaced. */
const hasControl = (s: string) => [...s].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f)
const gitRev = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((s) => !s.startsWith('-') && !/\s/.test(s) && !hasControl(s), '无效的修订')
/**
 * A short branch or tag name as `git check-ref-format --branch` takes it, never `HEAD` nor `refs/…`: nothing a refspec
 * would read as more (`+a:b`, `:b`, `HEAD`), so a push or delete only ever names the branch it says.
 */
export function isGitRefName(s: string) {
  return (
    s !== 'HEAD' &&
    s !== '@' &&
    !s.startsWith('refs/') &&
    !/^[-+/]/.test(s) &&
    !/[/.]$/.test(s) &&
    !/[ ~^:?*[\\]/.test(s) &&
    !hasControl(s) &&
    !s.includes('..') &&
    !s.includes('@{') &&
    s.split('/').every((p) => p !== '' && !p.startsWith('.') && !p.endsWith('.lock'))
  )
}
const gitRefName = z.string().trim().min(1).max(255).refine(isGitRefName, '无效的分支或标签名')
/** A configured remote's name (`origin`), never a URL or a path. */
const gitRemoteName = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][\w.-]{0,99}$/, '无效的远程名称')
/** A full or abbreviated object name. */
const gitHash = z.string().regex(/^[0-9a-f]{4,64}$/)
/** GET …/git/refs?repo= */
export const GitRefsQuery = z.object({ repo: gitRepoPath })
/** GET …/git/refs — `tags` and `recent` stay empty from daemons without gitOps3. */
export const GitRefsDto = z.object({
  branches: z.array(GitBranch),
  remotes: z.array(GitRemote),
  tags: z.array(GitTag),
  recent: z.array(z.string()),
})
export type GitRefsDto = z.infer<typeof GitRefsDto>
/** GET …/git/log?ref=&skip=&repo= plus the filters of GitLogFilter (flags as 1). */
export const GitLogQuery = z.object({
  repo: gitRepoPath,
  ref: z.string().min(1).max(255).optional(),
  skip: z.coerce.number().int().min(0).default(0),
  all: queryFlag,
  author: z.string().trim().min(1).max(255).optional(),
  text: z.string().trim().min(1).max(255).optional(),
  regexp: queryFlag,
  matchCase: queryFlag,
  since: z.iso.date().optional(),
  until: z.iso.date().optional(),
  path: z.string().min(1).max(4096).optional(),
  firstParent: queryFlag,
  noMerges: queryFlag,
  order: z.enum(['date', 'topo']).optional(),
})
export type GitLogQuery = z.infer<typeof GitLogQuery>
export const GitLogDto = z.object({ commits: z.array(GitCommit), hasMore: z.boolean() })
export type GitLogDto = z.infer<typeof GitLogDto>
/** GET …/git/show?commit=&repo= */
export const GitShowQuery = z.object({ repo: gitRepoPath, commit: gitRev })
export const GitShowDto = z.object({
  commit: GitCommit,
  body: z.string(),
  committer: z.string(),
  committerEmail: z.string(),
  committedAt: z.string(),
  branches: z.array(z.string()),
})
export type GitShowDto = z.infer<typeof GitShowDto>
/** GET …/git/tree?ref=&path=&repo= answers FilesTreeDto; GET …/git/text?ref=&path=&repo= answers FileTextDto. */
export const GitRefPathQuery = z.object({
  repo: gitRepoPath,
  ref: z.string().min(1).max(255),
  path: z.string().default(''),
})
/** GET …/git/compare?from=&to=&repo= — `to` omitted = the work tree. */
export const GitCompareQuery = z.object({
  repo: gitRepoPath,
  from: z.string().min(1).max(255),
  to: z.string().min(1).max(255).optional(),
})
export const GitCompareDto = z.object({ changes: z.array(GitChange) })
export type GitCompareDto = z.infer<typeof GitCompareDto>
/**
 * GET …/git/diff?from=&to=&path=&repo=&ignoreWhitespace=&context= — the unified patch (see GitDiff); `to` omitted =
 * the work tree, `path` = one file.
 */
export const GitDiffQuery = z.object({
  repo: gitRepoPath,
  from: z.string().min(1).max(255),
  to: z.string().min(1).max(255).optional(),
  path: z.string().min(1).max(4096).optional(),
  ignoreWhitespace: queryFlag,
  context: z.coerce.number().int().min(0).max(1_000_000).optional(),
})
export const GitDiffDto = z.object({ patch: z.string().nullable(), truncated: z.boolean() })
export type GitDiffDto = z.infer<typeof GitDiffDto>
/** GET …/git/changes?repo= */
export const GitChangesQuery = z.object({ repo: gitRepoPath })
/**
 * The work tree's changes for the commit view. `limited`: the daemon predates gitOps3, so this is its plain compare
 * against HEAD (no untracked flags, line counts, conflicts or HEAD commit).
 */
export const GitChangesDto = z.object({
  changes: z.array(GitWorkChange),
  conflicts: z.array(GitConflict),
  ongoing: GitOngoing.nullable(),
  head: GitHeadCommit.nullable(),
  limited: z.boolean(),
})
export type GitChangesDto = z.infer<typeof GitChangesDto>
/** GET …/git/blame?path=&ref=&repo= — `ref` omitted = the work tree. */
export const GitBlameQuery = z.object({
  repo: gitRepoPath,
  ref: z.string().min(1).max(255).optional(),
  path: z.string().min(1).max(4096),
})
export const GitBlameDto = z.object({ ranges: z.array(GitBlameRange), commits: z.array(GitBlameCommit) })
export type GitBlameDto = z.infer<typeof GitBlameDto>
/** GET …/git/stashes?repo= */
export const GitStashesQuery = z.object({ repo: gitRepoPath })
export const GitStashesDto = z.object({ stashes: z.array(GitStash) })
export type GitStashesDto = z.infer<typeof GitStashesDto>
/** GET …/git/conflict?path=&repo= */
export const GitConflictQuery = z.object({ repo: gitRepoPath, path: z.string().min(1).max(4096) })
export const GitConflictDto = z.object({
  base: z.string().nullable(),
  ours: z.string().nullable(),
  theirs: z.string().nullable(),
  merged: z.string().nullable(),
  binary: z.boolean(),
})
export type GitConflictDto = z.infer<typeof GitConflictDto>
/**
 * POST …/git/refresh — any member: re-reads the bot's git status (pushed as a bot state update); `fetch` fetches the
 * remotes first. Not refused while a run is live (it never touches the work tree). Answers 204.
 */
export const GitRefreshReq = z.object({ fetch: z.boolean().default(false) })
export type GitRefreshReq = z.infer<typeof GitRefreshReq>

const gitPaths = z.array(z.string().min(1).max(4096)).max(5000)
const gitMessage = z.string().trim().min(1).max(10_000)
/** Conflict resolutions are written into the work tree as is. */
export const GIT_RESOLVE_MAX_BYTES = 2 * 1024 * 1024
/**
 * POST …/git/actions (see GitAction in the daemon protocol for what each does). `confirmBase`: the owner's second
 * confirmation to push the protected base branch, which is never force-pushed nor deleted on the remote.
 */
export const GitActionReq = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('checkout'),
    repo: gitRepoPath,
    /** A branch (a remote one creates its tracking local one), or with `detach` any revision. */
    branch: gitRev,
    /** A commit or tag: detached HEAD. */
    detach: z.boolean().default(false),
    /** With changes in the way: keep them (git refuses to overwrite), smart (stash and restore) or force (discard). */
    mode: z.enum(['keep', 'smart', 'force']).default('keep'),
  }),
  z.object({
    action: z.literal('pull'),
    repo: gitRepoPath,
    mode: z.enum(['ff-only', 'merge', 'rebase']).default('ff-only'),
    /** A local branch other than the current one: fast-forwarded from its upstream. */
    branch: gitRefName.optional(),
  }),
  z.object({
    action: z.literal('commit'),
    repo: gitRepoPath,
    message: z.string().trim().min(1, '请填写提交说明').max(10_000),
    /** Work-tree-relative paths to commit (as listed by git changes); omitted = every change; [] = none (amend only). */
    paths: gitPaths.optional(),
    amend: z.boolean().default(false),
  }),
  z.object({
    action: z.literal('push'),
    repo: gitRepoPath,
    remote: gitRemoteName.default('origin'),
    /** The local branch pushed. */
    branch: gitRefName,
    /** gitOps4: the branch on the remote it goes to; omitted = its upstream's when on `remote`, else the same name. */
    target: gitRefName.optional(),
    /** Needed when the branch on the remote (`target`) is the protected base branch. */
    confirmBase: z.boolean().default(false),
    /** --force-with-lease; refused for the protected base branch. */
    force: z.boolean().default(false),
    tags: z.boolean().default(false),
  }),
  z.object({
    action: z.literal('branch-create'),
    repo: gitRepoPath,
    name: gitRefName,
    from: gitRev.optional(),
    checkout: z.boolean().default(true),
  }),
  z.object({
    action: z.literal('branch-rename'),
    repo: gitRepoPath,
    branch: gitRefName,
    name: gitRefName,
  }),
  z.object({
    action: z.literal('branch-delete'),
    repo: gitRepoPath,
    /** A remote-tracking `origin/x` deletes x on that remote. */
    branch: gitRefName,
    force: z.boolean().default(false),
  }),
  z.object({
    action: z.literal('merge'),
    repo: gitRepoPath,
    branch: gitRev,
    mode: z.enum(['default', 'no-ff', 'ff-only', 'squash']).default('default'),
    noCommit: z.boolean().default(false),
    message: gitMessage.optional(),
  }),
  z.object({
    action: z.literal('rebase'),
    repo: gitRepoPath,
    onto: gitRev,
    /** Rebase this branch (switched to first) instead of the current one. */
    branch: gitRefName.optional(),
  }),
  z.object({ action: z.literal('cherry-pick'), repo: gitRepoPath, commits: z.array(gitRev).min(1).max(100) }),
  z.object({ action: z.literal('revert'), repo: gitRepoPath, commits: z.array(gitRev).min(1).max(100) }),
  z.object({
    action: z.literal('reset'),
    repo: gitRepoPath,
    commit: gitRev,
    mode: z.enum(['soft', 'mixed', 'hard', 'keep']).default('mixed'),
  }),
  z.object({
    action: z.literal('discard'),
    repo: gitRepoPath,
    paths: gitPaths.min(1),
    /** gitOps4: files added to the index are only unstaged, kept on disk (IDEA: "Delete local copies" unticked). */
    keepAdded: z.boolean().default(false),
  }),
  /** gitOps4: IDEA's Add to VCS — untracked `paths` staged as added. */
  z.object({ action: z.literal('add'), repo: gitRepoPath, paths: gitPaths.min(1) }),
  /** gitOps4: IDEA's Add to .gitignore — `paths` appended to the repo's root .gitignore as `/path`. */
  z.object({ action: z.literal('ignore'), repo: gitRepoPath, paths: gitPaths.min(1) }),
  z.object({
    action: z.literal('stash'),
    repo: gitRepoPath,
    message: z.string().trim().min(1).max(1000).optional(),
    untracked: z.boolean().default(false),
    paths: gitPaths.min(1).optional(),
  }),
  z.object({
    action: z.literal('unstash'),
    repo: gitRepoPath,
    stash: z.number().int().min(0),
    /** gitOps4: the stash's commit as listed; refused when `stash@{n}` is another one by then. */
    expect: gitHash.optional(),
    pop: z.boolean().default(false),
    index: z.boolean().default(false),
    /** Restore it as this new branch (made at the stash's base) instead. */
    branch: gitRefName.optional(),
  }),
  z.object({
    action: z.literal('stash-drop'),
    repo: gitRepoPath,
    /** Omitted = every stash. */
    stash: z.number().int().min(0).optional(),
    /** gitOps4: as unstash's. */
    expect: gitHash.optional(),
  }),
  z.object({
    action: z.literal('tag-create'),
    repo: gitRepoPath,
    name: gitRefName,
    commit: gitRev.optional(),
    /** Makes it an annotated tag. */
    message: gitMessage.optional(),
  }),
  z.object({
    action: z.literal('tag-delete'),
    repo: gitRepoPath,
    name: gitRefName,
    /** Deletes it on this remote too. */
    remote: gitRemoteName.optional(),
  }),
  z.object({
    action: z.literal('tag-push'),
    repo: gitRepoPath,
    name: gitRefName,
    remote: gitRemoteName.default('origin'),
  }),
  z.object({ action: z.literal('continue'), repo: gitRepoPath, message: gitMessage.optional() }),
  z.object({ action: z.literal('abort'), repo: gitRepoPath }),
  z.object({ action: z.literal('skip'), repo: gitRepoPath }),
  z.object({
    action: z.literal('resolve'),
    repo: gitRepoPath,
    path: z.string().min(1).max(4096),
    /** Take one side as is, or write `content`. */
    side: GitConflictPick.optional(),
    content: z.string().max(GIT_RESOLVE_MAX_BYTES).optional(),
  }),
])
export type GitActionReq = z.infer<typeof GitActionReq>
/** What a client sends: the defaults may be left out. */
export type GitActionInput = z.input<typeof GitActionReq>
export const GitOperationStatus = z.enum([
  'pending_approval',
  'running',
  'succeeded',
  'failed',
  'rejected',
  'expired',
])
export type GitOperationStatus = z.infer<typeof GitOperationStatus>
export const GitOperationDto = z.object({
  id: z.string(),
  groupId: z.string(),
  botId: z.string(),
  /** The repo acted on (see GitActionReq); null = the root repo. */
  repo: z.string().nullable(),
  action: GitActionKind,
  branch: z.string().nullable(),
  remote: z.string().nullable(),
  message: z.string().nullable(),
  /** A commit (discard, stash) of these paths only; null = every change. */
  paths: z.array(z.string()).nullable(),
  /** The action's other parameters (see GitActionArgs); null when it has none. */
  args: GitActionArgs.nullable(),
  /** A push of the protected base branch: approving it is the owner's second confirmation. */
  pushesBase: z.boolean(),
  status: GitOperationStatus,
  requestedBy: z.object({ id: z.string(), name: z.string() }),
  decidedBy: z.object({ id: z.string(), name: z.string() }).nullable(),
  /** git's summary on success; why it failed otherwise. */
  output: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  expiresAt: z.string(),
  finishedAt: z.string().nullable(),
})
export type GitOperationDto = z.infer<typeof GitOperationDto>
/** GET /api/groups/:id/git/operations — pending ones plus the latest settled, newest first. */
export const GitOperationsDto = z.object({ operations: z.array(GitOperationDto) })
export type GitOperationsDto = z.infer<typeof GitOperationsDto>
/** POST /api/git-operations/:id/decide — the bot owner only. */
export const DecideGitOperationReq = z.object({ approve: z.boolean() })

/** MIME types `GET …/files/raw?path=` serves inline (Range supported); anything else is a download. */
export const INLINE_FILE_MIMES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/x-icon',
  'image/svg+xml',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'audio/mp4',
  'audio/flac',
  'application/pdf',
] as const
/** PUT /api/groups/:id/bots/:botId/tier (bot owner or sysadmin); null follows the bot's own tier. */
export const GroupBotTierReq = z.object({ tier: Tier.nullable() })
/** PUT /api/groups/:id/bots/:botId/config (bot owner or group admin; anyone in a DM): nulls follow the bot. */
export const GroupBotConfigReq = z.object({ model: z.string().nullable(), effort: z.string().nullable() })
export const EXTRA_DIRS_MAX = 10
/** PUT /api/groups/:id/bots/:botId/extra-dirs (bot owner only): the full list, [] clears it. */
export const GroupBotExtraDirsReq = z.object({
  dirs: z.array(z.string().trim().min(1).max(1024)).max(EXTRA_DIRS_MAX),
})

/** GET /api/bots/owners: who the caller may create bots for, with their machines (self only for members). */
export const BotOwnerDto = z.object({ id: z.string(), name: z.string(), machines: z.array(MachineDto) })
export type BotOwnerDto = z.infer<typeof BotOwnerDto>

export const CreateBotReq = z.object({
  name: z.string().min(1).max(40),
  ownerId: z.string(),
  agentKind: AgentKind,
  /** Omit when the owner has no machine yet (bot becomes pending_bind). */
  machineId: z.string().nullable(),
  systemPrompt: z.string().max(4000).default(''),
  avatar: BotAvatar.default('role-gong'),
  model: z.string().nullable().default(null),
  effort: z.string().nullable().default(null),
  /** A provider id of `agentKind`, `official` or `inherit` (default); only for one's own bot on one's own machine. */
  provider: z.string().min(1).optional(),
})
export const UpdateBotReq = z.object({
  name: z.string().min(1).max(40).optional(),
  avatar: BotAvatar.optional(),
  systemPrompt: z.string().max(4000).optional(),
  tier: Tier.optional(),
  triggerScope: TriggerScope.optional(),
  triggerList: z.array(z.string()).optional(),
  concurrency: z.number().int().min(1).max(8).optional(),
  model: z.string().nullable().optional(),
  effort: z.string().nullable().optional(),
  /** Bot owner only. */
  approval: Approval.optional(),
  allowlist: Allowlist.optional(),
  alwaysAllow: Allowlist.optional(),
  /** Bot owner only; null = default. */
  gitName: z.string().trim().min(1).max(80).nullable().optional(),
  gitEmail: z.email().max(200).nullable().optional(),
  /** Bot owner only; replaces the overrides (only `botOverride` fields of the bot's agent kind). */
  agentSettings: AgentSettingValues.optional(),
})
/** POST /api/bots/:id/share-requests: a member asks the owner to share the bot with them. */
export const BotShareRequestReq = z.object({ reason: z.string().trim().max(200).default('') })
/** A pending 申请共享 (GET /api/bots/:id/share-requests: all of them for the owner, only one's own otherwise). */
export const BotShareRequestDto = z.object({
  id: z.string(),
  botId: z.string(),
  userId: z.string(),
  userName: z.string(),
  reason: z.string(),
  createdAt: z.string(),
})
export type BotShareRequestDto = z.infer<typeof BotShareRequestDto>
/** POST /api/share-requests/:id/approve: the DM opened for the requester. */
export const ShareApprovedDto = z.object({ groupId: z.string() })
export type ShareApprovedDto = z.infer<typeof ShareApprovedDto>
/** PUT /api/bots/:id/shares (owner or sysadmin): the full list of members the bot is shared with. */
export const BotSharesReq = z.object({ userIds: z.array(z.string()).max(200) })

// ── Notifications ───────────────────────────────────────────────────────────
export const NotificationType = z.enum([
  'approval',
  'question',
  'offline_expired',
  'chain_done',
  'bot_confirm',
  'bot_shared',
  'repo_access',
  'schedule_paused',
  'sync_drift',
  'sync_conflict',
  'mention',
  'bot_share_request',
  'bot_share_decided',
  'git_operation_request',
])
export const NotificationDto = z.object({
  id: z.string(),
  /** null for platform-level notices, shown in every team. */
  teamId: z.string().nullable(),
  type: NotificationType,
  payload: z.record(z.string(), z.unknown()),
  readAt: z.string().nullable(),
  /** The approval / question it asks for was settled (by anyone, a timeout, or the run ending). */
  resolvedAt: z.string().nullable(),
  createdAt: z.string(),
})
export type NotificationDto = z.infer<typeof NotificationDto>
/** GET /api/notifications/unread: the badge, over the list's scope; counting stops at 100 (shown as 99+). */
export const NotificationUnreadDto = z.object({ n: z.number().int() })
export type NotificationUnreadDto = z.infer<typeof NotificationUnreadDto>

/** Also sent as browser push, only to the people who can act (spec §8.11); others stay in the in-app center. */
export const PUSHED_NOTIFICATION_TYPES: readonly NotificationDto['type'][] = [
  'approval',
  'question',
  'offline_expired',
  'chain_done',
  'mention',
  'bot_share_request',
  'bot_share_decided',
  'git_operation_request',
]
export const PushKeyDto = z.object({ publicKey: z.string() })
export const PushSubscriptionReq = z.object({
  endpoint: z.url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
})
export type PushSubscriptionReq = z.infer<typeof PushSubscriptionReq>

// ── Groups ──────────────────────────────────────────────────────────────────
export const GroupKind = z.enum(['group', 'dm'])
export const GroupDto = z.object({
  id: z.string(),
  teamId: z.string(),
  name: z.string(),
  kind: GroupKind,
  /** Uploaded image; null = tiled from the members (a DM shows its bot). */
  avatar: z.string().nullable(),
  mode: z.enum(['partition', 'force']),
  /** Only group admins may invite people; members always may pull in their own bots. */
  adminOnlyInvite: z.boolean(),
  /** 禁止直推基准分支: agents commit on feature branches; pushing to the base branch asks the bot owner. */
  protectBase: z.boolean(),
  notice: z.string(),
  /** The caller closed the current notice for themselves; a newer notice shows again. */
  noticeHidden: z.boolean(),
  repo: z.object({ url: z.string(), branch: z.string() }).nullable(),
  members: z.array(
    z.object({ userId: z.string(), name: z.string(), avatar: z.string().nullable(), isAdmin: z.boolean() }),
  ),
  botIds: z.array(z.string()),
  unread: z.number().int(),
  /** An unread message @s the caller ([有人@我]); always sent by the server. */
  mentioned: z.boolean().optional(),
  lastSeq: z.number().int(),
  /** One-line preview of the latest message, '' when empty. */
  last: z.string(),
  /** `last`'s translatable source for recall notes and events; `last` holds its Chinese rendering. */
  lastI18n: I18nText.optional(),
  /** When the latest message was posted, else when the group was created: the list's order. Always sent by the server. */
  lastAt: z.string().optional(),
  /** The requesting user's own prefs. */
  pinned: z.boolean(),
  /** 完成: the caller marked it done up to this seq; done while `lastSeq` has not passed it. Always sent by the server. */
  doneSeq: z.number().int().nullable().optional(),
  /** 标记 by the caller; always sent by the server. */
  flagged: z.boolean().optional(),
  muted: z.boolean(),
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
})
export const GroupMemberReq = z.object({ userIds: z.array(z.string()).min(1).max(200) })
export const GroupBotReq = z.object({ botId: z.string() })
/** Moves the read cursor forward; omit `seq` to mark everything read. */
export const MarkReadReq = z.object({ seq: z.number().int().min(0).optional() })
export const RepoReq = z.object({ url: z.string(), branch: z.string() })

// ── Repos (team-wide history, access probes) ────────────────────────────────
export const RepoDto = z.object({
  id: z.string(),
  /** repoKey: `host/path`, lowercase. */
  key: z.string(),
  /** Latest URL used, credentials removed. */
  url: z.string(),
  name: z.string(),
  lastBranch: z.string().nullable(),
  lastUsedAt: z.string(),
  /** Groups currently bound to it. */
  groups: z.number().int(),
  /** The caller has used it (sorted first). */
  mine: z.boolean(),
  /** Directories holding it on the caller's machines. */
  localPaths: z.array(z.object({ machineId: z.string(), path: z.string() })),
})
export type RepoDto = z.infer<typeof RepoDto>

/** POST /api/repos/probe: each bot's machine tries the repo with its own credentials. */
export const RepoProbeReq = z.object({
  url: z.string(),
  branch: z.string(),
  /** Empty → the caller's own online bots (only to learn the branches). */
  botIds: z.array(z.string()).default([]),
})
export const BotProbeDto = z.object({
  botId: z.string(),
  ok: z.boolean(),
  /** offline = not checked; the bot is verified when its machine comes back. */
  reason: z.union([RepoAccessReason, z.literal('offline')]).nullable(),
  usedUrl: z.string().nullable(),
  detail: z.string().nullable(),
})
export type BotProbeDto = z.infer<typeof BotProbeDto>
export const RepoProbeRes = z.object({
  results: z.array(BotProbeDto),
  /** From the first machine that could read the repo; null when none could. */
  defaultBranch: z.string().nullable(),
  branches: z.array(z.string()),
})
export type RepoProbeRes = z.infer<typeof RepoProbeRes>

// ── Git accounts (personal access tokens, repo discovery only) ─────────────
export const GitProvider = z.enum(['github', 'gitlab'])
export type GitProvider = z.infer<typeof GitProvider>
export const GitAccountDto = z.object({
  id: z.string(),
  provider: GitProvider,
  baseUrl: z.string(),
  login: z.string(),
  /** invalid = the provider rejected the token (401); reconnect to fix. */
  status: z.enum(['ok', 'invalid']),
})
export type GitAccountDto = z.infer<typeof GitAccountDto>
/** POST /api/me/git-accounts; baseUrl defaults to https://github.com for GitHub. */
export const AddGitAccountReq = z.object({
  provider: GitProvider,
  baseUrl: z.string().optional(),
  token: z.string().min(1, '请填写 Token'),
})
export const ProviderRepoDto = z.object({
  /** `owner/name`. */
  fullName: z.string(),
  /** Clone URL in the caller's preferred protocol. */
  url: z.string(),
  defaultBranch: z.string().nullable(),
  private: z.boolean(),
})
export type ProviderRepoDto = z.infer<typeof ProviderRepoDto>

// ── Timeline ────────────────────────────────────────────────────────────────
/** Fixed set of emoji reactions, in display order. */
export const REACTION_EMOJIS = ['👍', '✅', '👀', '🎉', '❤️', '😂'] as const
export const ReactionEmoji = z.enum(REACTION_EMOJIS)
export type ReactionEmoji = z.infer<typeof ReactionEmoji>
/** One emoji's aggregate on a message, from the viewer's perspective; `users`: reactors, oldest first. */
export const ReactionDto = z.object({
  emoji: ReactionEmoji,
  count: z.number().int().positive(),
  mine: z.boolean(),
  users: z.array(z.object({ id: z.string(), name: z.string() })),
})
export type ReactionDto = z.infer<typeof ReactionDto>
/** PUT | DELETE /api/messages/:id/reactions/:emoji — the message's reactions after the change. */
export const ReactionsDto = z.object({
  groupId: z.string(),
  messageId: z.string(),
  reactions: z.array(ReactionDto),
})
export type ReactionsDto = z.infer<typeof ReactionsDto>

/** A 填写密钥 card: `userId` (the run's originator) fills `keys` of MCP server `name`. */
export const McpSecretCard = z.object({
  id: z.string(),
  name: z.string(),
  keys: z.array(z.string()),
  userId: z.string(),
  filled: z.boolean(),
})
export type McpSecretCard = z.infer<typeof McpSecretCard>
/** 消息置顶: any member pins or unpins; at most this many per group; a recalled message is unpinned. */
export const MAX_PINS = 5
export const PinnedMessageDto = z.object({
  messageId: z.string(),
  seq: z.number().int(),
  authorName: z.string(),
  /** The message text, cut to a line for the banner ('' when it carries only attachments). */
  text: z.string(),
  attachments: z.number().int(),
  pinnedBy: z.object({ id: z.string(), name: z.string() }),
  pinnedAt: z.string(),
})
export type PinnedMessageDto = z.infer<typeof PinnedMessageDto>
/** GET /api/groups/:id/pins (newest pin first); POST …/pins {messageId}; DELETE …/pins/:messageId. */
export const GroupPinsDto = z.object({ pins: z.array(PinnedMessageDto) })
export type GroupPinsDto = z.infer<typeof GroupPinsDto>

/** 群标签栏 (docs/plan/群标签栏-设计.md): shared tabs under the group header; any member edits them. */
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
export const PinMessageReq = z.object({ messageId: z.string().uuid() })

/** A stage of a progress card. */
export const ProgressStageStatus = z.enum(['pending', 'running', 'done', 'failed', 'skipped'])
export type ProgressStageStatus = z.infer<typeof ProgressStageStatus>
export const ProgressStage = z.object({ name: z.string().min(1).max(40), status: ProgressStageStatus })
export type ProgressStage = z.infer<typeof ProgressStage>
/** A bot's live progress card (progress_card), e.g. a build and deploy; `id` is its message id. */
export const ProgressCard = z.object({
  id: z.string(),
  botId: z.string(),
  title: z.string(),
  stages: z.array(ProgressStage),
  percent: z.number().int().min(0).max(100).nullable(),
  detail: z.string().nullable(),
  link: z.object({ label: z.string(), url: z.string() }).nullable(),
  /** From the stages: failed if one failed, done once all are done or skipped, else running. */
  status: z.enum(['running', 'done', 'failed']),
  updatedAt: z.string(),
})
export type ProgressCard = z.infer<typeof ProgressCard>
export const MessageDto = z.object({
  id: z.string(),
  seq: z.number().int(),
  groupId: z.string(),
  kind: z.enum(['user', 'bot', 'event']),
  authorId: z.string().nullable(),
  authorName: z.string(),
  body: z.string(),
  /** Bot ids this message triggers (explicit @; a quote only adds context). */
  mentions: z.array(z.string()),
  /** Member ids it @s (被 @ notifications); always sent by the server. */
  userMentions: z.array(z.string()).optional(),
  runId: z.string().nullable(),
  createdAt: z.string(),
  attachments: z.array(Attachment),
  quote: z
    .object({ kind: z.enum(['message', 'run']), id: z.string(), who: z.string(), text: z.string() })
    .nullable(),
  /** Ordered by first reaction; always sent by the server (optional only for older clients' literals). */
  reactions: z.array(ReactionDto).optional(),
  /** Recalled by its author: body, attachments, quote, mentions and reactions are blanked. Always sent by the server. */
  recalled: z.boolean().optional(),
  /** Came in from the bound Feishu chat; `authorId` is null when the sender has no 共工 account in the group. */
  fromFeishu: z.boolean().optional(),
  /** Last edit by its author; null/absent when never edited. */
  editedAt: z.string().nullable().optional(),
  /** A bot's preview card; its live state is in the group's preview list (group.previews). */
  previewId: z.string().nullable().optional(),
  /** A scheduled task's card; its live state is in the group's schedule list (group.schedules). */
  scheduleId: z.string().nullable().optional(),
  /** Posted by this scheduled task when it fired (in its owner's name). */
  scheduledBy: z.string().nullable().optional(),
  /** An event's translatable source; `body` holds its Chinese rendering. */
  i18n: I18nText.optional(),
  /** A force-sync conflict card (F11): the held change and whose replica it is. */
  syncConflict: z.object({ id: z.string(), botId: z.string() }).nullable().optional(),
  /** Legacy 填写密钥 card for an MCP server (before secrets); rendered read-only. */
  mcpSecret: McpSecretCard.optional(),
  /** A bot's 填写密钥 card (secret_request). */
  secretCard: SecretCard.optional(),
  /** A bot's progress card (progress_card), updated in place. */
  progress: ProgressCard.optional(),
  /** A bot reply's answered ```actions blocks, by block id (plan 富交互消息). */
  actions: z.record(z.string(), ActionAnswer).optional(),
  /** Generic card (plan 插件体系-方案); unknown kinds are shown as the body. */
  card: MessageCard.optional(),
})
export type MessageDto = z.infer<typeof MessageDto>

// ── Previews (plan 结果预览) ─────────────────────────────────────────────────
export const PreviewKind = z.enum(['http', 'static', 'gui', 'miniprogram'])
export const PreviewDto = z.object({
  id: z.string(),
  groupId: z.string(),
  groupName: z.string(),
  botId: z.string(),
  botName: z.string(),
  kind: PreviewKind,
  title: z.string(),
  path: z.string(),
  serviceId: z.string().nullable(),
  serviceName: z.string().nullable(),
  /** The loopback port it tunnels to; null for a static site. */
  port: z.number().int().nullable(),
  /** Its first-screen PNG (GET /api/previews/:id/snapshot) was taken then; null until the machine managed one. */
  snapshotAt: z.string().nullable(),
  /** online = its machine's tunnel is up; stopped = the service behind it is not running (启动 brings it back). */
  status: z.enum(['online', 'offline', 'stopped']),
  /**
   * login = a mini program whose machine's WeChat devtools nobody is logged in to: its snapshot is their login QR
   * code, served to managers only; the card turns into the simulator once scanned.
   */
  awaiting: z.enum(['login']).nullable(),
  /** Why the machine could not take the last snapshot, until one works. */
  snapshotError: z.string().nullable(),
  /** Its machine's gg-cast while someone watches a live preview (`gui`, `miniprogram`); null otherwise. */
  live: z
    .object({
      state: z.enum(['starting', 'live', 'failed']),
      error: z.string().nullable(),
      missing: z.array(Permission),
      devtools: DevtoolsBlocker.optional(),
      /** When a failed one is tried again (the machine's retryIn); 立即重试 = POST /api/previews/:id/live/retry. */
      retryAt: z.string().optional(),
    })
    .nullable(),
  /**
   * Remote control of a live preview (plan P14): at most one member controls; members ask, the bot owner or a group
   * admin approves (or takes over). Null for previews without a live view.
   */
  control: z
    .object({
      controller: z.object({ id: z.string(), name: z.string() }).nullable(),
      requests: z.array(z.object({ id: z.string(), name: z.string() })),
    })
    .nullable(),
  /** The bot owner and group admins may close it and share it publicly. */
  canManage: z.boolean(),
  createdAt: z.string(),
})
export type PreviewDto = z.infer<typeof PreviewDto>
export const ServiceDto = z.object({
  id: z.string(),
  groupId: z.string(),
  groupName: z.string(),
  botId: z.string(),
  botName: z.string(),
  name: z.string(),
  command: z.string(),
  cwd: z.string(),
  port: z.number().int().nullable(),
  status: z.enum(['starting', 'running', 'exited', 'failed']),
  canManage: z.boolean(),
  createdAt: z.string(),
})
export type ServiceDto = z.infer<typeof ServiceDto>
/**
 * GET /api/groups/:id/previews: open previews and live services. 打开 = GET /api/previews/:id/open?path= (also the
 * iframe src); POST /api/previews/:id/close and /api/services/:id/stop → 204 (bot owner or group admin);
 * POST /api/previews/:id/snapshot → 204 retakes the first screen (same people; 409 with the machine's reason).
 * POST /api/previews/:id/start → 204 reopens a closed preview and restarts its stopped service as it was started
 * (same people; 409 with the machine's reason).
 * Machine token (desktop app): GET /api/daemon/previews → the machine's own; POST /api/daemon/previews/:id/close
 * (ClosePreviewReq) and /api/daemon/services/:id/stop → 204.
 */
export const GroupPreviewsDto = z.object({
  previews: z.array(PreviewDto),
  services: z.array(ServiceDto),
  /** Bots whose previews this user may manage, closed ones included (their cards offer 启动). */
  manageableBotIds: z.array(z.string()),
})
export type GroupPreviewsDto = z.infer<typeof GroupPreviewsDto>
/** Close body: `stopService` also stops the service behind the preview (409 when its machine is offline). */
export const ClosePreviewReq = z.object({ stopService: z.boolean().optional() })

/**
 * Live view of a `gui` or `miniprogram` preview through LiveKit (plan P12–P14), room = preview id.
 * POST /api/previews/:id/live (members) → a viewer token for this connection. `url` null: the server's own
 * `/livekit` (ws(s)://<its host>/livekit), else an external LiveKit.
 */
export const LiveTokenDto = z.object({ url: z.string().nullable(), token: z.string(), identity: z.string() })
export type LiveTokenDto = z.infer<typeof LiveTokenDto>
/**
 * POST /api/previews/:id/watch (members) → 204: someone is watching; the machine publishes while a viewer renewed
 * within `LIVE_WATCH_SECONDS`, at the highest frame rate its viewers ask for (`LIVE_DEFAULT_FPS` when none does).
 */
export const LIVE_WATCH_SECONDS = 60
export const LIVE_FPS = [30, 60, 90] as const
export type LiveFps = (typeof LIVE_FPS)[number]
export const LIVE_DEFAULT_FPS: LiveFps = 30
export const WatchReq = z.object({ fps: z.union([z.literal(30), z.literal(60), z.literal(90)]).optional() })
export type WatchReq = z.infer<typeof WatchReq>
/**
 * POST /api/previews/:id/control → 204. Members `request` (managers take control at once) and `release` (give it
 * back, or withdraw their request); managers `grant` / `deny` a request and `revoke` control. Control lapses with the
 * controller's watch lease.
 */
export const ControlReq = z.discriminatedUnion('action', [
  z.object({ action: z.literal('request') }),
  z.object({ action: z.literal('release') }),
  z.object({ action: z.literal('grant'), userId: z.string() }),
  z.object({ action: z.literal('deny'), userId: z.string() }),
  z.object({ action: z.literal('revoke') }),
])
export type ControlReq = z.infer<typeof ControlReq>

/** Keys the controller can press besides typing text (`CastInput` `key`, with a letter or digit for shortcuts). */
export const CAST_KEYS = [
  'Enter',
  'Backspace',
  'Delete',
  'Tab',
  'Escape',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
] as const
const point = { x: z.number().min(0).max(1), y: z.number().min(0).max(1) }
/**
 * The controller's input, as JSON on the LiveKit data channel (topic `input`, to the `cast` participant only); gg-cast
 * replays it on the machine. Points are fractions of the video frame; `wheel` deltas are CSS pixels; `text` is typed
 * as is (IME output included).
 */
export const CastInput = z.discriminatedUnion('t', [
  z.object({ t: z.literal('down'), ...point }),
  z.object({ t: z.literal('move'), ...point }),
  z.object({ t: z.literal('up'), ...point }),
  z.object({ t: z.literal('wheel'), ...point, dx: z.number(), dy: z.number() }),
  z.object({ t: z.literal('text'), text: z.string().min(1).max(1000) }),
  z.object({
    t: z.literal('key'),
    key: z.union([z.enum(CAST_KEYS), z.string().regex(/^[a-z0-9]$/)]),
    mods: z.array(z.enum(['meta', 'ctrl', 'alt', 'shift'])),
  }),
])
export type CastInput = z.infer<typeof CastInput>
export const CAST_INPUT_TOPIC = 'input'

/** POST /api/daemon/previews/:id/cast (machine token, its own preview) → the publisher token for gg-cast. */
export const CastTokenDto = z.object({ url: z.string().nullable(), token: z.string() })
export type CastTokenDto = z.infer<typeof CastTokenDto>

/**
 * Public preview links (plan P8), created by the bot owner or a group admin, always expiring:
 * POST /api/previews/:id/shares → CreatedPreviewShare (the url, with its secret, is shown once);
 * GET /api/previews/:id/shares → PreviewShareDto[]; POST /api/preview-shares/:id/revoke → 204 (managers, sysadmins).
 * Admin console: GET /api/admin/preview-shares → all; PATCH /api/admin/preview-shares/:id → new expiry.
 */
export const PreviewShareDto = z.object({
  id: z.string(),
  previewId: z.string(),
  previewTitle: z.string(),
  groupId: z.string(),
  groupName: z.string(),
  botName: z.string(),
  createdByName: z.string(),
  expiresAt: z.string(),
  revokedAt: z.string().nullable(),
  visitCount: z.number().int(),
  lastVisitAt: z.string().nullable(),
  createdAt: z.string(),
  /** Not revoked, not expired, preview still open. */
  active: z.boolean(),
})
export type PreviewShareDto = z.infer<typeof PreviewShareDto>
export const PREVIEW_SHARE_DEFAULT_DAYS = 7
export const CreatePreviewShareReq = z.object({
  days: z.number().int().min(1).max(365).default(PREVIEW_SHARE_DEFAULT_DAYS),
})
export const CreatedPreviewShare = z.object({ share: PreviewShareDto, url: z.string() })
export type CreatedPreviewShare = z.infer<typeof CreatedPreviewShare>
export const UpdatePreviewShareReq = z.object({ expiresAt: z.iso.datetime() })
/**
 * POST /api/messages/:id/recall (author, own user message, within the window) → the blanked MessageDto.
 * POST /api/messages/:id/hide (author, any time) → 204; hides it from the author only.
 */
export const RECALL_WINDOW_MS = 24 * 3600_000
/** Quote snapshot text of a message that was recalled after being quoted. */
export const RECALLED_QUOTE = '该消息已撤回'
/** PATCH /api/messages/:id (author, own plain user message, within RECALL_WINDOW_MS, same @ targets) → the MessageDto. */
export const EditMessageReq = z.object({ body: z.string().max(20000) })

export const ApprovalDto = z.object({
  id: z.string(),
  runId: z.string(),
  title: z.string(),
  toolKind: z.string(),
  detail: z.string(),
  options: z.array(PermissionOption),
  /** What 始终允许 would add to the bot's alwaysAllow. */
  remember: z.array(z.string()),
  /** expired = auto-rejected on timeout; void = the run ended/stopped first. */
  status: z.enum(['pending', 'approved', 'rejected', 'expired', 'void']),
  /** Why a request became void: the run was stopped, its relay chain was stopped, or the run ended first. */
  voidReason: z.enum(['stopped', 'chain_stopped', 'ended']).nullable(),
  decidedBy: z.string().nullable(),
  decidedByName: z.string().nullable(),
  decidedAt: z.string().nullable(),
  expiresAt: z.string(),
  createdAt: z.string(),
})
export type ApprovalDto = z.infer<typeof ApprovalDto>

export const DecideApprovalReq = z.object({ optionId: z.string() })
/** POST /api/runs/:id/interrupt — partition /stop leftovers (plan D7). */
export const InterruptChoiceReq = z.object({ choice: z.enum(['keep', 'discard']) })
/** POST /api/runs/:id/stop | stop-chain — how many unfinished runs were stopped. */
export const StopRes = z.object({ stopped: z.number().int() })
/** Answer to POST /api/messages/:id/branch: the new private chat with the bot. */
export const BranchMessageRes = z.object({ groupId: z.string() })
export type BranchMessageRes = z.infer<typeof BranchMessageRes>
export type StopRes = z.infer<typeof StopRes>
/** Whether the stop reached the bot's machine; the task's end then shows in the run process. */
export const TaskStopRes = z.object({ sent: z.boolean() })
export type TaskStopRes = z.infer<typeof TaskStopRes>

export const QuestionSetDto = z.object({
  id: z.string(),
  runId: z.string(),
  questions: z.array(Question),
  status: z.enum(['pending', 'answered', 'expired', 'void']),
  answers: z.array(Answer).nullable(),
  attachments: z.array(Attachment),
  answeredBy: z.string().nullable(),
  answeredByName: z.string().nullable(),
  answeredAt: z.string().nullable(),
  expiresAt: z.string(),
  createdAt: z.string(),
  /** 倾向: members' leanings while pending, for reference only (not votes); the answerer still decides. */
  leanings: z
    .array(
      z.object({ questionId: z.string(), choice: z.number().int(), userId: z.string(), name: z.string() }),
    )
    .default([]),
})
export type QuestionSetDto = z.infer<typeof QuestionSetDto>
/** POST /api/runs/:runId/questions/:setId/leanings — toggles the caller's leaning on one option. */
export const LeanReq = z.object({ questionId: z.string(), choice: z.number().int().min(0) })

export const AnswerQuestionsReq = z.object({
  answers: z.array(Answer),
  attachmentIds: z.array(z.string()).max(MAX_ATTACHMENTS).default([]),
})

export const RunDto = z.object({
  id: z.string(),
  groupId: z.string(),
  botId: z.string(),
  triggerMessageId: z.string(),
  triggerUserId: z.string().nullable(),
  hop: z.number().int(),
  status: RunStatus,
  step: z.string(),
  /** `step`'s translatable source when the server wrote it; `step` holds its Chinese rendering. */
  stepI18n: I18nText.optional(),
  filesChanged: z.number().int(),
  usage: Usage.nullable(),
  newSessionReason: z.string().nullable(),
  queuedAt: z.string(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  /** Relay chain (spec §4.6): hop 1 = triggered by a human; hopMax = the group's chain limit. */
  parentRunId: z.string().nullable(),
  /** The run whose agent went on by itself here once a background task finished (后台任务完成后继续). */
  continuationOf: z.string().nullable().optional(),
  hopMax: z.number().int(),
  /** The group's offline wait (spec §4.8): an offline_wait card expires at queuedAt + this. */
  offlineWaitMin: z.number().int(),
  /** Human whose @ started the chain; every hop is authorized and answerable by them. */
  originUserId: z.string(),
  approvals: z.array(ApprovalDto),
  questions: z.array(QuestionSetDto),
  /** Partition-mode /stop leftovers (plan D7): pending = edits kept, discard still possible. */
  interrupt: z.enum(['pending', 'kept', 'discarded']).nullable(),
  /** Who issued /stop. */
  stoppedBy: z.string().nullable(),
  /** Delegated work of the run for the card: subagents and background tasks still running (may outlive it). */
  delegation: z.object({
    subagents: z.number().int(),
    subagentsRunning: z.number().int(),
    tasksRunning: z.number().int(),
  }),
  /** Model and thought level of the turn: as requested, then as the daemon reported them in effect. */
  model: z.string().nullable(),
  effort: z.string().nullable(),
  /** Force group: how the turn's submit settled (F10, F14); null elsewhere or before run.done. */
  sync: RunSyncDone.nullable().optional(),
  /** Secrets injected into the run, names and sources only. */
  secrets: z.array(RunSecret).optional(),
})
export type RunDto = z.infer<typeof RunDto>

export const TimelineQuery = z.object({
  /** Only messages with a smaller seq (older page). */
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})
/** GET /api/runs/:id[/events]?since=<event id>: the process from that event on, which is included because streamed
 * text extends the latest event in place. */
export const RunDetailQuery = z.object({ since: z.coerce.number().int().positive().optional() })
/** GET /api/runs/:id — card fields plus the full (redacted) process for the side panel. */
export const RunDetailDto = z.object({
  run: RunDto,
  /** null once the full process has been purged by retention (card keeps the summary). */
  patch: z.string().nullable(),
  /** Repos `patch` spans (empty for runs recorded before repos were tracked). */
  patchRepos: z.array(DiffRepo),
  purged: z.boolean(),
  /** The (group, bot) conversation's current agent session. */
  sessionId: z.string().nullable(),
  /** What the run's agent settings came from (session.config); null = codex / not reported. */
  settings: RunSettingsSnapshot.nullable(),
  /** System param runRetentionDays: how long the full process is kept. */
  retentionDays: z.number().int(),
  events: z.array(z.object({ id: z.number().int(), at: z.string(), event: RunEvent })),
})
export type RunDetailDto = z.infer<typeof RunDetailDto>
/** GET /api/runs/:id/events — only the process, for refreshes of an open run (its card arrives by realtime). */
export const RunEventsDto = RunDetailDto.pick({ events: true, purged: true })
export type RunEventsDto = z.infer<typeof RunEventsDto>

/** GET /api/runs/:id/session — earlier rounds of the run's agent session (oldest first), with their trigger text. */
export const RunSessionDto = z.object({ rounds: z.array(z.object({ run: RunDto, prompt: z.string() })) })
export type RunSessionDto = z.infer<typeof RunSessionDto>

export const TimelineDto = z.object({ messages: z.array(MessageDto), runs: z.array(RunDto) })
export type TimelineDto = z.infer<typeof TimelineDto>

export const SendMessageReq = z.object({
  /** May be empty when the message carries attachments. */
  body: z.string().max(20000),
  /** Client-generated idempotency key; resending the same id returns the original message. */
  clientId: z.string().min(8),
  /** Ids from POST /api/uploads. */
  attachmentIds: z.array(z.string()).max(MAX_ATTACHMENTS).default([]),
  /** Quoting a bot's reply or run card only adds context; @ the bot to trigger it (spec §8.6). */
  quote: z
    .object({ kind: z.enum(['message', 'run']), id: z.string() })
    .nullable()
    .default(null),
  /** 打断并追加 into this running run (trigger user or bot owner only). */
  appendTo: z.string().nullable().default(null),
  /** One-shot model / thought level per mentioned bot id (bot owner or group admin; anyone in a DM). */
  runOptions: z.record(z.string(), RunConfigPick).default({}),
})

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
  /** Team skills merged over the platform, team and group layers, as the agents name them. */
  skill: z.array(z.object({ name: z.string(), hint: z.string() })).default([]),
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
  runId: z.string().nullable(),
  /** When the message was sent / the run was queued; null for base-branch files. */
  at: z.string().nullable(),
})
export type SearchResultDto = z.infer<typeof SearchResultDto>

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
})
export type UpdateGroupReq = z.infer<typeof UpdateGroupReq>
/** PUT /api/groups/:id/prefs — only for the caller. */
export const GroupPrefsReq = z
  .object({
    muted: z.boolean(),
    pinned: z.boolean(),
    foldRuns: z.boolean(),
    noticeHidden: z.boolean(),
    /** 完成 up to the latest message, or back to the list. */
    done: z.boolean(),
    flagged: z.boolean(),
  })
  .partial()
export type GroupPrefsReq = z.infer<typeof GroupPrefsReq>

// ── Daemon release (plan D17): PUT /api/admin/daemon-release ─────────────────
export const DaemonBuild = z.object({
  /** Absolute, or server-relative like `/downloads/<file>` (served from GONGGONG_DATA_DIR/downloads). */
  url: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'sha256 需为 64 位十六进制'),
})
export const DaemonRelease = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/, '版本号需为 x.y.z'),
  /** Markdown shown by the desktop updater and the daemon's upgrade prompt; absent on older releases. */
  releaseNotes: z.string().trim().min(1).optional(),
  /** Keyed by `<os>-<arch>` as the daemon reports them, e.g. `macos-aarch64`, `linux-x86_64`. */
  builds: z.record(z.string(), DaemonBuild),
  /** gg-cast (desktop preview publisher) per platform, downloaded by the daemon on its first live preview. */
  cast: z.record(z.string(), DaemonBuild).optional(),
  /** Desktop app installers (Tauri dmg / setup.exe) offered on the 绑定新机器 page. */
  desktop: z.record(z.string(), DaemonBuild).optional(),
  /** Desktop app update packages (macOS `.app.tar.gz`; on Windows the setup.exe in `desktop` is the package). */
  update: z.record(z.string(), DaemonBuild).optional(),
  /** Tauri updater signatures (`.sig`) of the update packages, served in GET /api/desktop-update. */
  signature: z.record(z.string(), DaemonBuild).optional(),
})
export type DaemonRelease = z.infer<typeof DaemonRelease>
export const ReleaseNotesReq = z.object({
  releaseNotes: z.string().trim().min(1, '填写版本说明').max(100_000, '版本说明不能超过 100000 个字符'),
})
export type ReleaseNotesReq = z.infer<typeof ReleaseNotesReq>
export const DaemonReleaseNotesReq = ReleaseNotesReq.extend({
  version: DaemonRelease.shape.version,
})
export type DaemonReleaseNotesReq = z.infer<typeof DaemonReleaseNotesReq>
/** `<os>-<arch>` built by scripts/release.sh. */
export const RELEASE_PLATFORMS = [
  'macos-aarch64',
  'macos-x86_64',
  'linux-x86_64',
  'linux-aarch64',
  'windows-x86_64',
] as const
export const ReleaseKind = z.enum(['builds', 'cast', 'desktop', 'update', 'signature'])
export type ReleaseKind = z.infer<typeof ReleaseKind>
export interface ReleaseFile {
  kind: ReleaseKind
  version: string
  platform: string
}
const RELEASE_FILE =
  /^(gonggong|gg-cast)-(\d+\.\d+\.\d+)-((?:macos|linux)-(?:x86_64|aarch64)|windows-x86_64)(\.exe)?$/
const DESKTOP_FILE =
  /^Gonggong_(\d+\.\d+\.\d+)_(aarch64\.dmg|x86_64\.dmg|x64-setup\.exe(?:\.sig)?|(?:aarch64|x86_64)\.app\.tar\.gz(?:\.sig)?)$/
const DESKTOP_PLATFORM: Record<string, [ReleaseKind, string]> = {
  'aarch64.dmg': ['desktop', 'macos-aarch64'],
  'x86_64.dmg': ['desktop', 'macos-x86_64'],
  'x64-setup.exe': ['desktop', 'windows-x86_64'],
  'x64-setup.exe.sig': ['signature', 'windows-x86_64'],
  'aarch64.app.tar.gz': ['update', 'macos-aarch64'],
  'x86_64.app.tar.gz': ['update', 'macos-x86_64'],
  'aarch64.app.tar.gz.sig': ['signature', 'macos-aarch64'],
  'x86_64.app.tar.gz.sig': ['signature', 'macos-x86_64'],
}
/**
 * POST /api/admin/daemon-release/files takes scripts/release.sh artifacts as named (`gonggong-0.2.0-macos-aarch64`,
 * `gg-cast-0.2.0-windows-x86_64.exe`, `Gonggong_0.2.0_aarch64.dmg`, `Gonggong_0.2.0_aarch64.app.tar.gz(.sig)`): the name
 * alone says what the file is, so admins just drop dist/<version>/.
 */
export function parseReleaseFile(name: string): ReleaseFile | null {
  const [, desktopVersion, bundle] = DESKTOP_FILE.exec(name) ?? []
  const [desktopKind, desktopPlatform] = (bundle && DESKTOP_PLATFORM[bundle]) || []
  if (desktopVersion && desktopKind && desktopPlatform)
    return { kind: desktopKind, version: desktopVersion, platform: desktopPlatform }
  const [, prefix, version, platform, exe] = RELEASE_FILE.exec(name) ?? []
  if (!version || !platform || platform.startsWith('windows') !== Boolean(exe)) return null
  return { kind: prefix === 'gonggong' ? 'builds' : 'cast', version, platform }
}
/** GET /api/client-downloads → installers a member can download, or null before any is published. */
export const ClientDownloads = DaemonRelease.pick({ version: true, builds: true, desktop: true })
export type ClientDownloads = z.infer<typeof ClientDownloads>
/** GET /api/daemon/cast-build (machine token) → gg-cast for its platform; 404 when none is published. */
export const CastBuildDto = z.object({ version: z.string(), url: z.string(), sha256: z.string() })
export type CastBuildDto = z.infer<typeof CastBuildDto>

// ── Audit (spec §9, §13) ────────────────────────────────────────────────────
export const AuditCategory = z.enum(['approval', 'question', 'lock', 'admin', 'run', 'command', 'preview'])
export const AuditQuery = z.object({
  category: AuditCategory.optional(),
  /** 管理后台 filter; the team endpoint sets it itself. */
  teamId: z.string().optional(),
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})
export const AuditDto = z.object({
  id: z.number().int(),
  at: z.string(),
  category: z.string(),
  actorName: z.string().nullable(),
  action: z.string(),
  groupName: z.string().nullable(),
  /** Human-readable one-liner (prototype 审计记录 rows). */
  summary: z.string(),
  detail: z.record(z.string(), z.unknown()),
})
export type AuditDto = z.infer<typeof AuditDto>

// ── Admin console (spec §8.5, §10) ──────────────────────────────────────────
/** Row of 管理后台 · 群 (archived groups included). */
export const AdminGroupDto = z.object({
  id: z.string(),
  name: z.string(),
  ownerName: z.string().nullable(),
  kind: z.enum(['group', 'dm']),
  mode: z.enum(['partition', 'force']),
  repo: z.string().nullable(),
  members: z.number().int(),
  bots: z.number().int(),
  archivedAt: z.string().nullable(),
  teamId: z.string(),
  teamName: z.string(),
})
export type AdminGroupDto = z.infer<typeof AdminGroupDto>
/** Row of 团队设置 · 群 (groups only, no DMs). */
export const TeamGroupDto = AdminGroupDto.extend({
  memberNames: z.array(z.string()),
  /** The viewer is in it; otherwise they may only view it or take it over (plan D19). */
  joined: z.boolean(),
})
export type TeamGroupDto = z.infer<typeof TeamGroupDto>

/** Row of 管理后台 · 机器与网络. */
export const AdminMachineDto = MachineDto.extend({
  ownerName: z.string(),
  protocol: z.number().int().nullable(),
  /** Last `gg net` / desktop 测量延迟与带宽 report (spec §8.5: network quality records, admin-only). */
  latencyMs: z.number().nullable(),
  bandwidthMbps: z.number().nullable(),
  netMeasuredAt: z.string().nullable(),
})
export type AdminMachineDto = z.infer<typeof AdminMachineDto>

/** System-wide defaults editable by the sysadmin (spec §10); group params override the group-level ones. */
export const SystemParams = GroupParams.extend({
  sessionReplayTokens: z.number().int().min(1000).max(100000),
  contextInlineTokens: z.number().int().min(1000).max(100000),
  runRetentionDays: z.number().int().min(1).max(3650),
  attachmentMaxMb: z
    .number()
    .int()
    .min(1)
    .max(MAX_ATTACHMENT_BYTES / 1024 / 1024),
  attachmentsPerMessage: z.number().int().min(1).max(MAX_ATTACHMENTS),
  questionsPerCard: z.number().int().min(1).max(MAX_QUESTIONS),
  heartbeatSec: z.number().int().min(5).max(120),
  offlineMisses: z.number().int().min(2).max(10),
  botConcurrencyDefault: z.number().int().min(1).max(10),
  backupRetentionDays: z.number().int().min(1).max(365),
  archiveRetentionDays: z.number().int().min(1).max(365),
  /** Anyone may create a member account from the login page. */
  registrationOpen: z.boolean(),
  /** Previews nobody opened for this long are closed and their services stopped (plan P11). */
  previewIdleHours: z.number().int().min(1).max(720),
  /** Longest a public preview link may stay valid (plan P8). */
  previewShareMaxDays: z.number().int().min(1).max(365),
  /** One team only: no team switcher, new accounts join the default team (plan D10, D11). */
  singleTeamMode: z.boolean(),
  /** Who may create teams. */
  teamCreation: z.enum(['all', 'sysadmin']),
  /** First 飞书登录 may create an account (only the enterprise's own members can authorize the main app). */
  feishuAutoSignup: z.boolean(),
  /** How browsers reach this server (OAuth redirect, links in Feishu cards); '' = not set. */
  publicUrl: z.union([z.literal(''), z.url().regex(/^https?:\/\/[^/]+$/)]),
  /** Public demo site: no public preview links or Feishu preview cards, no full tier, no remote control,
   * accounts and shared data stay as they are for everyone but the sysadmin. */
  demoMode: z.boolean(),
  /** Plugin system master switch (plan 插件体系-方案): off = no plugin UI, nothing sent to daemons. */
  pluginsEnabled: z.boolean(),
})
export type SystemParams = z.infer<typeof SystemParams>
/** Params a team may override for its groups (plan D9). */
export const TEAM_PARAM_KEYS = [
  'approvalTimeoutMin',
  'chainMaxHops',
  'offlineWaitMin',
  'contextInlineTokens',
  'sessionReplayTokens',
  'botConcurrencyDefault',
  'attachmentsPerMessage',
  'questionsPerCard',
] as const satisfies readonly (keyof SystemParams)[]
export type TeamParamKey = (typeof TEAM_PARAM_KEYS)[number]
/** A team's own overrides; absent keys inherit the platform value, keys off the whitelist are refused. */
export const TeamParams = SystemParams.pick(
  Object.fromEntries(TEAM_PARAM_KEYS.map((k) => [k, true])) as { [K in TeamParamKey]: true },
)
  .partial()
  .strict()
export type TeamParams = z.infer<typeof TeamParams>
/** GET /api/teams/:id/params (team admins): the overrides and the platform values they replace. */
export const TeamParamsDto = z.object({
  overrides: TeamParams,
  platform: TeamParams.required(),
})
export type TeamParamsDto = z.infer<typeof TeamParamsDto>
/** PATCH /api/teams/:id (admins); `params` replaces the team's overrides. */
export const UpdateTeamReq = z.object({
  name: TeamName.optional(),
  avatar: TeamAvatar.optional(),
  params: TeamParams.optional(),
})
export const UpdateSystemParamsReq = SystemParams.partial()
/** Display order, labels and units of 系统参数 (also used by audit summaries). */
export const SYSTEM_PARAM_VIEW: {
  key: Exclude<
    keyof SystemParams,
    | 'registrationOpen'
    | 'singleTeamMode'
    | 'teamCreation'
    | 'feishuAutoSignup'
    | 'publicUrl'
    | 'demoMode'
    | 'pluginsEnabled'
  >
  label: string
  unit: string
}[] = [
  { key: 'sessionReplayTokens', label: '会话恢复失败时补送的群聊上下文（token 上限）', unit: 'token' },
  { key: 'contextInlineTokens', label: '每轮随消息附带的群聊上下文（token 上限）', unit: 'token' },
  { key: 'runRetentionDays', label: '完整运行过程保留', unit: '天' },
  { key: 'previewIdleHours', label: '预览无人访问后自动关闭', unit: '小时' },
  { key: 'previewShareMaxDays', label: '预览公开链接最长有效期', unit: '天' },
  { key: 'attachmentMaxMb', label: '单个附件大小上限', unit: 'MB' },
  { key: 'attachmentsPerMessage', label: '每条消息附件数', unit: '个' },
  { key: 'questionsPerCard', label: '提问卡片每张题数上限', unit: '题' },
  { key: 'heartbeatSec', label: '机器心跳间隔', unit: '秒' },
  { key: 'offlineMisses', label: '机器离线判定（连续未收到心跳）', unit: '次' },
  { key: 'backupRetentionDays', label: '服务器备份（每日）保留', unit: '天' },
  { key: 'archiveRetentionDays', label: '删群后存档保留', unit: '天' },
  { key: 'approvalTimeoutMin', label: '权限审批等待 · 群默认', unit: '分钟' },
  { key: 'chainMaxHops', label: '接力链长上限 · 群默认', unit: '跳' },
  { key: 'offlineWaitMin', label: 'Bot 离线时请求等待上线 · 群默认', unit: '分钟' },
  { key: 'botConcurrencyDefault', label: 'Bot 并发上限 · 新建默认', unit: '个' },
]

// ── Usage (spec §3.7) ───────────────────────────────────────────────────────
/** GET /api/bots/:id/activity — each group the bot is in, where it works there and its turn in flight (owner or sysadmin). */
export const BotPlaceDto = z.object({
  groupId: z.string(),
  groupName: z.string(),
  groupKind: GroupKind,
  workspacePath: z.string().nullable(),
  /** Not yet finished: queued, running or waiting on approval / an answer; the newest if several. */
  run: z
    .object({
      id: z.string(),
      status: RunStatus,
      step: z.string(),
      stepI18n: I18nText.optional(),
      startedAt: z.string().nullable(),
    })
    .nullable(),
  lastRunAt: z.string().nullable(),
})
export type BotPlaceDto = z.infer<typeof BotPlaceDto>

export const UsageQuery = z.object({
  by: z.enum(['bot', 'user', 'group']),
  days: z.coerce.number().int().min(1).max(365).default(30),
  /** Restrict to one bot (its owner sees who used it). */
  botId: z.string().optional(),
  /** The whole team (its admins, or sysadmins on /api/admin/usage). */
  teamId: z.string().optional(),
})
export const UsageRowDto = z.object({
  key: z.string(),
  name: z.string(),
  runs: z.number().int(),
  /** Sum over runs that reported usage. */
  totalTokens: z.number().int(),
  /** Runs whose adapter did not report usage (shown as 未上报). */
  unreported: z.number().int(),
})
export type UsageRowDto = z.infer<typeof UsageRowDto>
const isTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz })
    return true
  } catch {
    return false
  }
}
/** GET /api/usage/daily: same scope as /api/usage, bucketed by calendar day in `tz` (IANA). */
export const UsageDailyQuery = UsageQuery.omit({ by: true }).extend({
  tz: z.string().refine(isTimeZone).default('UTC'),
})
/** One per day, oldest first, zero-filled; `day` is YYYY-MM-DD in the requested time zone. */
export const UsageDayDto = UsageRowDto.omit({ key: true, name: true }).extend({ day: z.string() })
export type UsageDayDto = z.infer<typeof UsageDayDto>

/**
 * 会话统计: /api/admin/conversation-stats (every team, or `teamId`) and /api/teams/:id/conversation-stats (its admins).
 * Counts only, never message content. Messages are kind user/bot; runs are counted by when they were queued.
 */
export const ConversationStatsQuery = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
  tz: z.string().refine(isTimeZone).default('UTC'),
  teamId: z.string().optional(),
})
export const ConversationMetricsDto = z.object({
  /** Conversations with a user or bot message in the window. */
  activeConversations: z.number().int(),
  newConversations: z.number().int(),
  userMessages: z.number().int(),
  botMessages: z.number().int(),
  /** People who sent a message. */
  activeUsers: z.number().int(),
  runs: z.number().int(),
  /** Runs in a terminal state; 成功率 = completedRuns / endedRuns. */
  endedRuns: z.number().int(),
  completedRuns: z.number().int(),
  /** Mean started→ended of completed runs. */
  avgRunMs: z.number().nullable(),
})
export type ConversationMetricsDto = z.infer<typeof ConversationMetricsDto>
export const ConversationDayDto = ConversationMetricsDto.pick({
  activeConversations: true,
  userMessages: true,
  botMessages: true,
  activeUsers: true,
  runs: true,
}).extend({ day: z.string() })
export type ConversationDayDto = z.infer<typeof ConversationDayDto>
export const ConversationOverviewDto = z.object({
  /** Unarchived conversations now. */
  groups: z.number().int(),
  dms: z.number().int(),
  /** The last `days` days, and the `days` before them. */
  current: ConversationMetricsDto,
  previous: ConversationMetricsDto,
  /** One per calendar day in `tz`, oldest first, zero-filled. */
  daily: z.array(ConversationDayDto),
  statuses: z.array(z.object({ status: RunStatus, count: z.number().int() })),
})
export type ConversationOverviewDto = z.infer<typeof ConversationOverviewDto>
export const ConversationStatsBy = z.enum(['conversation', 'user', 'bot', 'team'])
export type ConversationStatsBy = z.infer<typeof ConversationStatsBy>
export const ConversationStatsRowsQuery = ConversationStatsQuery.omit({ tz: true }).extend({
  by: ConversationStatsBy,
})
/** One conversation / person / bot / team active in the window. */
export const ConversationStatsRowDto = z.object({
  key: z.string(),
  name: z.string(),
  /** Conversations only. */
  kind: z.enum(['group', 'dm']).nullable(),
  /** Conversations and bots. */
  teamName: z.string().nullable(),
  /** A conversation's creator, a bot's owner. */
  ownerName: z.string().nullable(),
  /** Conversations they posted in. */
  conversations: z.number().int(),
  userMessages: z.number().int(),
  botMessages: z.number().int(),
  /** People who posted; for a bot, people whose turns it ran. */
  activeUsers: z.number().int(),
  runs: z.number().int(),
  endedRuns: z.number().int(),
  completedRuns: z.number().int(),
  lastActiveAt: z.string().nullable(),
})
export type ConversationStatsRowDto = z.infer<typeof ConversationStatsRowDto>

// ── Realtime: WS /ws/web (server → browser; the browser only sends WebClientMsg) ──
/** Per-bot workspace state in a group: drives the partition-mode git status bar (spec §5.3, §8.4). */
export const GroupBotStateDto = z.object({
  botId: z.string(),
  workspace: z.enum(['managed', 'cd']),
  /**
   * unbound = waiting for the owner to pick a workspace; confirm = joined a repo group while its owner was online,
   * waiting for them to choose a managed clone or a local one. The bot is not run meanwhile (plan W5).
   */
  state: z.enum(['pending', 'cloning', 'ready', 'failed', 'unbound', 'confirm']),
  path: z.string().nullable(),
  git: GitStatus.nullable(),
  error: z.string().nullable(),
  /** With `failed`: denied / network / timeout pause the bot until a recheck succeeds. */
  reason: RepoAccessReason.nullable(),
  /** This group's tier override; null follows the bot's own tier. */
  tier: Tier.nullable(),
  /** This group's model / thought level; null follows the bot's defaults. */
  model: z.string().nullable(),
  effort: z.string().nullable(),
  /** Context occupancy of the bot's current session here; null before its first report or after /new. */
  context: ContextUsage.nullable(),
  /** Additional directories (absolute paths on the owner's machine) the bot also works in here; not shared by sync. */
  extraDirs: z.array(z.string()),
})
export type GroupBotStateDto = z.infer<typeof GroupBotStateDto>

/** GET /api/groups/:id/bots/:botId/repo-candidates: the owner's local clones of the group repo (repo.found). */
export const RepoCandidatesDto = z.object({ managedPath: z.string(), paths: z.array(z.string()) })
export type RepoCandidatesDto = z.infer<typeof RepoCandidatesDto>

export const WebEvent = z.discriminatedUnion('t', [
  z.object({ t: z.literal('group.botState'), groupId: z.string(), state: GroupBotStateDto }),
  /** The group's pinned messages changed; replaces the list. */
  GroupPinsDto.extend({ t: z.literal('group.pins'), groupId: z.string() }),
  /** The group's tab bar changed; replaces it. */
  GroupTabsDto.extend({ t: z.literal('group.tabs'), groupId: z.string() }),
  /** A manual git operation of the group was requested, decided or finished. */
  z.object({ t: z.literal('group.gitOperation'), groupId: z.string(), operation: GitOperationDto }),
  /** The group's previews or services changed; replaces both lists (`canManage` is per receiving user). */
  GroupPreviewsDto.extend({ t: z.literal('group.previews'), groupId: z.string() }),
  GroupSchedulesDto.extend({ t: z.literal('group.schedules'), groupId: z.string() }),
  /** The group's knowledge base changed (`entryId` when one entry did); clients refetch what they show. */
  z.object({ t: z.literal('group.knowledge'), groupId: z.string(), entryId: z.string().optional() }),
  /** Force groups: the replicas' sync status changed; replaces it. */
  SyncStatusDto.extend({ t: z.literal('group.sync') }),
  z.object({ t: z.literal('message.new'), message: MessageDto }),
  /** A message's reactions changed; replaces its list (`mine` is per receiving user). */
  ReactionsDto.extend({ t: z.literal('message.reactions') }),
  /** Sent to every member; quotes of it now read RECALLED_QUOTE. */
  z.object({ t: z.literal('message.recalled'), groupId: z.string(), messageId: z.string() }),
  /** Sent to every member; quotes of it now read the new text. */
  z.object({ t: z.literal('message.edited'), message: MessageDto }),
  /** Sent to the author only (their other sessions). */
  z.object({ t: z.literal('message.hidden'), groupId: z.string(), messageId: z.string() }),
  z.object({ t: z.literal('run.updated'), run: RunDto }),
  /** Only to connections showing the run's group, or that never sent a focus. */
  z.object({ t: z.literal('run.delta'), runId: z.string(), text: z.string() }),
  /** The run's process got an event that left its card as it was. Scoped like run.delta. */
  z.object({ t: z.literal('run.progress'), runId: z.string(), groupId: z.string(), botId: z.string() }),
  /** The run's process got an event that only changed the card's step or usage; replaces those fields. */
  RunDto.pick({ step: true, stepI18n: true, usage: true }).extend({
    t: z.literal('run.step'),
    runId: z.string(),
    groupId: z.string(),
    botId: z.string(),
  }),
  z.object({ t: z.literal('bot.updated'), bot: BotDto }),
  z.object({ t: z.literal('bot.removed'), botId: z.string() }),
  z.object({ t: z.literal('notification.new'), notification: NotificationDto }),
  /** Some of the user's notifications were settled server-side; `unread` is their fresh unread count. */
  z.object({
    t: z.literal('notification.resolved'),
    notifications: z.array(NotificationDto),
    unread: z.number().int(),
  }),
  z.object({ t: z.literal('group.updated'), group: GroupDto }),
  /** The receiving user is no longer a member. */
  z.object({ t: z.literal('group.removed'), groupId: z.string() }),
  z.object({ t: z.literal('machine.updated'), machine: MachineDto }),
  z.object({ t: z.literal('machine.removed'), machineId: z.string() }),
  /** Owner only: a line of a running tools install / upgrade. */
  z.object({
    t: z.literal('machine.tools.progress'),
    machineId: z.string(),
    opId: z.string(),
    line: z.string(),
  }),
  /** Owner only: the install / upgrade ended; `state` null when the machine went offline or never answered. */
  z.object({
    t: z.literal('machine.tools.result'),
    machineId: z.string(),
    opId: z.string(),
    ok: z.boolean(),
    error: z.string().nullable(),
    state: ToolsStateDto.nullable(),
  }),
  /** Group members: replaces the group's provider banner items. */
  GroupProviderStateDto.extend({ t: z.literal('group.providerState'), groupId: z.string() }),
  /** The receiving member's view of a team they are in (renamed, their role changed, or just joined). */
  z.object({ t: z.literal('team.updated'), team: TeamDto }),
  /** The receiving user left or was removed from the team, or it was archived. */
  z.object({ t: z.literal('team.removed'), teamId: z.string() }),
  /** Team members: someone joined or their role changed. */
  z.object({ t: z.literal('team.member_updated'), teamId: z.string(), member: TeamMemberDto }),
  z.object({ t: z.literal('team.member_removed'), teamId: z.string(), userId: z.string() }),
])
export type WebEvent = z.infer<typeof WebEvent>

export const WebClientMsg = z.discriminatedUnion('t', [
  /** The group this connection shows (null: none), sent on every (re)open and change; scopes run.delta / run.progress. */
  z.object({ t: z.literal('focus'), groupId: z.string().nullable() }),
  /** Whether the page is on screen and focused; with focus it means the user is reading that group (no Feishu ping). */
  z.object({ t: z.literal('visible'), visible: z.boolean() }),
])
export type WebClientMsg = z.infer<typeof WebClientMsg>

/** A run card with a run.step applied. */
export const withRunStep = (
  run: RunDto,
  { step, stepI18n, usage }: Extract<WebEvent, { t: 'run.step' }>,
): RunDto => ({ ...run, step, stepI18n, usage })
