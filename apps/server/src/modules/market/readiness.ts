import {
  type MarketReadinessActionReq,
  type MarketReadinessActionRes,
  type MarketReadinessDto,
  pluginRunsCode,
  type ReadinessConnectorDto,
  type ReadinessConnectorMachineDto,
  type ReadinessSecretItemDto,
  type ReadinessTrustDto,
  type ReadinessTrustMachineDto,
  type SecretMode,
  type SecretScope,
  type SkillFile,
} from '@gonggong/protocol'
import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import {
  bots,
  connectorStates,
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
} from '../../db/schema.js'
import { t } from '../../i18n/index.js'
import { audit } from '../../lib/audit.js'
import { fail } from '../../lib/errors.js'
import { idParam } from '../../lib/ids.js'
import { sysParams } from '../admin/params.js'
import { isLayerAdmin } from '../agent-tools/layers.js'
import { ownerProbe, probesOf, stateOf } from '../connectors/state.js'
import { cliSpec } from '../connectors/sync.js'
import { requireMember } from '../groups/service.js'
import type { Layer } from '../mcp/service.js'
import { notify, resolveNotifications } from '../notifications/notify.js'
import { nearest } from '../secrets/needs.js'
import { type SecretRow, blocked as secretBlocked, visibleSecrets } from '../secrets/resolve.js'
import { requireTeam } from '../teams/service.js'
import { scopeMachines } from './installed.js'
import { deriveListingMeta, isPluginManifest, recordedReusedSecrets } from './meta.js'
import { ADMIN_ROLES, maintainedBy } from './service.js'

type Me = { id: string; role: string; name?: string }

async function resolveReadinessScope(
  ctx: Ctx,
  me: Me,
  scope: 'user' | 'group' | 'team' | 'repo',
  scopeId: string,
): Promise<{
  scope: 'user' | 'group' | 'team' | 'repo'
  scopeId: string
  teamId: string | null
  groupIds: string[]
  targetLabel: string
}> {
  if (scope === 'user') {
    if (scopeId !== me.id) fail('forbidden', '未授权')
    const [tm] = await ctx.db
      .select({ teamId: teamMembers.teamId })
      .from(teamMembers)
      .where(eq(teamMembers.userId, me.id))
      .limit(1)
    return { scope: 'user', scopeId: me.id, teamId: tm?.teamId ?? null, groupIds: [], targetLabel: '' }
  }
  if (scope === 'group') {
    const { group } = await requireMember(ctx, scopeId, me.id)
    return {
      scope: 'group',
      scopeId: group.id,
      teamId: group.teamId,
      groupIds: [group.id],
      targetLabel: group.name,
    }
  }
  if (scope === 'team') {
    const { team } = await requireTeam(ctx, me.id, scopeId)
    const gs = await ctx.db
      .select({ id: groups.id })
      .from(groups)
      .innerJoin(groupMembers, and(eq(groupMembers.groupId, groups.id), eq(groupMembers.userId, me.id)))
      .where(and(eq(groups.teamId, team.id), isNull(groups.archivedAt)))
    return {
      scope: 'team',
      scopeId: team.id,
      teamId: team.id,
      groupIds: gs.map((g) => g.id),
      targetLabel: team.name,
    }
  }
  const [repo] = await ctx.db
    .select({ id: repos.id, teamId: repos.teamId, name: repos.name })
    .from(repos)
    .where(eq(repos.id, idParam(scopeId, '仓库不存在')))
  if (!repo) return fail('not_found', '仓库不存在')
  const { team } = await requireTeam(ctx, me.id, repo.teamId)
  const gs = await ctx.db
    .select({ id: groups.id })
    .from(groups)
    .innerJoin(groupMembers, and(eq(groupMembers.groupId, groups.id), eq(groupMembers.userId, me.id)))
    .where(and(eq(groups.teamId, team.id), isNull(groups.archivedAt)))
  return {
    scope: 'repo',
    scopeId: repo.id,
    teamId: team.id,
    groupIds: gs.map((g) => g.id),
    targetLabel: `${team.name} / ${repo.name}`,
  }
}

async function loadReadableListingVersion(ctx: Ctx, me: Me, listingId: string, preferredVersionId?: string) {
  const [listing] = await ctx.db
    .select()
    .from(plugins)
    .where(eq(plugins.id, idParam(listingId, '条目不存在')))
  if (!listing) return fail('not_found', '条目不存在')
  const memberships = await ctx.db
    .select({ id: teamMembers.teamId, role: teamMembers.role })
    .from(teamMembers)
    .where(eq(teamMembers.userId, me.id))
  const myTeams = new Set(memberships.map((r) => r.id))
  const [maintained] = await ctx.db
    .select({ id: plugins.id })
    .from(plugins)
    .where(and(eq(plugins.id, listing.id), maintainedBy(ctx.db, me.id)))
  const canReview =
    listing.visibility === 'team'
      ? memberships.some((m) => m.id === listing.teamId && ADMIN_ROLES.includes(m.role))
      : me.role === 'sysadmin'
  const privileged = !!maintained || canReview
  const visible =
    privileged ||
    (!!listing.listedVersionId &&
      listing.status !== 'banned' &&
      (listing.scope === 'platform' ||
        (listing.scope === 'team' &&
          (listing.visibility === 'public' || (!!listing.teamId && myTeams.has(listing.teamId))))))
  if (!visible) return fail('not_found', '条目不存在')
  const vid = preferredVersionId
    ? idParam(preferredVersionId, '版本不存在')
    : (listing.listedVersionId ?? (privileged ? listing.versionId : null))
  if (!vid) return fail('not_found', '版本不存在')
  const [version] = await ctx.db
    .select({
      id: pluginVersions.id,
      revision: pluginVersions.revision,
      manifest: pluginVersions.manifest,
      files: pluginVersions.files,
    })
    .from(pluginVersions)
    .where(
      and(
        eq(pluginVersions.id, vid),
        eq(pluginVersions.pluginId, listing.id),
        privileged ? undefined : eq(pluginVersions.reviewStatus, 'approved'),
      ),
    )
  if (!version) return fail('not_found', '版本不存在')
  return { listing, version }
}

/**
 * GET /api/market/:id/readiness?scope=&scopeId= — in-place Step 2 readiness checklist:
 * secrets (with silently reused defs), CLI connector machines, `exec` trust machines, and sample prompts.
 */
export async function marketReadiness(
  ctx: Ctx,
  me: Me,
  listingId: string,
  q: { scope?: 'user' | 'group' | 'team' | 'repo'; scopeId?: string; versionId?: string },
): Promise<MarketReadinessDto> {
  const scope = q.scope ?? 'user'
  const scopeId = q.scopeId ?? me.id
  const resolvedScope = await resolveReadinessScope(ctx, me, scope, scopeId)
  const [inst] = await ctx.db
    .select({ resolvedVersionId: installs.resolvedVersionId })
    .from(installs)
    .where(
      and(
        eq(installs.listingId, idParam(listingId, '条目不存在')),
        eq(installs.scope, resolvedScope.scope),
        eq(installs.scopeId, resolvedScope.scopeId),
      ),
    )
  const { listing, version } = await loadReadableListingVersion(
    ctx,
    me,
    listingId,
    q.versionId ?? inst?.resolvedVersionId,
  )
  const files = version.files as SkillFile[]
  const plugin = listing.type === 'plugin' && isPluginManifest(version.manifest) ? version.manifest : null
  const readmePath = !plugin ? 'SKILL.md' : plugin.entry ? `skills/${plugin.entry}/SKILL.md` : 'README.md'
  const readme = files.find((f) => f.path === readmePath && f.encoding === 'utf8')?.content ?? ''
  const meta = deriveListingMeta(listing, version.manifest, undefined, readme)

  const reusedSecrets = await recordedReusedSecrets(ctx.db, listing.id, meta.secretSpecs, [
    { scope: resolvedScope.scope, scopeId: resolvedScope.scopeId },
  ])
  const reusedNames = new Set(reusedSecrets.map((r) => r.name))
  const now = ctx.now()
  const visibleDefs: SecretRow[] =
    resolvedScope.scope === 'group'
      ? await visibleSecrets(ctx.db, resolvedScope.scopeId)
      : resolvedScope.teamId
        ? await ctx.db
            .select()
            .from(secrets)
            .where(
              or(
                eq(secrets.scope, 'platform'),
                and(eq(secrets.scope, 'team'), eq(secrets.teamId, resolvedScope.teamId)),
              ),
            )
        : []
  const liveDefs = visibleDefs.filter((r) => r.enabled && !(r.expiresAt && r.expiresAt <= now))
  const specNames = meta.secretSpecs.map((s) => s.name)
  const minePersonal =
    resolvedScope.teamId && specNames.length
      ? await ctx.db
          .select()
          .from(personalSecrets)
          .where(
            and(
              eq(personalSecrets.userId, me.id),
              eq(personalSecrets.teamId, resolvedScope.teamId),
              inArray(personalSecrets.name, specNames),
            ),
          )
      : []

  const adminCache = new Map<string, Promise<boolean>>()
  const canAdmin = (l: Layer) => {
    const k = `${l.scope}:${l.teamId}:${l.groupId}`
    let p = adminCache.get(k)
    if (!p) {
      p = isLayerAdmin(ctx, me.id, l)
      adminCache.set(k, p)
    }
    return p
  }
  const isConnector = !!plugin && plugin.category === 'connector'

  const secretItems: ReadinessSecretItemDto[] = []
  for (const spec of meta.secretSpecs) {
    const own = minePersonal.find((m) => m.name === spec.name)
    const def = nearest(liveDefs, spec.name)
    const anyDef = def ?? nearest(visibleDefs, spec.name)
    let status: ReadinessSecretItemDto['status'] = 'ok'
    let reason: string | null = null
    let action: ReadinessSecretItemDto['action'] = 'none'
    const mode = (def?.mode ?? spec.mode) as SecretMode

    if (!def) {
      if (anyDef) {
        status = 'blocked'
        reason = secretBlocked(anyDef, '', now)
      } else {
        status = 'missing_def'
        if (spec.mode === 'personal') {
          action = 'fill_personal'
        } else if (resolvedScope.teamId) {
          const targetLayer: Layer =
            resolvedScope.scope === 'group'
              ? { scope: 'group', teamId: resolvedScope.teamId, groupId: resolvedScope.scopeId }
              : { scope: 'team', teamId: resolvedScope.teamId, groupId: null }
          action = (await canAdmin(targetLayer)) ? 'create_and_fill' : 'ask_admin'
        } else {
          action = 'ask_admin'
        }
      }
    } else if (def.mode === 'shared') {
      if (!def.value) {
        status = 'unfilled'
        const layer: Layer = {
          scope: def.scope as Layer['scope'],
          teamId: def.teamId,
          groupId: def.groupId,
        }
        action = (await canAdmin(layer)) ? 'fill_shared' : 'ask_admin'
      }
    } else {
      const filled = !!own || (def.mode === 'shared_overridable' && !!def.value)
      if (!filled) {
        status = 'unfilled'
        action = 'fill_personal'
      }
    }

    secretItems.push({
      name: spec.name,
      title: spec.title ?? null,
      description: spec.description,
      url: spec.url ?? null,
      placeholder: spec.placeholder ?? null,
      mode,
      required: spec.required,
      status,
      reason,
      defId: anyDef?.id ?? null,
      defScope: (anyDef?.scope as SecretScope | undefined) ?? null,
      action,
      reused: reusedNames.has(spec.name),
      viaConnector: isConnector && mode !== 'shared' && resolvedScope.scope === 'group',
    })
  }

  const mList = await scopeMachines(ctx, resolvedScope.groupIds, me.id)
  let connector: ReadinessConnectorDto | null = null
  if (plugin && plugin.category === 'connector' && (plugin.connector?.cli || plugin.connector?.login)) {
    const spec = cliSpec(listing.name, plugin)
    const machinesView: ReadinessConnectorMachineDto[] = mList.map((m) => {
      const probe = spec ? ownerProbe(probesOf(ctx, m.machineId), spec.connector) : undefined
      const state = stateOf(probe)
      return {
        ...m,
        state,
        account: state === 'ready' ? (probe?.account ?? null) : null,
      }
    })
    let ready = false
    if (spec) {
      ready = machinesView.some((m) => m.online && m.state === 'ready')
    } else if (resolvedScope.teamId) {
      const [st] = await ctx.db
        .select({ status: connectorStates.status })
        .from(connectorStates)
        .where(
          and(
            eq(connectorStates.userId, me.id),
            eq(connectorStates.teamId, resolvedScope.teamId),
            eq(connectorStates.name, listing.name),
          ),
        )
      ready = st?.status === 'ok'
    }
    connector = {
      kind: spec ? 'cli' : 'login',
      driver: spec?.driver ?? null,
      loginPrompt: plugin.connector.login ?? null,
      ready,
      groupId: resolvedScope.groupIds[0] ?? null,
      machines: machinesView,
    }
  }

  let trusts: ReadinessTrustDto | null = null
  if (plugin && pluginRunsCode(plugin)) {
    const [params, trustRows] = await Promise.all([
      sysParams(ctx.db),
      mList.length
        ? ctx.db
            .select()
            .from(pluginTrusts)
            .where(
              and(
                inArray(
                  pluginTrusts.machineId,
                  mList.map((m) => m.machineId),
                ),
                eq(pluginTrusts.versionId, version.id),
              ),
            )
        : [],
    ])
    const byMachine = new Map(trustRows.map((r) => [r.machineId, r]))
    const trustMachines: ReadinessTrustMachineDto[] = mList.map((m) => {
      const row = byMachine.get(m.machineId)
      return {
        machineId: m.machineId,
        machineName: m.machineName,
        ownerId: m.ownerId,
        ownerName: m.ownerName,
        own: m.own,
        online: m.online,
        trustId: row?.id ?? null,
        status: (row?.status as ReadinessTrustMachineDto['status']) ?? 'unrequested',
        botIds: m.botIds,
        botNames: m.botNames,
      }
    })
    trusts = {
      codeEnabled: params.pluginCodeEnabled,
      ready: params.pluginCodeEnabled && trustMachines.every((m) => m.status === 'allowed'),
      machines: trustMachines,
    }
  }

  const pendingSecrets = secretItems.some((s) => s.required && s.status !== 'ok') ? 1 : 0
  const pendingConnector = connector && !connector.ready ? 1 : 0
  const pendingTrust = trusts && !trusts.ready ? 1 : 0
  const pendingSteps = pendingSecrets + pendingConnector + pendingTrust

  return {
    listingId: listing.id,
    title: plugin ? plugin.title : listing.name,
    versionId: version.id,
    scope: resolvedScope.scope,
    scopeId: resolvedScope.scopeId,
    targetLabel: resolvedScope.targetLabel,
    ready: pendingSteps === 0,
    pendingSteps,
    secrets: secretItems,
    reusedSecrets,
    connector,
    trusts,
    tryPrompts: meta.examples,
  }
}

/**
 * POST /api/market/:id/readiness/action — in-place approve own machine trust,
 * or notify another machine's owner to approve trust / connect CLI account.
 */
export async function marketReadinessAction(
  ctx: Ctx,
  me: Me & { name: string },
  listingId: string,
  req: MarketReadinessActionReq,
): Promise<MarketReadinessActionRes> {
  const { listing, version } = await loadReadableListingVersion(ctx, me, listingId, req.versionId)
  const plugin = listing.type === 'plugin' && isPluginManifest(version.manifest) ? version.manifest : null
  const [machine] = await ctx.db
    .select()
    .from(machines)
    .where(and(eq(machines.id, idParam(req.machineId, '电脑不存在')), isNull(machines.revokedAt)))
  if (!machine) return fail('not_found', '电脑不存在')
  const machineName = machine.label ?? machine.name

  if (req.action === 'allow_trust') {
    if (!plugin || !pluginRunsCode(plugin)) return fail('invalid', '该插件不需要本机运行授权')
    if (machine.ownerId !== me.id) return fail('forbidden', '只有电脑主人能授权插件在这台电脑上运行')
    const now = ctx.now()
    const [row] = await ctx.db
      .insert(pluginTrusts)
      .values({
        machineId: machine.id,
        pluginId: listing.id,
        versionId: version.id,
        status: 'allowed',
        decidedBy: me.id,
        decidedAt: now,
      })
      .onConflictDoUpdate({
        target: [pluginTrusts.machineId, pluginTrusts.versionId],
        set: { status: 'allowed', decidedBy: me.id, decidedAt: now },
      })
      .returning({ id: pluginTrusts.id })
    if (row) {
      await resolveNotifications(ctx, 'plugin_trust', 'trustId', [row.id])
      await audit(ctx, {
        category: 'admin',
        actorUserId: me.id,
        action: 'plugin.trust_allow',
        detail: {
          machineId: machine.id,
          plugin: listing.name,
          version: plugin.version,
          versionId: version.id,
        },
      })
    }
    return { ok: true, trustId: row?.id }
  }

  // Validate optional scope/scopeId pair and ensure the machine belongs to the validated scope.
  let validatedGroupId: string | undefined
  if (req.scope !== undefined || req.scopeId !== undefined) {
    if (!req.scope || (req.scope !== 'user' && !req.scopeId)) return fail('invalid', '请求无效')
    const resolvedScope = await resolveReadinessScope(ctx, me, req.scope, req.scopeId ?? me.id)
    if (resolvedScope.scope === 'group') validatedGroupId = resolvedScope.scopeId
    if (machine.ownerId !== me.id) {
      const allowedMachines = await scopeMachines(ctx, resolvedScope.groupIds, me.id)
      if (!allowedMachines.some((m) => m.machineId === machine.id))
        return fail('forbidden', '这台电脑不在当前范围内')
    }
  } else if (machine.ownerId !== me.id) {
    const myTeams = await ctx.db
      .select({ teamId: teamMembers.teamId })
      .from(teamMembers)
      .where(eq(teamMembers.userId, me.id))
    const teamIds = myTeams.map((x) => x.teamId)
    const [sharedBot] = teamIds.length
      ? await ctx.db
          .select({ id: bots.id })
          .from(bots)
          .where(and(eq(bots.machineId, machine.id), isNull(bots.deletedAt), inArray(bots.teamId, teamIds)))
          .limit(1)
      : []
    if (!sharedBot) return fail('forbidden', '这台电脑不在当前范围内')
  }

  if (req.action === 'notify_trust') {
    if (!plugin || !pluginRunsCode(plugin)) return fail('invalid', '该插件不需要本机运行授权')
    await ctx.db
      .insert(pluginTrusts)
      .values({ machineId: machine.id, pluginId: listing.id, versionId: version.id })
      .onConflictDoNothing()
    const [trust] = await ctx.db
      .select()
      .from(pluginTrusts)
      .where(and(eq(pluginTrusts.machineId, machine.id), eq(pluginTrusts.versionId, version.id)))
    if (trust?.status === 'allowed' || trust?.status === 'denied')
      return { ok: true, trustId: trust.id, notified: false }
    if (trust) {
      await notify(
        ctx,
        machine.ownerId,
        'plugin_trust',
        {
          trustId: trust.id,
          machineId: machine.id,
          machineName,
          pluginTitle: plugin.title,
          version: plugin.version,
        },
        null,
      )
    }
    return { ok: true, trustId: trust?.id, notified: true }
  }

  if (plugin?.category !== 'connector' || !(plugin.connector?.cli || plugin.connector?.login)) {
    return fail('invalid', '该插件不是外部账号连接插件')
  }
  await notify(
    ctx,
    machine.ownerId,
    'reminder',
    {
      byName: me.name,
      text: t('请先在「{machine}」上连接{title}账号，群里就能直接使用了', {
        machine: machineName,
        title: plugin.title,
      }),
      ...(validatedGroupId && { groupId: validatedGroupId }),
    },
    null,
  )
  return { ok: true, notified: true }
}
