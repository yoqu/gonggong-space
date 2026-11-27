import {
  type InstalledGroupPluginDto,
  type InstalledGroupTargetDto,
  type InstalledHealth,
  type InstalledPersonalItemDto,
  type InstalledTargetHealthDto,
  type InstalledTeamPluginDto,
  type ListingSummary,
  type MarketInstalledDto,
  type MarketSource,
  type PluginManifest,
  pluginRunsCode,
  type SecretRequirement,
} from '@gonggong/protocol'
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Ctx } from '../../context.js'
import type { Db } from '../../db/client.js'
import {
  bots,
  connectorStates,
  groupBots,
  groupMembers,
  groups,
  installs,
  machines,
  personalSecrets,
  plugins,
  pluginTrusts,
  pluginVersions,
  repos,
  secrets,
  teamMembers,
  teams,
  users,
} from '../../db/schema.js'
import { t } from '../../i18n/index.js'
import { ownerProbe, probesOf } from '../connectors/state.js'
import { cliSpec } from '../connectors/sync.js'
import { nearest } from '../secrets/needs.js'
import { visibleSecrets } from '../secrets/resolve.js'
import { deriveListingMeta, isPluginManifest, teamGroupsCounts } from './meta.js'
import { ADMIN_ROLES, listingSummary, maintainedBy } from './service.js'

type Read = Pick<Db, 'select'>
type Me = { id: string; role: string; name?: string }

const HEALTH_RANK: Record<InstalledHealth, number> = {
  banned: 0,
  'needs-secret': 1,
  'needs-account': 2,
  'needs-trust': 3,
  'update-available': 4,
  disabled: 5,
  ready: 6,
}

const isTodoHealth = (h: InstalledHealth) =>
  h === 'needs-secret' || h === 'needs-account' || h === 'needs-trust'

export type GroupMachineBot = {
  machineId: string
  machineName: string
  ownerId: string
  ownerName: string
  own: boolean
  online: boolean
  hasConnectorsFeature: boolean
  botIds: string[]
  botNames: string[]
}

export async function scopeMachines(
  ctx: Ctx,
  groupIds: string[],
  userId: string,
): Promise<GroupMachineBot[]> {
  if (!groupIds.length) return []
  const botRows = await ctx.db
    .select({
      botId: bots.id,
      botName: bots.name,
      machineId: machines.id,
      machineName: machines.name,
      machineLabel: machines.label,
      ownerId: machines.ownerId,
      ownerName: users.name,
    })
    .from(groupBots)
    .innerJoin(bots, eq(bots.id, groupBots.botId))
    .innerJoin(machines, eq(machines.id, bots.machineId))
    .innerJoin(users, eq(users.id, machines.ownerId))
    .where(
      and(
        inArray(groupBots.groupId, groupIds),
        isNull(groupBots.removedAt),
        isNull(bots.deletedAt),
        isNull(machines.revokedAt),
      ),
    )
    .orderBy(asc(bots.name))
  const byMachine = new Map<string, GroupMachineBot>()
  for (const r of botRows) {
    const cur = byMachine.get(r.machineId) ?? {
      machineId: r.machineId,
      machineName: r.machineLabel ?? r.machineName,
      ownerId: r.ownerId,
      ownerName: r.ownerName,
      own: r.ownerId === userId,
      online: ctx.hub.isOnline(r.machineId),
      hasConnectorsFeature:
        ctx.hub.isOnline(r.machineId) && ctx.hub.features(r.machineId).includes('connectors'),
      botIds: [],
      botNames: [],
    }
    if (!cur.botIds.includes(r.botId)) {
      cur.botIds.push(r.botId)
      cur.botNames.push(r.botName)
    }
    byMachine.set(r.machineId, cur)
  }
  return [...byMachine.values()].sort(
    (a, b) => Number(b.own) - Number(a.own) || a.machineName.localeCompare(b.machineName),
  )
}

async function missingRequiredSecrets(
  ctx: Ctx,
  teamId: string,
  userId: string,
  specs: SecretRequirement[],
  groupId?: string,
): Promise<boolean> {
  const req = specs.filter((s) => s.required)
  if (!req.length) return false
  const now = ctx.now()
  const names = req.map((s) => s.name)
  const [defs, mine] = await Promise.all([
    groupId
      ? visibleSecrets(ctx.db, groupId)
      : ctx.db
          .select()
          .from(secrets)
          .where(
            or(eq(secrets.scope, 'platform'), and(eq(secrets.scope, 'team'), eq(secrets.teamId, teamId))),
          ),
    ctx.db
      .select()
      .from(personalSecrets)
      .where(
        and(
          eq(personalSecrets.userId, userId),
          eq(personalSecrets.teamId, teamId),
          inArray(personalSecrets.name, names),
        ),
      ),
  ])
  const live = defs.filter((r) => r.enabled && !(r.expiresAt && r.expiresAt <= now))
  return req.some((spec) => {
    const def = nearest(live, spec.name)
    if (!def) return true
    if (def.mode === 'shared') return !def.value
    const own = mine.find((m) => m.name === spec.name)
    return !own && !(def.mode === 'shared_overridable' && !!def.value)
  })
}

export async function evaluateGroupHealth(
  ctx: Ctx,
  userId: string,
  params: {
    groupId: string
    teamId: string
    listing: { id: string; name: string; type: string; status: string; banReason: string | null }
    manifest: PluginManifest | { name: string; description: string; secretSpecs?: SecretRequirement[] }
    resolvedVersionId: string
    latestRevision: number
    enabled: boolean
    hasUpdate: boolean
  },
): Promise<{
  health: InstalledHealth
  healthDetail: string | null
  pendingOwnerName: string | null
  pendingMachineName: string | null
}> {
  if (params.listing.status === 'banned')
    return {
      health: 'banned',
      healthDetail: params.listing.banReason || t('已封禁'),
      pendingOwnerName: null,
      pendingMachineName: null,
    }
  if (!params.enabled)
    return {
      health: 'disabled',
      healthDetail: t('已停用'),
      pendingOwnerName: null,
      pendingMachineName: null,
    }

  const plugin =
    params.listing.type === 'plugin' && isPluginManifest(params.manifest) ? params.manifest : null
  const specs = plugin ? (plugin.secretSpecs ?? []) : (params.manifest.secretSpecs ?? [])
  const fallbackSpecs =
    specs.length || !plugin
      ? specs
      : plugin.secrets.map((name) => ({ name, description: '', mode: 'shared' as const, required: true }))

  if (await missingRequiredSecrets(ctx, params.teamId, userId, fallbackSpecs, params.groupId)) {
    return {
      health: 'needs-secret',
      healthDetail: t('待填凭据'),
      pendingOwnerName: null,
      pendingMachineName: null,
    }
  }

  if (plugin && plugin.category === 'connector' && (plugin.connector?.cli || plugin.connector?.login)) {
    const spec = cliSpec(params.listing.name, plugin)
    if (spec) {
      const mList = await scopeMachines(ctx, [params.groupId], userId)
      const ready = mList.some(
        (m) => m.online && ownerProbe(probesOf(ctx, m.machineId), spec.connector)?.state === 'ready',
      )
      if (!ready) {
        const pending = mList[0] ?? null
        return {
          health: 'needs-account',
          healthDetail: pending
            ? t('等 {owner} 在 {machine} 上连接', {
                owner: pending.ownerName,
                machine: pending.machineName,
              })
            : t('待连接账号'),
          pendingOwnerName: pending?.ownerName ?? null,
          pendingMachineName: pending?.machineName ?? null,
        }
      }
    } else if (plugin.connector?.login) {
      const [st] = await ctx.db
        .select({ status: connectorStates.status })
        .from(connectorStates)
        .where(
          and(
            eq(connectorStates.userId, userId),
            eq(connectorStates.teamId, params.teamId),
            eq(connectorStates.name, params.listing.name),
          ),
        )
      if (st?.status !== 'ok') {
        return {
          health: 'needs-account',
          healthDetail: t('待连接账号'),
          pendingOwnerName: null,
          pendingMachineName: null,
        }
      }
    }
  }

  if (plugin && pluginRunsCode(plugin)) {
    const mList = await scopeMachines(ctx, [params.groupId], userId)
    if (mList.length) {
      const trusts = await ctx.db
        .select({ machineId: pluginTrusts.machineId, status: pluginTrusts.status })
        .from(pluginTrusts)
        .where(
          and(
            inArray(
              pluginTrusts.machineId,
              mList.map((m) => m.machineId),
            ),
            eq(pluginTrusts.versionId, params.resolvedVersionId),
          ),
        )
      const allowed = new Set(trusts.filter((r) => r.status === 'allowed').map((r) => r.machineId))
      const untrusted = mList.find((m) => !allowed.has(m.machineId))
      if (untrusted) {
        return {
          health: 'needs-trust',
          healthDetail: t('等 {owner} 在 {machine} 上授权', {
            owner: untrusted.ownerName,
            machine: untrusted.machineName,
          }),
          pendingOwnerName: untrusted.ownerName,
          pendingMachineName: untrusted.machineName,
        }
      }
    }
  }

  if (params.hasUpdate) {
    return {
      health: 'update-available',
      healthDetail: t('有更新 r{n}', { n: params.latestRevision }),
      pendingOwnerName: null,
      pendingMachineName: null,
    }
  }

  return {
    health: 'ready',
    healthDetail: t('已就绪'),
    pendingOwnerName: null,
    pendingMachineName: null,
  }
}

const currentV = alias(pluginVersions, 'inst_current')
const resolvedV = alias(pluginVersions, 'inst_resolved')
const authorUser = alias(users, 'inst_author')
const listingTeam = alias(teams, 'inst_listing_team')

const resolvedIdExpr = (db: Read) =>
  sql`case when ${and(
    eq(installs.scope, 'user'),
    isNull(installs.pinVersionId),
    maintainedBy(db, sql`${installs.scopeId}`),
  )} then ${plugins.versionId} else ${installs.resolvedVersionId} end`

const currentIdExpr = sql`coalesce(${plugins.listedVersionId}, ${plugins.versionId})`

const sourceOf = (l: { scope: string; teamId: string | null }, mine: Set<string>): MarketSource =>
  l.scope === 'platform' ? 'official' : l.teamId && mine.has(l.teamId) ? 'team' : 'public'

/**
 * GET /api/market/installed — aggregated view of personal, group, and team/repo installed plugins
 * with live per-group health status and todo/update counts.
 */
export async function marketInstalled(ctx: Ctx, me: Me): Promise<MarketInstalledDto> {
  const [myTeams, myGroups] = await Promise.all([
    ctx.db
      .select({ teamId: teamMembers.teamId, role: teamMembers.role, name: teams.name })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .where(eq(teamMembers.userId, me.id)),
    ctx.db
      .select({
        groupId: groups.id,
        groupName: groups.name,
        teamId: groups.teamId,
        isAdmin: groupMembers.isAdmin,
      })
      .from(groupMembers)
      .innerJoin(groups, eq(groups.id, groupMembers.groupId))
      .where(and(eq(groupMembers.userId, me.id), isNull(groups.archivedAt))),
  ])
  const myTeamIds = new Set(myTeams.map((x) => x.teamId))
  const teamIds = [...myTeamIds]
  const groupIds = myGroups.map((g) => g.groupId)
  const myRepos = teamIds.length
    ? await ctx.db
        .select({ id: repos.id, teamId: repos.teamId, name: repos.name })
        .from(repos)
        .where(inArray(repos.teamId, teamIds))
    : []
  const repoIds = myRepos.map((r) => r.id)

  const scopeCond = or(
    and(eq(installs.scope, 'user'), eq(installs.scopeId, me.id)),
    groupIds.length ? and(eq(installs.scope, 'group'), inArray(installs.scopeId, groupIds)) : undefined,
    teamIds.length ? and(eq(installs.scope, 'team'), inArray(installs.scopeId, teamIds)) : undefined,
    repoIds.length ? and(eq(installs.scope, 'repo'), inArray(installs.scopeId, repoIds)) : undefined,
  )

  const rows = await ctx.db
    .select({
      install: installs,
      listing: plugins,
      current: { id: currentV.id, revision: currentV.revision, manifest: currentV.manifest },
      resolved: { id: resolvedV.id, revision: resolvedV.revision, manifest: resolvedV.manifest },
      teamName: listingTeam.name,
      author: authorUser.name,
    })
    .from(installs)
    .innerJoin(plugins, eq(plugins.id, installs.listingId))
    .innerJoin(currentV, eq(currentV.id, currentIdExpr))
    .innerJoin(resolvedV, eq(resolvedV.id, resolvedIdExpr(ctx.db)))
    .leftJoin(listingTeam, eq(listingTeam.id, plugins.teamId))
    .leftJoin(authorUser, eq(authorUser.id, plugins.authorId))
    .where(scopeCond)
    .orderBy(asc(plugins.name))

  const groupMap = new Map(myGroups.map((g) => [g.groupId, g]))
  const teamMap = new Map(myTeams.map((x) => [x.teamId, x]))
  const repoMap = new Map(myRepos.map((r) => [r.id, r]))

  const teamListingIds = rows
    .filter((r) => r.install.scope === 'team' || r.install.scope === 'repo')
    .map((r) => r.listing.id)
  const teamCounts = await teamGroupsCounts(ctx.db, myTeamIds, [...new Set(teamListingIds)])

  const mine: InstalledPersonalItemDto[] = []
  const groupBuckets = new Map<
    string,
    {
      listing: ListingSummary
      meta: ReturnType<typeof deriveListingMeta>
      source: MarketSource
      teamName: string | null
      latestRevision: number
      banReason: string | null
      groups: InstalledGroupTargetDto[]
    }
  >()
  const team: InstalledTeamPluginDto[] = []

  for (const r of rows) {
    const source = sourceOf(r.listing, myTeamIds)
    const meta = deriveListingMeta(r.listing, r.resolved.manifest, source)
    const summary = listingSummary(r.listing, r.current)
    const hasUpdate =
      !!r.install.pinVersionId &&
      !!r.listing.listedVersionId &&
      r.resolved.id !== r.listing.listedVersionId &&
      r.current.revision > r.resolved.revision

    if (r.install.scope === 'user') {
      let health: InstalledHealth = 'ready'
      let healthDetail: string | null = t('已就绪')
      if (r.listing.status === 'banned') {
        health = 'banned'
        healthDetail = r.listing.banReason || t('已封禁')
      } else if (!r.install.enabled) {
        health = 'disabled'
        healthDetail = t('已停用')
      } else if (meta.secretSpecs.some((s) => s.required)) {
        const secretTeamId =
          r.listing.teamId && myTeamIds.has(r.listing.teamId) ? r.listing.teamId : teamIds[0]
        if (secretTeamId && (await missingRequiredSecrets(ctx, secretTeamId, me.id, meta.secretSpecs))) {
          health = 'needs-secret'
          healthDetail = t('待填凭据')
        }
      }
      if (health === 'ready' && hasUpdate) {
        health = 'update-available'
        healthDetail = t('有更新 r{n}', { n: r.current.revision })
      }
      mine.push({
        listing: summary,
        scene: meta.scene,
        capabilities: meta.capabilities,
        readiness: meta.readiness,
        source,
        teamName: r.teamName,
        author: r.author,
        enabled: r.install.enabled,
        pinVersionId: r.install.pinVersionId,
        resolvedVersionId: r.resolved.id,
        resolvedRevision: r.resolved.revision,
        latestRevision: r.current.revision,
        hasUpdate,
        health,
        healthDetail,
        banReason: r.listing.banReason,
        updatedAt: r.install.updatedAt.toISOString(),
      })
      continue
    }

    if (r.install.scope === 'group') {
      const g = groupMap.get(r.install.scopeId)
      if (!g) continue
      const evalRes = await evaluateGroupHealth(ctx, me.id, {
        groupId: g.groupId,
        teamId: g.teamId,
        listing: r.listing,
        manifest: r.resolved.manifest,
        resolvedVersionId: r.resolved.id,
        latestRevision: r.current.revision,
        enabled: r.install.enabled,
        hasUpdate,
      })
      const bucket = groupBuckets.get(r.listing.id) ?? {
        listing: summary,
        meta,
        source,
        teamName: r.teamName,
        latestRevision: r.current.revision,
        banReason: r.listing.banReason,
        groups: [],
      }
      bucket.groups.push({
        groupId: g.groupId,
        groupName: g.groupName,
        enabled: r.install.enabled,
        canManage: g.isAdmin,
        pinVersionId: r.install.pinVersionId,
        resolvedVersionId: r.resolved.id,
        resolvedRevision: r.resolved.revision,
        hasUpdate,
        health: evalRes.health,
        healthDetail: evalRes.healthDetail,
        pendingOwnerName: evalRes.pendingOwnerName,
        pendingMachineName: evalRes.pendingMachineName,
      })
      groupBuckets.set(r.listing.id, bucket)
      continue
    }

    const repo = r.install.scope === 'repo' ? repoMap.get(r.install.scopeId) : undefined
    const tid = repo ? repo.teamId : r.install.scopeId
    const tm = teamMap.get(tid)
    if (!tm) continue
    const targetLabel = repo ? `${tm.name} / ${repo.name}` : tm.name
    let health: InstalledHealth = 'ready'
    let healthDetail: string | null = t('已就绪')
    if (r.listing.status === 'banned') {
      health = 'banned'
      healthDetail = r.listing.banReason || t('已封禁')
    } else if (!r.install.enabled) {
      health = 'disabled'
      healthDetail = t('已停用')
    } else if (await missingRequiredSecrets(ctx, tid, me.id, meta.secretSpecs)) {
      health = 'needs-secret'
      healthDetail = t('待填凭据')
    } else if (hasUpdate) {
      health = 'update-available'
      healthDetail = t('有更新 r{n}', { n: r.current.revision })
    }
    team.push({
      listing: summary,
      scene: meta.scene,
      capabilities: meta.capabilities,
      readiness: meta.readiness,
      source,
      scope: r.install.scope as 'team' | 'repo',
      scopeId: r.install.scopeId,
      teamId: tid,
      targetLabel,
      groupsCount: teamCounts.get(r.listing.id) ?? 0,
      enabled: r.install.enabled,
      canManage: ADMIN_ROLES.includes(tm.role),
      pinVersionId: r.install.pinVersionId,
      resolvedVersionId: r.resolved.id,
      resolvedRevision: r.resolved.revision,
      latestRevision: r.current.revision,
      hasUpdate,
      health,
      healthDetail,
      banReason: r.listing.banReason,
      updatedAt: r.install.updatedAt.toISOString(),
    })
  }

  const groupsList: InstalledGroupPluginDto[] = [...groupBuckets.values()].map((b) => {
    b.groups.sort(
      (a, c) => HEALTH_RANK[a.health] - HEALTH_RANK[c.health] || a.groupName.localeCompare(c.groupName),
    )
    const primary = b.groups[0]
    return {
      listing: b.listing,
      scene: b.meta.scene,
      capabilities: b.meta.capabilities,
      readiness: b.meta.readiness,
      source: b.source,
      teamName: b.teamName,
      latestRevision: b.latestRevision,
      hasUpdate: b.groups.some((g) => g.hasUpdate),
      health: primary?.health ?? 'ready',
      healthDetail: primary?.healthDetail ?? null,
      banReason: b.banReason,
      groups: b.groups,
    }
  })

  mine.sort(
    (a, b) => HEALTH_RANK[a.health] - HEALTH_RANK[b.health] || a.listing.title.localeCompare(b.listing.title),
  )
  groupsList.sort(
    (a, b) => HEALTH_RANK[a.health] - HEALTH_RANK[b.health] || a.listing.title.localeCompare(b.listing.title),
  )
  team.sort(
    (a, b) => HEALTH_RANK[a.health] - HEALTH_RANK[b.health] || a.listing.title.localeCompare(b.listing.title),
  )

  const todoCount =
    mine.filter((i) => isTodoHealth(i.health)).length +
    groupsList.filter((i) => isTodoHealth(i.health)).length +
    team.filter((i) => isTodoHealth(i.health)).length
  const pendingUpdates =
    mine.filter((i) => i.hasUpdate).length +
    groupsList.filter((i) => i.hasUpdate).length +
    team.filter((i) => i.hasUpdate).length

  return { todoCount, pendingUpdates, mine, groups: groupsList, team }
}

/** Computes live health pills for `MarketListingDetailDto.installedHealth`. */
export async function listingInstalledHealth(
  ctx: Ctx,
  userId: string,
  listing: typeof plugins.$inferSelect,
  targets: { scope: 'user' | 'group' | 'team' | 'repo'; scopeId: string; label: string }[],
  latestRevision: number,
): Promise<InstalledTargetHealthDto[]> {
  if (!targets.length) return []
  const installRows = await ctx.db
    .select({
      install: installs,
      resolved: { id: resolvedV.id, revision: resolvedV.revision, manifest: resolvedV.manifest },
    })
    .from(installs)
    .innerJoin(resolvedV, eq(resolvedV.id, installs.resolvedVersionId))
    .where(eq(installs.listingId, listing.id))
  const byKey = new Map(installRows.map((r) => [`${r.install.scope}:${r.install.scopeId}`, r]))
  const groupIds = targets.filter((x) => x.scope === 'group').map((x) => x.scopeId)
  const gRows = groupIds.length
    ? await ctx.db
        .select({ id: groups.id, teamId: groups.teamId })
        .from(groups)
        .where(inArray(groups.id, groupIds))
    : []
  const groupTeam = new Map(gRows.map((g) => [g.id, g.teamId]))

  const out: InstalledTargetHealthDto[] = []
  for (const target of targets) {
    const row = byKey.get(`${target.scope}:${target.scopeId}`)
    if (!row) continue
    const hasUpdate =
      !!row.install.pinVersionId &&
      !!listing.listedVersionId &&
      row.resolved.id !== listing.listedVersionId &&
      latestRevision > row.resolved.revision
    if (target.scope === 'group') {
      const teamId = groupTeam.get(target.scopeId)
      if (!teamId) continue
      const ev = await evaluateGroupHealth(ctx, userId, {
        groupId: target.scopeId,
        teamId,
        listing,
        manifest: row.resolved.manifest,
        resolvedVersionId: row.resolved.id,
        latestRevision,
        enabled: row.install.enabled,
        hasUpdate,
      })
      out.push({ ...target, enabled: row.install.enabled, health: ev.health, healthDetail: ev.healthDetail })
    } else if (target.scope === 'team') {
      const meta = deriveListingMeta(listing, row.resolved.manifest)
      let health: InstalledHealth = 'ready'
      let healthDetail: string | null = t('已就绪')
      if (listing.status === 'banned') {
        health = 'banned'
        healthDetail = listing.banReason || t('已封禁')
      } else if (!row.install.enabled) {
        health = 'disabled'
        healthDetail = t('已停用')
      } else if (await missingRequiredSecrets(ctx, target.scopeId, userId, meta.secretSpecs)) {
        health = 'needs-secret'
        healthDetail = t('待填凭据')
      } else if (hasUpdate) {
        health = 'update-available'
        healthDetail = t('有更新 r{n}', { n: latestRevision })
      }
      out.push({ ...target, enabled: row.install.enabled, health, healthDetail })
    } else {
      const health: InstalledHealth =
        listing.status === 'banned'
          ? 'banned'
          : !row.install.enabled
            ? 'disabled'
            : hasUpdate
              ? 'update-available'
              : 'ready'
      const healthDetail =
        health === 'banned'
          ? listing.banReason || t('已封禁')
          : health === 'disabled'
            ? t('已停用')
            : health === 'update-available'
              ? t('有更新 r{n}', { n: latestRevision })
              : t('已就绪')
      out.push({ ...target, enabled: row.install.enabled, health, healthDetail })
    }
  }
  return out
}
