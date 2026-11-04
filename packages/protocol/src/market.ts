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
