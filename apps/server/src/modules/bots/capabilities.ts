import {
  type BotCapabilitiesDto,
  type BotCapabilityActionKind,
  type BotCapabilityGroupRef,
  type BotCapabilityItemDto,
  type BotCapabilitySource,
  createsArtifacts,
  type PluginBlocker,
  type PluginManifest,
  type SkillListingManifest,
  secretSpecsOf,
} from '@gonggong/protocol'
import { and, asc, eq, exists, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Ctx } from '../../context.js'
import {
  groupBots,
  groupMembers,
  groups,
  installs,
  machines,
  plugins,
  pluginVersions,
  teamMembers,
  users,
} from '../../db/schema.js'
import { t } from '../../i18n/index.js'
import { fail } from '../../lib/errors.js'
import { idParam } from '../../lib/ids.js'
import { ownerProbe, probesOf, stateOf } from '../connectors/state.js'
import { cliSpec } from '../connectors/sync.js'
import { requireMember } from '../groups/service.js'
import { deriveListingMeta } from '../market/meta.js'
import { groupInstalls, inScope, maintainedBy } from '../market/service.js'
import { botStates, groupPluginList, pluginBlocker, pluginsOn } from '../plugins/service.js'
import { nearest } from '../secrets/needs.js'
import { type SecretRow, visibleSecrets } from '../secrets/resolve.js'
import { requireTeam } from '../teams/service.js'
import { loadBot } from './routes.js'

const resolvedV = alias(pluginVersions, 'bot_cap_resolved')

const personalSkillInstalls = async (ctx: Ctx, groupId: string, userId: string) => {
  const team = ctx.db.select({ id: groups.teamId }).from(groups).where(eq(groups.id, groupId))
  const resolvedId = sql`case when ${and(
    eq(installs.scope, 'user'),
    isNull(installs.pinVersionId),
    maintainedBy(ctx.db, sql`${installs.scopeId}`),
  )} then ${plugins.versionId} else ${installs.resolvedVersionId} end`
  const member = ctx.db
    .select({ one: sql`1` })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, plugins.teamId), eq(teamMembers.userId, userId)))
  return ctx.db
    .select({
      listingId: plugins.id,
      name: plugins.name,
      scope: plugins.scope,
      versionId: resolvedV.id,
      manifest: resolvedV.manifest,
    })
    .from(installs)
    .innerJoin(plugins, eq(plugins.id, installs.listingId))
    .innerJoin(resolvedV, eq(resolvedV.id, resolvedId))
    .where(
      and(
        inScope({ scope: 'user', scopeId: userId }),
        eq(installs.enabled, true),
        eq(plugins.type, 'skill'),
        ne(plugins.status, 'banned'),
        or(
          eq(plugins.scope, 'platform'),
          eq(plugins.visibility, 'public'),
          and(inArray(plugins.teamId, team), exists(member)),
        ),
        or(eq(resolvedV.reviewStatus, 'approved'), maintainedBy(ctx.db, userId)),
      ),
    )
}

type MachineInfo = {
  id: string | null
  name: string | null
  ownerId: string | null
  ownerName: string | null
  own: boolean
  daemonVersion: string | null
}

function describeSecretBlocker(
  missingNames: string[],
  specs: ReturnType<typeof secretSpecsOf>,
  defs: SecretRow[],
): { reasonLabel: string; reason: string; action: BotCapabilityActionKind } {
  const displayNames = missingNames.map((n) => specs.find((s) => s.name === n)?.title || n)
  const joined = displayNames.join(t('、'))
  const hasPersonal = missingNames.some((n) => {
    const def = nearest(defs, n)
    const spec = specs.find((s) => s.name === n)
    const mode = def?.mode ?? spec?.mode ?? 'shared'
    return mode !== 'shared'
  })
  return {
    action: 'fill-secret',
    reasonLabel: hasPersonal ? t('缺少你的凭据') : t('缺少凭据'),
    reason: hasPersonal
      ? t('你还没有填写 {names}；填完后即可使用', { names: joined })
      : t('缺少共享凭据 {names}，请联系管理员填写', { names: joined }),
  }
}

function describePluginBlocker(
  blocker: PluginBlocker | 'connector',
  m: PluginManifest,
  machine: MachineInfo,
  missingNames: string[],
  defs: SecretRow[],
): { reasonLabel: string; reason: string; action: BotCapabilityActionKind } {
  const mName = machine.name ?? t('未知电脑')
  const owner = machine.ownerName ?? t('电脑主人')
  switch (blocker) {
    case 'secret':
      return describeSecretBlocker(missingNames, secretSpecsOf(m), defs)
    case 'connector':
      return {
        action: 'connect-account',
        reasonLabel: t('需连接账号'),
        reason: machine.own
          ? t('需要在你的电脑「{machine}」上连接{title}账号', { machine: mName, title: m.title })
          : t('需要 {owner} 在「{machine}」上连接{title}账号', { owner, machine: mName, title: m.title }),
      }
    case 'trust':
      return {
        action: 'trust-machine',
        reasonLabel: t('待机主确认'),
        reason: machine.own
          ? t('含本机程序，需要在你的电脑「{machine}」允许运行', { machine: mName })
          : t('含本机程序，需要 {owner} 在「{machine}」点一次允许运行', { owner, machine: mName }),
      }
    case 'daemon':
      return {
        action: 'upgrade-daemon',
        reasonLabel: t('客户端版本过低'),
        reason: machine.name
          ? t('{machine} 当前客户端版本为 {current}，升级到 v{min} 后自动启用', {
              machine: mName,
              current: machine.daemonVersion ? `v${machine.daemonVersion}` : t('版本未知'),
              min: m.minDaemon,
            })
          : t('当前电脑客户端版本过低，请升级到 v{min} 以上', { min: m.minDaemon }),
      }
    case 'offline':
      return {
        action: 'none',
        reasonLabel: t('电脑离线'),
        reason: machine.id
          ? t('运行电脑「{machine}」当前离线，上线后自动恢复', { machine: mName })
          : t('该Bot尚未绑定运行电脑'),
      }
    case 'agent':
      return {
        action: 'none',
        reasonLabel: t('当前引擎暂不支持'),
        reason: t('该插件暂不支持此Bot使用的引擎'),
      }
    case 'code':
      return {
        action: 'none',
        reasonLabel: t('未开启本机程序权限'),
        reason: t('管理员尚未开启「插件运行本机程序」系统开关'),
      }
  }
}

/**
 * GET /api/bots/:id/capabilities?groupId= — returns the bot's assembled plugins & skills
 * split into `ready` and `unavailable`, reusing `pluginBlocker`, secrets, CLI connector probes,
 * and `pluginTrusts` with zero duplicated blocker logic.
 */
export async function botCapabilities(
  ctx: Ctx,
  me: { id: string; role: string },
  rawBotId: string,
  rawGroupId?: string,
): Promise<BotCapabilitiesDto> {
  const bot = await loadBot(ctx, rawBotId)
  await requireTeam(ctx, me.id, bot.teamId)

  const [[machineRow], memberGroups] = await Promise.all([
    bot.machineId
      ? ctx.db
          .select({
            id: machines.id,
            name: machines.name,
            label: machines.label,
            ownerId: machines.ownerId,
            ownerName: users.name,
            daemonVersion: machines.daemonVersion,
          })
          .from(machines)
          .innerJoin(users, eq(users.id, machines.ownerId))
          .where(and(eq(machines.id, bot.machineId), isNull(machines.revokedAt)))
      : Promise.resolve([]),
    ctx.db
      .select({ id: groups.id, name: groups.name })
      .from(groupBots)
      .innerJoin(groups, eq(groups.id, groupBots.groupId))
      .innerJoin(groupMembers, and(eq(groupMembers.groupId, groups.id), eq(groupMembers.userId, me.id)))
      .where(
        and(
          eq(groupBots.botId, bot.id),
          isNull(groupBots.removedAt),
          isNull(groups.archivedAt),
          eq(groups.kind, 'group'),
        ),
      )
      .orderBy(asc(groups.name)),
  ])

  let targetGroups: BotCapabilityGroupRef[] = memberGroups
  let selectedGroupId: string | null = null
  if (rawGroupId) {
    const gid = idParam(rawGroupId, '群不存在')
    const { group } = await requireMember(ctx, gid, me.id)
    const [inGroup] = await ctx.db
      .select({ id: groupBots.botId })
      .from(groupBots)
      .where(and(eq(groupBots.groupId, group.id), eq(groupBots.botId, bot.id), isNull(groupBots.removedAt)))
    if (!inGroup) fail('not_found', '该 Bot 不在群内')
    selectedGroupId = group.id
    targetGroups = [{ id: group.id, name: group.name }]
  }

  const enabled = await pluginsOn(ctx.db)
  if (!enabled || !targetGroups.length) {
    return {
      botId: bot.id,
      groupId: selectedGroupId,
      groups: memberGroups,
      pluginsEnabled: enabled,
      ready: [],
      unavailable: [],
    }
  }

  const machine: MachineInfo = {
    id: machineRow?.id ?? null,
    name: machineRow ? (machineRow.label ?? machineRow.name) : null,
    ownerId: machineRow?.ownerId ?? null,
    ownerName: machineRow?.ownerName ?? null,
    own: !!machineRow && machineRow.ownerId === me.id,
    daemonVersion: machineRow?.daemonVersion ?? null,
  }

  const readyMap = new Map<string, BotCapabilityItemDto>()
  const unavailMap = new Map<string, BotCapabilityItemDto>()

  const pushItem = (target: Map<string, BotCapabilityItemDto>, key: string, item: BotCapabilityItemDto) => {
    const prev = target.get(key)
    if (!prev) {
      target.set(key, item)
      return
    }
    const first = item.groups[0]
    if (first && !prev.groups.some((g) => g.id === first.id)) prev.groups.push(first)
  }

  for (const g of targetGroups) {
    const [pluginRows, states, gSkills, pSkills, defs, [memberRow]] = await Promise.all([
      groupPluginList(ctx.db, g.id),
      botStates(ctx, g.id, me.id, bot.id),
      groupInstalls(ctx.db, g.id, 'skill'),
      personalSkillInstalls(ctx, g.id, me.id),
      visibleSecrets(ctx.db, g.id),
      ctx.db
        .select({ off: groupMembers.connectorsOff })
        .from(groupMembers)
        .where(and(eq(groupMembers.groupId, g.id), eq(groupMembers.userId, me.id))),
    ])
    const bState = states[0]?.state
    if (!bState) continue
    const mineOff = new Set(memberRow?.off ?? [])

    // 1. Plugins enabled in the group
    for (const r of pluginRows) {
      const m = r.version.manifest
      if (!r.enabledInGroup) continue
      if (m.category === 'connector' && mineOff.has(r.plugin.name)) continue

      const meta = deriveListingMeta(r.plugin, m)
      let blocker: PluginBlocker | 'connector' | null = pluginBlocker(m, bState, r.version.id)
      let connectorAccount: string | null = null

      if (!blocker && m.category === 'connector' && m.connector?.cli) {
        const spec = cliSpec(r.plugin.name, m)
        if (spec) {
          if (!bState.features.includes('connectors')) {
            blocker = 'daemon'
          } else {
            const probe = machine.id ? ownerProbe(probesOf(ctx, machine.id), spec.connector) : undefined
            if (stateOf(probe) !== 'ready') blocker = 'connector'
            else connectorAccount = probe?.account ?? null
          }
        }
      }

      const source: BotCapabilitySource =
        r.plugin.scope === 'platform' ? 'official' : (r.plugin.scope as BotCapabilitySource)
      const isCreation = createsArtifacts(m)
      const firstChatCmd = m.contributes.commands.find((c) => c.where === 'chat')?.name ?? null

      const base = {
        pluginId: r.plugin.id,
        name: r.plugin.name,
        title: m.title,
        description: m.description,
        type: 'plugin' as const,
        icon: m.icon ?? null,
        versionId: r.version.id,
        scene: meta.scene,
        capabilities: meta.capabilities,
        source,
        createsArtifacts: isCreation,
        chatCommand: firstChatCmd,
        groups: [{ id: g.id, name: g.name }],
        groupId: g.id,
        ownMachine: machine.own,
        machineId: machine.id,
        machineName: machine.name,
        machineOwnerName: machine.ownerName,
        minDaemon: m.minDaemon,
        daemonVersion: machine.daemonVersion,
      }

      if (!blocker) {
        const sourceLabel =
          m.category === 'connector' && m.connector?.cli
            ? connectorAccount
              ? t('使用 {account} 的{title}账号', { account: connectorAccount, title: m.title })
              : t('使用 {owner} 的{title}账号', {
                  owner: machine.ownerName ?? t('电脑主人'),
                  title: m.title,
                })
            : source === 'official'
              ? isCreation
                ? t('官方创作插件')
                : t('官方插件')
              : source === 'team'
                ? t('团队统一开启')
                : t('本群已开启')
        const statusLabel =
          m.category === 'connector' ? t('已连接') : meta.readiness === 'ready' ? t('开箱即用') : t('已就绪')
        pushItem(readyMap, r.plugin.id, {
          ...base,
          sourceLabel,
          statusLabel,
          blocker: null,
          reasonLabel: null,
          reason: null,
          action: 'none',
          missingSecrets: [],
        })
      } else {
        const missingSecrets = blocker === 'secret' ? m.secrets.filter((n) => !(n in bState.env)) : []
        const desc = describePluginBlocker(blocker, m, machine, missingSecrets, defs)
        pushItem(unavailMap, `${r.plugin.id}:${blocker}`, {
          ...base,
          sourceLabel:
            source === 'official' ? t('官方插件') : source === 'team' ? t('团队统一开启') : t('本群已开启'),
          statusLabel: '',
          blocker,
          reasonLabel: desc.reasonLabel,
          reason: desc.reason,
          action: desc.action,
          missingSecrets,
        })
      }
    }

    // 2. Market skill installs (personal + group/repo/team)
    const seenSkillNames = new Set<string>()
    const skillItems = [
      ...pSkills.map((p) => ({
        listingId: p.listingId,
        name: p.name,
        versionId: p.versionId,
        manifest: p.manifest as unknown as SkillListingManifest,
        source: 'personal' as BotCapabilitySource,
      })),
      ...gSkills
        .filter((s) => s.enabled)
        .map((s) => ({
          listingId: s.listingId,
          name: s.name,
          versionId: s.version.id,
          manifest: s.version.manifest as unknown as SkillListingManifest,
          source: (s.layer === 'group' || s.layer === 'team' || s.layer === 'repo'
            ? s.layer
            : 'official') as BotCapabilitySource,
        })),
    ]
    for (const sk of skillItems) {
      if (seenSkillNames.has(sk.name)) continue
      seenSkillNames.add(sk.name)
      const meta = deriveListingMeta({ type: 'skill', name: sk.name, scope: sk.source }, sk.manifest)
      const reqSpecs = (sk.manifest.secretSpecs ?? []).filter((s) => s.required)
      const missingSecrets = reqSpecs.filter((s) => !(s.name in bState.env)).map((s) => s.name)
      const base = {
        pluginId: sk.listingId,
        name: sk.name,
        title: sk.name,
        description: sk.manifest.description,
        type: 'skill' as const,
        icon: null,
        versionId: sk.versionId,
        scene: meta.scene,
        capabilities: meta.capabilities,
        source: sk.source,
        createsArtifacts: false,
        chatCommand: null,
        groups: [{ id: g.id, name: g.name }],
        groupId: g.id,
        ownMachine: machine.own,
        machineId: machine.id,
        machineName: machine.name,
        machineOwnerName: machine.ownerName,
        minDaemon: null,
        daemonVersion: machine.daemonVersion,
      }
      if (!bState.online) {
        const mName = machine.name ?? t('未知电脑')
        pushItem(unavailMap, `${sk.listingId}:offline`, {
          ...base,
          sourceLabel:
            sk.source === 'personal'
              ? t('我的个人插件 · 仅你 @ 时生效')
              : sk.source === 'team'
                ? t('团队统一开启')
                : sk.source === 'repo'
                  ? t('仓库统一开启')
                  : t('本群已开启'),
          statusLabel: '',
          blocker: 'offline',
          reasonLabel: t('电脑离线'),
          reason: machine.id
            ? t('运行电脑「{machine}」当前离线，上线后自动恢复', { machine: mName })
            : t('该Bot尚未绑定运行电脑'),
          action: 'none',
          missingSecrets: [],
        })
      } else if (missingSecrets.length) {
        const desc = describeSecretBlocker(missingSecrets, reqSpecs, defs)
        pushItem(unavailMap, `${sk.listingId}:secret`, {
          ...base,
          sourceLabel:
            sk.source === 'personal'
              ? t('我的个人插件 · 仅你 @ 时生效')
              : sk.source === 'team'
                ? t('团队统一开启')
                : t('本群已开启'),
          statusLabel: '',
          blocker: 'secret',
          reasonLabel: desc.reasonLabel,
          reason: desc.reason,
          action: desc.action,
          missingSecrets,
        })
      } else {
        pushItem(readyMap, sk.listingId, {
          ...base,
          sourceLabel:
            sk.source === 'personal'
              ? t('我的个人插件 · 仅你 @ 时生效')
              : sk.source === 'team'
                ? t('团队统一开启')
                : sk.source === 'repo'
                  ? t('仓库统一开启')
                  : t('本群已开启'),
          statusLabel: t('已就绪'),
          blocker: null,
          reasonLabel: null,
          reason: null,
          action: 'none',
          missingSecrets: [],
        })
      }
    }
  }

  // Refine personal sourceLabel when viewing across multiple groups
  const ready = [...readyMap.values()].map((item) =>
    !selectedGroupId && item.source === 'personal' && item.groups.length > 1
      ? { ...item, sourceLabel: t('随你进入全部 {n} 个群', { n: item.groups.length }) }
      : item,
  )
  const unavailable = [...unavailMap.values()]

  return {
    botId: bot.id,
    groupId: selectedGroupId,
    groups: memberGroups,
    pluginsEnabled: true,
    ready,
    unavailable,
  }
}
