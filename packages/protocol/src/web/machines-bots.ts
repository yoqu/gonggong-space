import { z } from 'zod'
import { AgentSettings, AgentSettingValues } from '../agent-settings.js'
import { AgentKind, Approval, DiffRepo, Tier, TriggerScope } from '../common.js'
import {
  AgentCatalog,
  AgentInfo,
  CcSwitchCandidate,
  DiffScope,
  DirEntry,
  DirPlace,
  FileTreeEntry,
  GitTokenInput,
  MachineInfo,
  OfficialInput,
  ProviderInput,
  ProviderStateItem,
  ProviderStoreView,
  TOOL_VERSION,
  ToolStatus,
  ToolsSettings,
} from '../daemon.js'

// ── Machines ────────────────────────────────────────────────────────────────
/** `link` is the 接入链接 `gonggong://bind?server=…&code=…` the desktop app opens or parses. */
export const BindCodeDto = z.object({
  code: z.string(),
  expiresAt: z.string(),
  link: z.string(),
  /** Agent 自助接入: the sentence to paste to a local agent (Claude Code, Codex…), with this server and the code. */
  agentPrompt: z.string(),
})
/** GET /api/install/gg?platform=<os>-<arch> (public): the gg build install.sh downloads; 404 when none. */
export const InstallBuildDto = z.object({ version: z.string(), url: z.string(), sha256: z.string() })
export type InstallBuildDto = z.infer<typeof InstallBuildDto>
export type BindCodeDto = z.infer<typeof BindCodeDto>
/**
 * GET /api/link-requests/:id (signed in): a machine asking to be bound after its bind code expired. Allow it only if
 * you just started the hookup yourself and `userCode` matches the terminal. `expired`: pending past `expiresAt`.
 */
export const LinkRequestDto = z.object({
  id: z.string(),
  machine: MachineInfo.pick({ name: true, os: true, arch: true }),
  agent: AgentKind.nullable(),
  ip: z.string(),
  userCode: z.string(),
  status: z.enum(['pending', 'approved', 'denied', 'consumed', 'expired']),
  expiresAt: z.string(),
})
export type LinkRequestDto = z.infer<typeof LinkRequestDto>
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
/*
 * Git access and self-checks of a machine (owner only, relayed live; tokens are never stored server-side):
 *   GET    /api/machines/:id/git-access                       → GitAccessView
 *   POST   /api/machines/:id/git-access/ssh-key               → GitAccessView (an ed25519 key, never overwritten)
 *   PUT    /api/machines/:id/git-access/tokens  GitTokenInput → GitAccessView
 *   DELETE /api/machines/:id/git-access/tokens/:host          → GitAccessView
 *   POST   /api/machines/:id/git-access/test    GitAccessTestReq → GitAccessTest
 *   POST   /api/machines/:id/git-access/known-hosts TrustHostReq → GitAccessView
 *   GET    /api/machines/:id/diag                             → DiagCheck[]
 */
export const GitAccessTestReq = z.object({ url: z.string().trim().min(1).max(2048) })
export const TrustHostReq = z.object({ host: GitTokenInput.shape.host })
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
/** What a bot may wear: a built-in character, or `role-agent` for the figure of its own agent (the default). */
export const BOT_ROLES = ['role-agent', ...BOT_AVATARS] as const
export const BotRole = z.enum(BOT_ROLES)
export type BotRole = z.infer<typeof BotRole>

export const BotDto = z.object({
  id: z.string(),
  teamId: z.string(),
  name: z.string(),
  ownerId: z.string(),
  ownerName: z.string(),
  agentKind: AgentKind,
  /** `role-agent` reads as `role-gong` here: clients before it can't draw it. */
  avatar: BotAvatar,
  /** Wears its agent's figure (role `role-agent`). */
  followAgent: z.boolean(),
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
  /** Always 'ask' and empty since 审批方式 replaced them (allowlists merged into alwaysAllow); kept for older clients. */
  approval: Approval,
  allowlist: z.array(z.string()),
  /** Rules from 始终允许 (see RunStart.bot.alwaysAllow). */
  alwaysAllow: z.array(z.string()),
  /** 帮我审批 (see RunStart.bot.aiReview). */
  aiReview: z.boolean(),
  /** AI 预审's model; null = off (see RunStart.bot.reviewModel). */
  reviewModel: z.string().nullable(),
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
  entries: z.array(DirEntry),
  git: z.object({ root: z.string(), remotes: z.array(z.string()), branch: z.string().nullable() }).nullable(),
  /** Why `path` cannot be a workspace; null = selectable. */
  unusable: z.string().nullable(),
  /** Filesystem roots of the machine (Windows drives, `/` elsewhere). */
  roots: z.array(z.string()),
  places: z.array(DirPlace),
  /** 新建文件夹 is offered (the daemon answers dir.create). */
  canCreate: z.boolean(),
})
export type DirListingDto = z.infer<typeof DirListingDto>
/** POST /api/machines/:id/dirs: a new folder in `parent`; answers its absolute path. */
export const DirCreateReq = z.object({ parent: z.string().min(1), name: z.string().min(1).max(255) })
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
