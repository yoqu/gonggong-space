import { z } from 'zod'
import { ConnectorCliState, ConnectorDriver } from './daemon/connectors.js'
import {
  PluginCapability,
  PluginCategory,
  PluginCommand,
  PluginConnector,
  PluginMcp,
  PluginPermission,
  PluginReadiness,
  PluginScene,
} from './plugins.js'
import { SecretMode, SecretRequirement, SecretScope } from './secrets.js'

// ── Skill 市场 (plan Skill市场-PRD): listings (the `plugins` table) installed into a scope ────
/** `plugin`: a creation plugin with gonggong-plugin.json; `skill`: a bare skill folder (SKILL.md at its root). */
export const ListingType = z.enum(['plugin', 'skill'])
export type ListingType = z.infer<typeof ListingType>
/** `unlisted`: no new installs, existing ones keep their resolved version; `banned`: no longer delivered at all. */
export const ListingStatus = z.enum(['listed', 'unlisted', 'banned'])
export type ListingStatus = z.infer<typeof ListingStatus>
/** Where an install applies; `user` (personal layer) arrives in M3. Precedence: user > group > repo > team. */
export const InstallScope = z.enum(['user', 'group', 'repo', 'team'])
export type InstallScope = z.infer<typeof InstallScope>

/** The manifest stored for a `skill` listing: its SKILL.md frontmatter. */
export const SkillListingManifest = z.object({
  name: z.string(),
  description: z.string(),
  /** Its frontmatter `secrets` (plan Skill密钥声明); absent in snapshots stored before declarations. */
  secretSpecs: z.array(SecretRequirement).optional(),
  /** Optional Plugin Market scenario override from SKILL.md frontmatter `scene`. */
  scene: PluginScene.optional(),
  /** Optional sample prompts from SKILL.md frontmatter `examples`. */
  examples: z.array(z.string().min(1).max(200)).max(6).optional(),
})
export type SkillListingManifest = z.infer<typeof SkillListingManifest>

/** A listing as the install lists show it. */
export const ListingSummary = z.object({
  id: z.string(),
  type: ListingType,
  /** The delivered name: a skill's own name, a plugin's `name` (delivered as `<name>:<skill>`). */
  name: z.string(),
  title: z.string(),
  description: z.string(),
  /** The layer that owns the listing. */
  layer: z.enum(['platform', 'team', 'group']),
  status: ListingStatus,
  /** Current version of the listing. */
  versionId: z.string(),
  revision: z.number().int(),
  /** A plugin's `manifest.icon` in that version (GET /api/market/:id/files/raw?path=…&versionId=…). */
  icon: z.string().nullable().optional(),
  /** A plugin's category (its shelf: shelfOf); null for skills. */
  category: PluginCategory.nullable().optional(),
})
export type ListingSummary = z.infer<typeof ListingSummary>

/** Live health state of an installed plugin in a target scope. */
export const InstalledHealth = z.enum([
  'ready',
  'needs-secret',
  'needs-account',
  'needs-trust',
  'update-available',
  'disabled',
  'banned',
])
export type InstalledHealth = z.infer<typeof InstalledHealth>

/**
 * A declared secret whose name already had an existing definition in the target or an inherited scope;
 * silently reused without overwriting or failing, surfaced ONLY inside 「开发者信息」.
 */
export const ReusedSecretDto = z.object({
  name: z.string(),
  existingScope: SecretScope,
  existingScopeLabel: z.string(),
  targetLabel: z.string().optional(),
})
export type ReusedSecretDto = z.infer<typeof ReusedSecretDto>

/** Sort modes for GET /api/market. */
export const MarketSort = z.enum(['team', 'installs', 'latest'])
export type MarketSort = z.infer<typeof MarketSort>

/**
 * GET /api/{groups/:id|teams/:id|teams/:id/repos/:repoId}/installs — the scope's own installs.
 * PUT  …/installs/:listingId (InstallReq) creates or updates one; DELETE …/installs/:listingId removes it.
 * A same-named skill or install in the same scope is a 409 conflict.
 */
export const InstallDto = z.object({
  listing: ListingSummary,
  scope: InstallScope,
  enabled: z.boolean(),
  /** Null = follow the listing's latest version. */
  pinVersionId: z.string().nullable(),
  /** The version actually delivered; moves forward only when an upgrade succeeds. */
  resolvedVersionId: z.string(),
  resolvedRevision: z.number().int(),
  /** Why the listing was banned (`listing.status` banned); null otherwise. */
  banReason: z.string().nullable(),
  updatedBy: z.string().nullable(),
  updatedAt: z.string(),
  /** Present on PUT install when declared secret names already existed and were silently reused. */
  reusedSecrets: z.array(ReusedSecretDto).optional(),
})
export type InstallDto = z.infer<typeof InstallDto>
export const InstallReq = z.object({
  enabled: z.boolean(),
  pinVersionId: z.string().nullable().default(null),
})
export type InstallReq = z.infer<typeof InstallReq>

/**
 * GET …/installable — listings visible to the scope (platform, its team, its group) not installed there yet;
 * `nameTaken`: a skill whose name another skill of the scope already has, so installing it would be a 409.
 */
export const InstallableDto = ListingSummary.extend({ nameTaken: z.boolean().optional() })
export type InstallableDto = z.infer<typeof InstallableDto>

// ── M2: market page, authoring, import and minimal review ────
/** Who may see a listing in the market: every signed-in user, or members of its team. */
export const ListingVisibility = z.enum(['public', 'team'])
export type ListingVisibility = z.infer<typeof ListingVisibility>
/** A version's review: authors upload `draft`s and submit them; layer uploads by admins are `approved` at once. */
export const ReviewStatus = z.enum(['draft', 'pending', 'approved', 'rejected'])
export type ReviewStatus = z.infer<typeof ReviewStatus>
/** Market filter: platform listings, the caller's teams' listings, other teams' public listings. */
export const MarketSource = z.enum(['official', 'team', 'public'])
export type MarketSource = z.infer<typeof MarketSource>

/** Where a GitHub import came from, pinned to a commit (D11/D12). */
export const ListingSource = z.object({
  url: z.string(),
  /** Branch, tag or commit the author gave; null = the default branch. */
  ref: z.string().nullable(),
  /** Sub-directory of the skill inside the repository; '' = the root. */
  path: z.string(),
  commit: z.string(),
})
export type ListingSource = z.infer<typeof ListingSource>

/**
 * An install of a listing the caller can see: their personal layer (`label` ''), a group they are in, a team they
 * belong to or one of its repos (「团队名 / 仓库名」).
 */
export const InstalledTarget = z.object({ scope: InstallScope, scopeId: z.string(), label: z.string() })
export type InstalledTarget = z.infer<typeof InstalledTarget>
/** A target among those of `InstalledTarget`, by scope and id. */
export const TargetRef = InstalledTarget.pick({ scope: true, scopeId: true })
export type TargetRef = z.infer<typeof TargetRef>
/** A pending install request for the listing on a target the caller belongs to; `mine`: the caller asked. */
export const RequestedTarget = TargetRef.extend({ requester: z.string(), mine: z.boolean() })
export type RequestedTarget = z.infer<typeof RequestedTarget>

/** Per-target live health for a listing's installed scopes (shown in Plugin Detail header pills). */
export const InstalledTargetHealthDto = InstalledTarget.extend({
  enabled: z.boolean(),
  health: InstalledHealth,
  healthDetail: z.string().nullable(),
})
export type InstalledTargetHealthDto = z.infer<typeof InstalledTargetHealthDto>

/**
 * GET /api/market?q=&scene=&capability=&source=&sort= — listings with an approved version the caller may see.
 * Agent engines and provider presets are excluded by default (pass `shelf=agent|provider` or `includeSystem=true`
 * for internal/settings callers). Installs follow `listedVersionId` (latest approved).
 */
export const MarketListingDto = ListingSummary.extend({
  source: MarketSource,
  visibility: ListingVisibility.nullable(),
  teamId: z.string().nullable(),
  teamName: z.string().nullable(),
  author: z.string().nullable(),
  agents: z.array(z.string()),
  /** Latest approved version. */
  listedVersionId: z.string(),
  listedRevision: z.number().int(),
  installs: z.number().int(),
  /** Where the caller sees it installed (market list and detail; empty elsewhere), user → group → team → repo. */
  installedIn: z.array(InstalledTarget).optional(),
  /** Scenario category for left-rail browsing (connect | create | office | dev | tools). */
  scene: PluginScene.optional(),
  /** Plain-language capability badges (do | connect | create). */
  capabilities: z.array(PluginCapability).optional(),
  /** Static pre-use readiness hint (ready | needs-account | needs-secret | needs-trust). */
  readiness: PluginReadiness.optional(),
  /** Highlighted on the Plugin Market home hero. */
  featured: z.boolean().optional(),
  /** Sample 「试试这样问」 prompts derived from connector/manifest/SKILL frontmatter. */
  examples: z.array(z.string()).optional(),
  /** Number of active groups in the caller's teams currently using this plugin. */
  teamGroupsCount: z.number().int().optional(),
  /** Declared plugin permissions (e.g. `exec` requires pinned version); empty for bare skills. */
  permissions: z.array(PluginPermission).optional(),
  updatedAt: z.string(),
})
export type MarketListingDto = z.infer<typeof MarketListingDto>

export const ListingVersionDto = z.object({
  id: z.string(),
  revision: z.number().int(),
  reviewStatus: ReviewStatus,
  changelog: z.string(),
  reviewNote: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
})
export type ListingVersionDto = z.infer<typeof ListingVersionDto>

/** GET /api/market/:id — one listing; `readme` is the shown version's SKILL.md (entry skill for plugins). */
export const MarketListingDetailDto = MarketListingDto.extend({
  /** Null while no version was ever approved (seen by maintainers and reviewers only). */
  listedVersionId: z.string().nullable(),
  listedRevision: z.number().int().nullable(),
  /** The caller reviews it: may ban / unban (M4). */
  canReview: z.boolean().optional(),
  banReason: z.string().nullable().optional(),
  /** Pending install requests on targets the caller belongs to, user → group → team → repo. */
  requestedIn: z.array(RequestedTarget).optional(),
  /** Targets the caller belongs to where another skill already has this skill's name (installing there is a 409). */
  nameTakenIn: z.array(TargetRef).optional(),
  /** Live health per installed target (parallel to `installedIn`, used for header pills). */
  installedHealth: z.array(InstalledTargetHealthDto).optional(),
  /** Secret definitions silently reused on install (surfaced ONLY in 「开发者信息」). */
  reusedSecrets: z.array(ReusedSecretDto).optional(),
  readme: z.string(),
  /** A plugin's permissions and MCP servers (plan 插件扩展点 §9), shown before installing; empty for skills. */
  permissions: z.array(PluginPermission).default([]),
  mcp: z.array(PluginMcp).default([]),
  /** Chat / artifact commands contributed by this plugin; empty for skills. */
  commands: z.array(PluginCommand).optional(),
  /** Number of creation templates shipped by this plugin. */
  templatesCount: z.number().int().optional(),
  /** Whether this listing ships a skill/guide entry. */
  hasEntry: z.boolean().optional(),
  /** The shown version's declared secrets (plan Skill密钥声明 §4), shown before installing. */
  secretSpecs: z.array(SecretRequirement).default([]),
  /** A connector plugin's 试试这样用 and 如何获取 (plan 连接器 §3.2); absent for other listings. */
  connector: PluginConnector.optional(),
  files: z.array(z.object({ path: z.string(), size: z.number().int() })),
  versions: z.array(ListingVersionDto),
  ghSource: ListingSource.nullable(),
  /** The caller authored it, or maintains it as a team admin after the author left (D13). */
  canEdit: z.boolean(),
})
export type MarketListingDetailDto = z.infer<typeof MarketListingDetailDto>

/** GET /api/market/mine — listings the caller maintains, approved or not, with their latest version. */
export const MyListingDto = ListingSummary.extend({
  visibility: ListingVisibility,
  teamId: z.string(),
  latest: ListingVersionDto,
  listedVersionId: z.string().nullable(),
  ghSource: ListingSource.nullable(),
  banReason: z.string().nullable(),
})
export type MyListingDto = z.infer<typeof MyListingDto>

/**
 * POST /api/market — a new listing, or a new draft version of the caller's same-named listing in that team.
 * Files are a bare skill folder (SKILL.md at the root) or a plugin folder (gonggong-plugin.json).
 */
export const PublishReq = z.object({
  teamId: z.string(),
  visibility: ListingVisibility,
  files: z.array(z.object({ path: z.string(), content: z.string(), encoding: z.enum(['utf8', 'base64']) })),
})
export type PublishReq = z.infer<typeof PublishReq>
/** POST /api/market/import/github — fetches github.com/<owner>/<repo>[/tree/<ref>/<path>] and saves a draft. */
export const GithubImportReq = z.object({
  teamId: z.string(),
  visibility: ListingVisibility,
  url: z.string().url(),
})
export type GithubImportReq = z.infer<typeof GithubImportReq>
/**
 * POST /api/market/preflight (PublishReq) — what saving would do, without saving: invalid files and a name taken by
 * someone else fail as POST /api/market would. `new` listing, new `version` of mine, or `unchanged` (same files as
 * the latest upload); `revision` is the one the upload becomes (the latest one when unchanged). `visibility` is the
 * existing listing's for a new version (the chosen one is ignored then).
 */
export const PublishPreflightRes = z.object({
  type: ListingType,
  name: z.string(),
  title: z.string(),
  description: z.string(),
  kind: z.enum(['new', 'version', 'unchanged']),
  revision: z.number().int(),
  visibility: ListingVisibility,
  warnings: z.array(z.string()),
})
export type PublishPreflightRes = z.infer<typeof PublishPreflightRes>
/**
 * POST /api/market/:id/check-upstream — `changed` when the upstream commit moved; `drafted` when that also changed
 * the files, saving a new draft (the commit is recorded either way).
 */
export const CheckUpstreamRes = z.object({ changed: z.boolean(), drafted: z.boolean(), commit: z.string() })
export type CheckUpstreamRes = z.infer<typeof CheckUpstreamRes>
/** GET /api/market/mine/upstream — GitHub-imported listings I maintain whose upstream moved past the recorded commit. */
export const UpstreamMovedDto = z.object({ listingId: z.string(), commit: z.string() })
export type UpstreamMovedDto = z.infer<typeof UpstreamMovedDto>
/** PATCH /api/market/:id — by its maintainer; `unlisted` stops new installs. */
export const UpdateListingReq = z.object({
  visibility: ListingVisibility.optional(),
  status: z.enum(['listed', 'unlisted']).optional(),
})
export type UpdateListingReq = z.infer<typeof UpdateListingReq>
/** POST /api/market/:id/versions/:versionId/submit — draft or rejected → pending. */
export const SubmitVersionReq = z.object({ changelog: z.string().max(2000) })
export type SubmitVersionReq = z.infer<typeof SubmitVersionReq>

/**
 * GET /api/market/reviews?teamId= — pending versions the caller reviews: team visibility → that team's admins,
 * public → sysadmins. POST /api/market/:id/versions/:versionId/review (ReviewReq).
 */
export const ReviewItemDto = z.object({
  listing: MarketListingDto.omit({ listedVersionId: true, listedRevision: true }).extend({
    listedVersionId: z.string().nullable(),
    listedRevision: z.number().int().nullable(),
  }),
  version: ListingVersionDto,
})
export type ReviewItemDto = z.infer<typeof ReviewItemDto>
export const ReviewReq = z.discriminatedUnion('approve', [
  z.object({ approve: z.literal(true), note: z.string().max(500).default('') }),
  z.object({ approve: z.literal(false), note: z.string().min(1).max(500) }),
])
export type ReviewReq = z.infer<typeof ReviewReq>
/**
 * Answer of POST /api/market and /api/market/import/github: the saved draft and hints (secrets, absolute paths);
 * `unchanged` when the files equal the latest upload, so no new version was saved.
 */
export const PublishRes = z.object({
  listing: MyListingDto,
  warnings: z.array(z.string()),
  unchanged: z.boolean(),
})
export type PublishRes = z.infer<typeof PublishRes>

// ── M3: the personal layer ────
/**
 * GET|PUT|DELETE /api/me/installs[/:listingId], GET /api/me/installable — the caller's `user` installs (skills only).
 * They apply to runs the caller originates, above the group layer. A listing the caller maintains may be installed
 * before approval and then follows its latest upload (self-test); others follow `listedVersionId`.
 */
export const PERSONAL_BASE = '/me'

// ── M4: review diff, ban, install requests ────
/**
 * GET /api/market/:id/versions/:versionId/diff — the version against the listing's latest approved one before it
 * (`base` null = first version): changed files only; text files carry both sides, binary ones only sizes.
 */
export const VersionDiffDto = z.object({
  base: z.object({ versionId: z.string(), revision: z.number().int() }).nullable(),
  files: z.array(
    z.object({
      path: z.string(),
      status: z.enum(['added', 'removed', 'modified']),
      binary: z.boolean(),
      before: z.string().nullable(),
      after: z.string().nullable(),
    }),
  ),
})
export type VersionDiffDto = z.infer<typeof VersionDiffDto>

/**
 * POST /api/market/:id/ban (BanReq) / DELETE /api/market/:id/ban — by the listing's reviewers (team visibility: that
 * team's admins; public and platform: sysadmins). Banned listings stop being delivered on the next turn.
 */
export const BanReq = z.object({ reason: z.string().min(1).max(500) })
export type BanReq = z.infer<typeof BanReq>

export const InstallRequestStatus = z.enum(['pending', 'approved', 'rejected', 'cancelled'])
export type InstallRequestStatus = z.infer<typeof InstallRequestStatus>
/**
 * POST /api/install-requests (InstallRequestReq) — a member asks the target's admins to install a listing: group
 * members for their group, team members for the team or its repos. 409 when installed or already pending.
 */
export const InstallRequestReq = z.object({
  listingId: z.string(),
  scope: z.enum(['group', 'repo', 'team']),
  scopeId: z.string(),
  pinVersionId: z.string().nullable().default(null),
  note: z.string().max(500).default(''),
})
export type InstallRequestReq = z.infer<typeof InstallRequestReq>
/**
 * GET /api/install-requests?view=mine|todo — mine: the caller's requests; todo: pending ones the caller may decide.
 * POST /api/install-requests/:id/decide (DecideInstallRequestReq) installs on approval (a conflict stays pending, 409).
 * DELETE /api/install-requests/:id — the requester cancels a pending one.
 */
export const InstallRequestDto = z.object({
  id: z.string(),
  listing: ListingSummary,
  scope: z.enum(['group', 'repo', 'team']),
  scopeId: z.string(),
  /** 「群名」, 「团队名」 or 「团队名 / 仓库名」. */
  targetLabel: z.string(),
  pinVersionId: z.string().nullable(),
  note: z.string(),
  status: InstallRequestStatus,
  requester: z.string(),
  decidedBy: z.string().nullable(),
  decisionNote: z.string().nullable(),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
  /** Optional capability & security summary for the approval card. */
  scene: PluginScene.optional(),
  capabilities: z.array(PluginCapability).optional(),
  readiness: PluginReadiness.optional(),
  permissions: z.array(PluginPermission).optional(),
  secretSpecs: z.array(SecretRequirement).optional(),
})
export type InstallRequestDto = z.infer<typeof InstallRequestDto>
export const DecideInstallRequestReq = ReviewReq
export type DecideInstallRequestReq = z.infer<typeof DecideInstallRequestReq>

// ── Plugin Market Redesign: aggregated installed view & post-install readiness ────

/** A personal-scope installed plugin in GET /api/market/installed. */
export const InstalledPersonalItemDto = z.object({
  listing: ListingSummary,
  scene: PluginScene,
  capabilities: z.array(PluginCapability),
  readiness: PluginReadiness,
  source: MarketSource,
  teamName: z.string().nullable(),
  author: z.string().nullable(),
  enabled: z.boolean(),
  pinVersionId: z.string().nullable(),
  resolvedVersionId: z.string(),
  resolvedRevision: z.number().int(),
  latestRevision: z.number().int(),
  hasUpdate: z.boolean(),
  health: InstalledHealth,
  healthDetail: z.string().nullable(),
  banReason: z.string().nullable(),
  updatedAt: z.string(),
})
export type InstalledPersonalItemDto = z.infer<typeof InstalledPersonalItemDto>

/** Per-group status row inside an aggregated group-installed plugin. */
export const InstalledGroupTargetDto = z.object({
  groupId: z.string(),
  groupName: z.string(),
  enabled: z.boolean(),
  canManage: z.boolean(),
  pinVersionId: z.string().nullable(),
  resolvedVersionId: z.string(),
  resolvedRevision: z.number().int(),
  hasUpdate: z.boolean(),
  health: InstalledHealth,
  healthDetail: z.string().nullable(),
  pendingOwnerName: z.string().nullable().optional(),
  pendingMachineName: z.string().nullable().optional(),
})
export type InstalledGroupTargetDto = z.infer<typeof InstalledGroupTargetDto>

/** A plugin installed across one or more groups the caller belongs to. */
export const InstalledGroupPluginDto = z.object({
  listing: ListingSummary,
  scene: PluginScene,
  capabilities: z.array(PluginCapability),
  readiness: PluginReadiness,
  source: MarketSource,
  teamName: z.string().nullable(),
  latestRevision: z.number().int(),
  hasUpdate: z.boolean(),
  /** Highest-priority health across `groups` (needs-* > update-available > disabled > ready). */
  health: InstalledHealth,
  healthDetail: z.string().nullable(),
  banReason: z.string().nullable(),
  groups: z.array(InstalledGroupTargetDto),
})
export type InstalledGroupPluginDto = z.infer<typeof InstalledGroupPluginDto>

/** A team- or repo-scoped plugin visible to the caller. */
export const InstalledTeamPluginDto = z.object({
  listing: ListingSummary,
  scene: PluginScene,
  capabilities: z.array(PluginCapability),
  readiness: PluginReadiness,
  source: MarketSource,
  scope: z.enum(['team', 'repo']),
  scopeId: z.string(),
  teamId: z.string(),
  targetLabel: z.string(),
  groupsCount: z.number().int(),
  enabled: z.boolean(),
  canManage: z.boolean(),
  pinVersionId: z.string().nullable(),
  resolvedVersionId: z.string(),
  resolvedRevision: z.number().int(),
  latestRevision: z.number().int(),
  hasUpdate: z.boolean(),
  health: InstalledHealth,
  healthDetail: z.string().nullable(),
  banReason: z.string().nullable(),
  updatedAt: z.string(),
})
export type InstalledTeamPluginDto = z.infer<typeof InstalledTeamPluginDto>

/** GET /api/market/installed — aggregated view powering the 「已添加」 management page. */
export const MarketInstalledDto = z.object({
  todoCount: z.number().int(),
  pendingUpdates: z.number().int(),
  mine: z.array(InstalledPersonalItemDto),
  groups: z.array(InstalledGroupPluginDto),
  team: z.array(InstalledTeamPluginDto),
})
export type MarketInstalledDto = z.infer<typeof MarketInstalledDto>

/** One declared secret row in the post-install readiness checklist. */
export const ReadinessSecretItemDto = z.object({
  name: z.string(),
  title: z.string().nullable(),
  description: z.string(),
  url: z.string().nullable(),
  placeholder: z.string().nullable(),
  mode: SecretMode,
  required: z.boolean(),
  status: z.enum(['ok', 'unfilled', 'missing_def', 'blocked']),
  reason: z.string().nullable(),
  defId: z.string().nullable(),
  defScope: SecretScope.nullable(),
  action: z.enum(['fill_personal', 'fill_shared', 'create_and_fill', 'ask_admin', 'none']),
  reused: z.boolean(),
  viaConnector: z.boolean(),
})
export type ReadinessSecretItemDto = z.infer<typeof ReadinessSecretItemDto>

/** One bot-hosting machine's status for a CLI connector in the post-install readiness checklist. */
export const ReadinessConnectorMachineDto = z.object({
  machineId: z.string(),
  machineName: z.string(),
  ownerId: z.string(),
  ownerName: z.string(),
  own: z.boolean(),
  online: z.boolean(),
  hasConnectorsFeature: z.boolean(),
  state: ConnectorCliState,
  account: z.string().nullable(),
  botIds: z.array(z.string()),
  botNames: z.array(z.string()),
})
export type ReadinessConnectorMachineDto = z.infer<typeof ReadinessConnectorMachineDto>

export const ReadinessConnectorDto = z.object({
  kind: z.enum(['cli', 'login']),
  driver: ConnectorDriver.nullable(),
  loginPrompt: z.string().nullable(),
  ready: z.boolean(),
  groupId: z.string().nullable(),
  machines: z.array(ReadinessConnectorMachineDto),
})
export type ReadinessConnectorDto = z.infer<typeof ReadinessConnectorDto>

/** One bot-hosting machine's execution trust status for an `exec` plugin in the post-install readiness checklist. */
export const ReadinessTrustMachineDto = z.object({
  machineId: z.string(),
  machineName: z.string(),
  ownerId: z.string(),
  ownerName: z.string(),
  own: z.boolean(),
  online: z.boolean(),
  trustId: z.string().nullable(),
  status: z.enum(['unrequested', 'pending', 'allowed', 'denied']),
  botIds: z.array(z.string()),
  botNames: z.array(z.string()),
})
export type ReadinessTrustMachineDto = z.infer<typeof ReadinessTrustMachineDto>

export const ReadinessTrustDto = z.object({
  codeEnabled: z.boolean(),
  ready: z.boolean(),
  machines: z.array(ReadinessTrustMachineDto),
})
export type ReadinessTrustDto = z.infer<typeof ReadinessTrustDto>

/** GET /api/market/:id/readiness?scope=&scopeId= — in-place checklist after installing a plugin. */
export const MarketReadinessDto = z.object({
  listingId: z.string(),
  title: z.string(),
  versionId: z.string(),
  scope: InstallScope,
  scopeId: z.string(),
  targetLabel: z.string(),
  ready: z.boolean(),
  pendingSteps: z.number().int(),
  secrets: z.array(ReadinessSecretItemDto),
  reusedSecrets: z.array(ReusedSecretDto),
  connector: ReadinessConnectorDto.nullable(),
  trusts: ReadinessTrustDto.nullable(),
  tryPrompts: z.array(z.string()),
})
export type MarketReadinessDto = z.infer<typeof MarketReadinessDto>

/** POST /api/market/:id/readiness/action — in-place approve own machine trust or notify another machine's owner. */
export const MarketReadinessActionReq = z.object({
  action: z.enum(['allow_trust', 'notify_trust', 'notify_connector']),
  machineId: z.string(),
  scope: InstallScope.optional(),
  scopeId: z.string().optional(),
  versionId: z.string().optional(),
})
export type MarketReadinessActionReq = z.infer<typeof MarketReadinessActionReq>

export const MarketReadinessActionRes = z.object({
  ok: z.literal(true),
  trustId: z.string().optional(),
  notified: z.boolean().optional(),
})
export type MarketReadinessActionRes = z.infer<typeof MarketReadinessActionRes>
