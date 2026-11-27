import {
  CreateSecretReq,
  derivePluginCapabilities,
  derivePluginExamples,
  derivePluginFeatured,
  derivePluginReadiness,
  derivePluginScene,
  type InstallScope,
  isMarketHiddenCategory,
  type ListingType,
  type MarketSource,
  type PluginCapability,
  type PluginManifest,
  type PluginPermission,
  type PluginReadiness,
  type PluginScene,
  pluginInGroups,
  type ReusedSecretDto,
  type SecretRequirement,
  type SecretScope,
  type SkillListingManifest,
  secretSpecsOf,
} from '@gonggong/protocol'
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import type { Db } from '../../db/client.js'
import {
  auditLogs,
  groupRepos,
  groups,
  installs,
  type plugins,
  repos,
  secrets,
  teams,
} from '../../db/schema.js'
import { t } from '../../i18n/index.js'
import { HttpError } from '../../lib/errors.js'
import type { Layer } from '../mcp/service.js'
import { nearest, specDescription } from '../secrets/needs.js'
import { visibleSecrets } from '../secrets/resolve.js'
import { createSecret, reservedName } from '../secrets/service.js'

type Read = Pick<Db, 'select'>
type ListingRow = typeof plugins.$inferSelect
type AnyManifest = PluginManifest | SkillListingManifest

export type DerivedListingMeta = {
  scene: PluginScene
  capabilities: PluginCapability[]
  readiness: PluginReadiness
  featured: boolean
  examples: string[]
  permissions: PluginPermission[]
  secretSpecs: SecretRequirement[]
}

export const isPluginManifest = (m: AnyManifest): m is PluginManifest => 'category' in m

/** True for Agent engine & Provider preset plugins hidden from default Plugin Market listings. */
export function isSystemListing(listing: Pick<ListingRow, 'type'>, manifest: AnyManifest): boolean {
  if (listing.type !== 'plugin' || !isPluginManifest(manifest)) return false
  return isMarketHiddenCategory(manifest.category) || !pluginInGroups(manifest)
}

export function manifestSecretSpecs(manifest: AnyManifest): SecretRequirement[] {
  return isPluginManifest(manifest) ? secretSpecsOf(manifest) : (manifest.secretSpecs ?? [])
}

export function deriveListingMeta(
  listing: Pick<ListingRow, 'type' | 'name' | 'scope'>,
  manifest: AnyManifest,
  source?: MarketSource,
  readme?: string,
): DerivedListingMeta {
  const plugin = listing.type === 'plugin' && isPluginManifest(manifest) ? manifest : null
  const input = {
    type: listing.type as ListingType,
    name: listing.name,
    title: plugin ? plugin.title : listing.name,
    description: manifest.description,
    category: plugin?.category ?? null,
    entry: plugin?.entry ?? null,
    scene: manifest.scene,
    capabilities: plugin?.capabilities,
    permissions: plugin?.permissions ?? [],
    contributes: plugin?.contributes,
    secrets: plugin?.secrets,
    secretSpecs: manifestSecretSpecs(manifest),
    connector: plugin?.connector,
    templates: plugin?.templates,
    artifact: plugin?.artifact,
    examples: manifest.examples,
    featured: plugin?.featured,
    layer: listing.scope,
    source,
  }
  return {
    scene: derivePluginScene(input),
    capabilities: derivePluginCapabilities(input),
    readiness: derivePluginReadiness(input),
    featured: derivePluginFeatured(input),
    examples: derivePluginExamples({ connector: plugin?.connector, examples: manifest.examples }, readme),
    permissions: plugin?.permissions ?? [],
    secretSpecs: input.secretSpecs,
  }
}

/**
 * Counts how many active non-DM groups in the caller's teams currently use each listing
 * (through enabled group, team, or primary-repo installs).
 */
export async function teamGroupsCounts(
  db: Read,
  teamIds: Set<string>,
  listingIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (!teamIds.size || !listingIds.length) return out
  const ids = [...teamIds]
  const activeGroups = await db
    .select({ id: groups.id, teamId: groups.teamId })
    .from(groups)
    .where(and(inArray(groups.teamId, ids), isNull(groups.archivedAt), eq(groups.kind, 'group')))
  if (!activeGroups.length) return out
  const groupIds = activeGroups.map((g) => g.id)
  const [teamRepos, primaryBindings] = await Promise.all([
    db
      .select({ id: repos.id, key: repos.key, teamId: repos.teamId })
      .from(repos)
      .where(inArray(repos.teamId, ids)),
    db
      .select({ groupId: groupRepos.groupId, url: groupRepos.url })
      .from(groupRepos)
      .where(and(inArray(groupRepos.groupId, groupIds), eq(groupRepos.isPrimary, true))),
  ])
  const repoIds = teamRepos.map((r) => r.id)
  const rows = await db
    .select({
      listingId: installs.listingId,
      scope: installs.scope,
      scopeId: installs.scopeId,
    })
    .from(installs)
    .where(
      and(
        inArray(installs.listingId, listingIds),
        eq(installs.enabled, true),
        or(
          and(eq(installs.scope, 'group'), inArray(installs.scopeId, groupIds)),
          and(eq(installs.scope, 'team'), inArray(installs.scopeId, ids)),
          repoIds.length ? and(eq(installs.scope, 'repo'), inArray(installs.scopeId, repoIds)) : undefined,
        ),
      ),
    )
  const groupsByTeam = new Map<string, string[]>()
  for (const g of activeGroups) groupsByTeam.set(g.teamId, [...(groupsByTeam.get(g.teamId) ?? []), g.id])
  const groupsByRepo = new Map<string, string[]>()
  if (teamRepos.length && primaryBindings.length) {
    const groupTeam = new Map(activeGroups.map((g) => [g.id, g.teamId]))
    for (const b of primaryBindings) {
      const tid = groupTeam.get(b.groupId)
      const hit = teamRepos.find((r) => r.teamId === tid && b.url.toLowerCase().includes(r.key.toLowerCase()))
      if (hit) groupsByRepo.set(hit.id, [...(groupsByRepo.get(hit.id) ?? []), b.groupId])
    }
  }
  const sets = new Map<string, Set<string>>()
  for (const r of rows) {
    const bucket = sets.get(r.listingId) ?? new Set<string>()
    sets.set(r.listingId, bucket)
    if (r.scope === 'group') bucket.add(r.scopeId)
    else if (r.scope === 'team') for (const gid of groupsByTeam.get(r.scopeId) ?? []) bucket.add(gid)
    else if (r.scope === 'repo') for (const gid of groupsByRepo.get(r.scopeId) ?? []) bucket.add(gid)
  }
  for (const [lid, s] of sets) out.set(lid, s.size)
  return out
}

async function scopeLabels(
  db: Read,
  ids: { teamIds: string[]; groupIds: string[] },
): Promise<{ team: Map<string, string>; group: Map<string, string> }> {
  const [tRows, gRows] = await Promise.all([
    ids.teamIds.length
      ? db.select({ id: teams.id, name: teams.name }).from(teams).where(inArray(teams.id, ids.teamIds))
      : [],
    ids.groupIds.length
      ? db.select({ id: groups.id, name: groups.name }).from(groups).where(inArray(groups.id, ids.groupIds))
      : [],
  ])
  return {
    team: new Map(tRows.map((r) => [r.id, r.name])),
    group: new Map(gRows.map((r) => [r.id, r.name])),
  }
}

async function visibleTargetSecrets(
  db: Read,
  target: { scope: InstallScope; scopeId: string; teamId: string | null; groupId: string | null },
) {
  if (target.scope === 'group' && target.groupId) return visibleSecrets(db, target.groupId)
  if (!target.teamId) return []
  return db
    .select()
    .from(secrets)
    .where(
      or(eq(secrets.scope, 'platform'), and(eq(secrets.scope, 'team'), eq(secrets.teamId, target.teamId))),
    )
}

/**
 * Ensures every secret declared in `specs` has a definition visible to `target`:
 * - Missing definitions are auto-created in the target's appropriate layer (personal → team; shared → group/team).
 * - Same-named definitions that ALREADY exist in the target or an inherited scope are silently reused without
 *   overwriting or failing, and returned in `reusedSecrets` (surfaced ONLY in 「开发者信息」).
 */
export async function ensureInstallSecrets(
  ctx: Ctx,
  target: { scope: InstallScope; scopeId: string; teamId: string | null; groupId: string | null },
  listing: { id: string; name: string },
  specs: SecretRequirement[],
  actorId: string,
  isUpdate: boolean,
): Promise<ReusedSecretDto[]> {
  if (!specs.length || target.scope === 'user' || !target.teamId) return []
  const existing = await visibleTargetSecrets(ctx.db, target)
  const labels = await scopeLabels(ctx.db, {
    teamIds: [...new Set([target.teamId, ...existing.flatMap((r) => (r.teamId ? [r.teamId] : []))])],
    groupIds: [
      ...new Set([
        ...(target.groupId ? [target.groupId] : []),
        ...existing.flatMap((r) => (r.groupId ? [r.groupId] : [])),
      ]),
    ],
  })
  const targetLabel =
    target.scope === 'group' && target.groupId
      ? (labels.group.get(target.groupId) ?? '')
      : (labels.team.get(target.teamId) ?? '')

  // On updates to an existing install, avoid flagging secrets that this listing itself auto-created earlier.
  const ownDefIds = new Set<string>()
  if (isUpdate && existing.length) {
    const defLogs = await ctx.db
      .select({ detail: auditLogs.detail })
      .from(auditLogs)
      .where(
        and(eq(auditLogs.action, 'secret.define'), sql`${auditLogs.detail}->>'listingId' = ${listing.id}`),
      )
    for (const row of defLogs) {
      const id = (row.detail as Record<string, unknown>)?.id
      if (typeof id === 'string') ownDefIds.add(id)
    }
  }

  const labelOf = (r: { scope: string; teamId: string | null; groupId: string | null }) =>
    r.scope === 'group'
      ? (labels.group.get(r.groupId ?? '') ?? '')
      : r.scope === 'team'
        ? (labels.team.get(r.teamId ?? '') ?? '')
        : t('平台')

  const reused: ReusedSecretDto[] = []
  for (const spec of specs) {
    if (reservedName(spec.name)) continue
    const hit = nearest(existing, spec.name)
    if (hit) {
      if (!ownDefIds.has(hit.id))
        reused.push({
          name: spec.name,
          existingScope: hit.scope as SecretScope,
          existingScopeLabel: labelOf(hit),
          ...(targetLabel && { targetLabel }),
        })
      continue
    }
    const layer: Layer =
      spec.mode === 'personal' || target.scope !== 'group'
        ? { scope: 'team', teamId: target.teamId, groupId: null }
        : { scope: 'group', teamId: target.teamId, groupId: target.groupId }
    try {
      const created = await createSecret(
        ctx,
        layer,
        CreateSecretReq.parse({
          name: spec.name,
          description: specDescription(spec),
          mode: spec.mode,
        }),
        actorId,
        { plugin: listing.name, listingId: listing.id },
      )
      existing.push(created)
      ownDefIds.add(created.id)
    } catch (e) {
      if (e instanceof HttpError && e.code === 'conflict') {
        reused.push({
          name: spec.name,
          existingScope: layer.scope as SecretScope,
          existingScopeLabel: labelOf(layer),
          ...(targetLabel && { targetLabel }),
        })
      } else {
        throw e
      }
    }
  }
  return reused
}

/**
 * Retrieves reused secrets recorded during `install.put` for a listing across the given targets,
 * filtered to names still declared in `specs` so 「开发者信息」 stays accurate without a schema migration.
 */
export async function recordedReusedSecrets(
  db: Read,
  listingId: string,
  specs: SecretRequirement[],
  targets: { scope: InstallScope; scopeId: string }[],
): Promise<ReusedSecretDto[]> {
  if (!specs.length || !targets.length) return []
  const specNames = new Set(specs.map((s) => s.name))
  const rows = await db
    .select({ detail: auditLogs.detail })
    .from(auditLogs)
    .where(and(eq(auditLogs.action, 'install.put'), sql`${auditLogs.detail}->>'listingId' = ${listingId}`))
    .orderBy(desc(auditLogs.createdAt))
    .limit(50)
  const targetKeys = new Set(targets.map((x) => `${x.scope}:${x.scopeId}`))
  const seenTargets = new Set<string>()
  const out: ReusedSecretDto[] = []
  const seenKey = new Set<string>()
  for (const row of rows) {
    const d = row.detail as Record<string, unknown>
    const tKey = `${String(d.scope ?? '')}:${String(d.scopeId ?? '')}`
    if (!targetKeys.has(tKey) || seenTargets.has(tKey)) continue
    seenTargets.add(tKey)
    const list = Array.isArray(d.reusedSecrets) ? (d.reusedSecrets as ReusedSecretDto[]) : []
    for (const item of list) {
      if (!item || typeof item.name !== 'string' || !specNames.has(item.name)) continue
      const k = `${item.name}:${item.existingScope}:${item.targetLabel ?? ''}`
      if (seenKey.has(k)) continue
      seenKey.add(k)
      out.push(item)
    }
  }
  return out
}
