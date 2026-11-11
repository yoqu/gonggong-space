import { z } from 'zod'
import { PluginMcp, PluginPermission } from './plugins.js'

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
export const SkillListingManifest = z.object({ name: z.string(), description: z.string() })
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
})
export type ListingSummary = z.infer<typeof ListingSummary>

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

/**
 * GET /api/market?q=&type=&source= — listings with an approved version the caller may see, newest first.
 * Installs follow `listedVersionId` (latest approved), not the author's latest upload.
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
  readme: z.string(),
  /** A plugin's permissions and MCP servers (plan 插件扩展点 §9), shown before installing; empty for skills. */
  permissions: z.array(PluginPermission).default([]),
  mcp: z.array(PluginMcp).default([]),
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
})
export type InstallRequestDto = z.infer<typeof InstallRequestDto>
export const DecideInstallRequestReq = ReviewReq
export type DecideInstallRequestReq = z.infer<typeof DecideInstallRequestReq>
