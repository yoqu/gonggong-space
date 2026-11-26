import { z } from 'zod'
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS, MAX_QUESTIONS } from '../common.js'
import { GroupKind, GroupParams } from './groups.js'
import { MachineDto } from './machines-bots.js'

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
  /** Retired gg-cast builds of older releases; read only so publishing a new release deletes their files. */
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
export const ReleaseKind = z.enum(['builds', 'desktop', 'update', 'signature'])
export type ReleaseKind = z.infer<typeof ReleaseKind>
export interface ReleaseFile {
  kind: ReleaseKind
  version: string
  platform: string
}
const RELEASE_FILE = /^gonggong-(\d+\.\d+\.\d+)-((?:macos|linux)-(?:x86_64|aarch64)|windows-x86_64)(\.exe)?$/
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
 * `gonggong-0.2.0-windows-x86_64.exe`, `Gonggong_0.2.0_aarch64.dmg`, `Gonggong_0.2.0_aarch64.app.tar.gz(.sig)`): the name
 * alone says what the file is, so admins just drop dist/<version>/.
 */
export function parseReleaseFile(name: string): ReleaseFile | null {
  const [, desktopVersion, bundle] = DESKTOP_FILE.exec(name) ?? []
  const [desktopKind, desktopPlatform] = (bundle && DESKTOP_PLATFORM[bundle]) || []
  if (desktopVersion && desktopKind && desktopPlatform)
    return { kind: desktopKind, version: desktopVersion, platform: desktopPlatform }
  const [, version, platform, exe] = RELEASE_FILE.exec(name) ?? []
  if (!version || !platform || platform.startsWith('windows') !== Boolean(exe)) return null
  return { kind: 'builds', version, platform }
}
/** GET /api/client-downloads → installers a member can download, or null before any is published. */
export const ClientDownloads = DaemonRelease.pick({ version: true, builds: true, desktop: true })
export type ClientDownloads = z.infer<typeof ClientDownloads>

// ── Audit (spec §9, §13) ────────────────────────────────────────────────────
export const AuditCategory = z.enum([
  'approval',
  'question',
  'lock',
  'admin',
  'run',
  'command',
  'preview',
  'schedule',
])
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
  kind: GroupKind,
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
  /** A bot's next turn in a group (or thread) opens a new session after this long without one there: a long-idle
   * session no longer has its prompt cache, so resuming it re-reads the whole history at full price. */
  sessionIdleHours: z.number().int().min(1).max(720),
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
  /** Plugins that run code (permission `exec`, plan 插件扩展点 §9); off = they are sent to no daemon. */
  pluginCodeEnabled: z.boolean(),
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
export const UpdateSystemParamsReq = SystemParams.partial()
/** 新手群 example questions until a team admin edits them; sent as written, like any message. */
export const DEFAULT_ONBOARDING_EXAMPLES = [
  '你能帮我做些什么？',
  '帮我把这段会议纪要整理成待办清单',
  '团队最近在做哪些事？',
]
/** PUT /api/teams/:id/onboarding (admins): 新手群, its 默认助手 Bot and three example questions. */
export const TeamOnboardingReq = z.object({
  groupId: z.string().nullable(),
  botId: z.string().nullable(),
  examples: z.array(z.string().trim().min(1).max(100)).length(3),
})
export type TeamOnboardingReq = z.infer<typeof TeamOnboardingReq>
/** GET /api/teams/:id/onboarding (members): the team's 新手群 as newcomers use it; `options` only for admins. */
export const TeamOnboardingDto = z.object({
  groupId: z.string().nullable(),
  groupName: z.string().nullable(),
  botId: z.string().nullable(),
  botName: z.string().nullable(),
  examples: z.array(z.string()),
  /** Opens the Feishu chat bound to the group; null when unbound. */
  feishuUrl: z.string().nullable(),
  /** Groups of the team and their bots, to pick from. */
  options: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        bots: z.array(z.object({ id: z.string(), name: z.string() })),
      }),
    )
    .optional(),
})
export type TeamOnboardingDto = z.infer<typeof TeamOnboardingDto>
/** How the user left or silenced the approval-card permission guide. */
export const ApprovalGuideState = z.enum(['dismissed', 'graduated', 'fatigued'])
export type ApprovalGuideState = z.infer<typeof ApprovalGuideState>

/** GET/PATCH /api/me/onboarding: first-login guide and approval-card permission guide state. */
export const UserOnboarding = z.object({
  guide: z.enum(['done', 'skipped']).optional(),
  at: z.string().optional(),
  approvalGuide: ApprovalGuideState.optional(),
  approvalGuideSeen: z.number().int().min(0).max(10).optional(),
  approvalGuideAt: z.string().optional(),
})
export type UserOnboarding = z.infer<typeof UserOnboarding>
export const UpdateOnboardingReq = z
  .object({
    guide: z.enum(['done', 'skipped']).optional(),
    approvalGuide: ApprovalGuideState.optional(),
    approvalGuideSeen: z.number().int().min(0).max(10).optional(),
  })
  .refine(
    (v) => v.guide !== undefined || v.approvalGuide !== undefined || v.approvalGuideSeen !== undefined,
    'Nothing to update',
  )
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
    | 'pluginCodeEnabled'
  >
  label: string
  unit: string
}[] = [
  { key: 'sessionReplayTokens', label: '会话恢复失败时补送的群聊上下文（token 上限）', unit: 'token' },
  { key: 'contextInlineTokens', label: '每轮随消息附带的群聊上下文（token 上限）', unit: 'token' },
  { key: 'sessionIdleHours', label: 'Bot 闲置后下次对话自动开新会话', unit: '小时' },
  { key: 'runRetentionDays', label: '完整运行过程保留', unit: '天' },
  { key: 'previewIdleHours', label: '预览无人访问后自动关闭', unit: '小时' },
  { key: 'previewShareMaxDays', label: '预览公开链接最长有效期', unit: '天' },
  { key: 'attachmentMaxMb', label: '单个附件大小上限', unit: 'MB' },
  { key: 'attachmentsPerMessage', label: '每条消息附件数', unit: '个' },
  { key: 'questionsPerCard', label: '提问卡片每张题数上限', unit: '题' },
  { key: 'heartbeatSec', label: '电脑心跳间隔', unit: '秒' },
  { key: 'offlineMisses', label: '电脑离线判定（连续未收到心跳）', unit: '次' },
  { key: 'backupRetentionDays', label: '服务器备份（每日）保留', unit: '天' },
  { key: 'archiveRetentionDays', label: '删群后存档保留', unit: '天' },
  { key: 'approvalTimeoutMin', label: '权限审批等待 · 群默认', unit: '分钟' },
  { key: 'chainMaxHops', label: '接力链长上限 · 群默认', unit: '跳' },
  { key: 'offlineWaitMin', label: 'Bot 离线时请求等待上线 · 群默认', unit: '分钟' },
  { key: 'botConcurrencyDefault', label: 'Bot 并发上限 · 新建默认', unit: '个' },
]
