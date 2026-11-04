import { z } from 'zod'

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
  updatedBy: z.string().nullable(),
  updatedAt: z.string(),
})
export type InstallDto = z.infer<typeof InstallDto>
export const InstallReq = z.object({
  enabled: z.boolean(),
  pinVersionId: z.string().nullable().default(null),
})
export type InstallReq = z.infer<typeof InstallReq>

/** GET …/installable — listings visible to the scope (platform, its team, its group) not installed there yet. */
export const InstallableDto = ListingSummary
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
  readme: z.string(),
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
/** POST /api/market/:id/check-upstream — a new draft when the upstream commit moved. */
export const CheckUpstreamRes = z.object({ changed: z.boolean(), commit: z.string() })
export type CheckUpstreamRes = z.infer<typeof CheckUpstreamRes>
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
/** Answer of POST /api/market and /api/market/import/github: the saved draft and hints (secrets, absolute paths). */
export const PublishRes = z.object({ listing: MyListingDto, warnings: z.array(z.string()) })
export type PublishRes = z.infer<typeof PublishRes>
