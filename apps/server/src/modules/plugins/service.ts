import {
  compareVersions,
  type McpServer,
  PLUGIN_MANIFEST,
  PLUGIN_MAX_BYTES,
  type PluginBlocker,
  type PluginCommand,
  type PluginDto,
  type PluginLayer,
  PluginManifest,
  type PluginRef,
  pluginRunsCode,
  type SkillFile,
  type SkillListingManifest,
} from '@gonggong/protocol'
import { and, asc, desc, eq, inArray, isNull, ne, or, type SQL } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import type { Db } from '../../db/client.js'
import {
  bots,
  groupBots,
  groups,
  installs,
  machines,
  plugins,
  pluginTrusts,
  pluginVersions,
  users,
} from '../../db/schema.js'
import { audit } from '../../lib/audit.js'
import { fail } from '../../lib/errors.js'
import { sysParams } from '../admin/params.js'
import { commands as systemCommands } from '../commands/registry.js'
import { groupsInstalls, listVersion } from '../market/service.js'
import type { Layer } from '../mcp/service.js'
import { mcpTurnedOff } from '../mcp/service.js'
import { notify } from '../notifications/notify.js'
import { resolveSecrets } from '../secrets/resolve.js'
import { checkFiles, frontmatter, LAYER_RANK, mergeSkills, snapshot } from '../skills/service.js'
import { broadcastPresets } from './presets.js'

type Read = Pick<Db, 'select'>
export type PluginRow = typeof plugins.$inferSelect

/** Everything of a version but its files, which only downloads need (up to 5 MB each). */
const versionCols = {
  id: pluginVersions.id,
  revision: pluginVersions.revision,
  manifest: pluginVersions.manifest,
  digest: pluginVersions.digest,
  size: pluginVersions.size,
}
export type Listed = {
  plugin: PluginRow
  version: { id: string; revision: number; manifest: PluginManifest; digest: string; size: number }
  updatedBy: string | null
}

const has = (files: SkillFile[], path: string) => files.some((f) => f.path === path)
const PKG = '{pkg}/'
const SECRET_REF = /\$\{secret:([A-Z][A-Z0-9_]{1,63})\}/g

/**
 * The only paths a plugin may carry (plan 插件扩展点 §3.1). The daemon hands the folder to Claude as a local plugin,
 * which would run anything at Claude's reserved paths (`hooks/`, `.mcp.json`, `commands/`, `agents/`…).
 */
const ALLOWED_PATH =
  /^(gonggong-plugin\.json|[^/]+\.md|LICENSE|(skills|previews|assets|contrib\/(mcp|agents|tabs))\/.+)$/

/** Validates a plugin folder (plan 插件体系 S2) and returns it sorted, with its manifest, digest and size. */
export function pluginSnapshot(input: SkillFile[]) {
  const checked = checkFiles(input, PLUGIN_MAX_BYTES, '插件不能超过 5 MB')
  const { files } = checked
  const stray = files.find((f) => !ALLOWED_PATH.test(f.path))
  if (stray) fail('invalid', '插件不能包含此路径：{path}', { path: stray.path })
  const raw = files.find((f) => f.path === PLUGIN_MANIFEST)
  if (!raw || raw.encoding !== 'utf8') return fail('invalid', '缺少 gonggong-plugin.json')
  let json: unknown
  try {
    json = JSON.parse(raw.content)
  } catch {
    return fail('invalid', 'gonggong-plugin.json 不是合法的 JSON')
  }
  const parsed = PluginManifest.safeParse(json)
  if (!parsed.success)
    return fail('invalid', 'gonggong-plugin.json 不符合清单格式：{field}', {
      field: parsed.error.issues[0]?.path.join('.') ?? '',
    })
  const manifest = parsed.data
  if (manifest.entry) {
    const entry = `skills/${manifest.entry}/SKILL.md`
    if (!has(files, entry)) fail('invalid', '缺少文件：{path}', { path: entry })
    if (frontmatter(files, entry).name !== manifest.entry)
      fail('invalid', '{path} 的 name 必须是 {name}', { path: entry, name: manifest.entry })
  }
  const required = [
    ...manifest.designSystems.flatMap((d) =>
      ['DESIGN.md', 'tokens.css'].map((f) => `skills/${manifest.entry}/${d.dir}/${f}`),
    ),
    ...manifest.templates.flatMap((tp) => (tp.preview ? [tp.preview] : [])),
    ...(manifest.icon ? [manifest.icon] : []),
    ...(manifest.artifact?.kit ? [`${manifest.artifact.kit}/index.html`] : []),
    // Files a stdio server starts from the folder.
    ...manifest.contributes.mcp.flatMap((c) =>
      c.transport === 'stdio'
        ? c.command.flatMap((a) => (a.startsWith(PKG) ? [a.slice(PKG.length)] : []))
        : [],
    ),
  ]
  for (const path of required) if (!has(files, path)) fail('invalid', '缺少文件：{path}', { path })
  const system = new Set(systemCommands.list().map((c) => c.name))
  for (const c of manifest.contributes.commands)
    if (c.where === 'chat' && system.has(c.name))
      fail('invalid', '插件命令 {name} 与系统命令重名', { name: c.name })
  return { ...checked, manifest, type: 'plugin' as const }
}

/** A bare skill folder (SKILL.md at its root, no plugin manifest) or a plugin folder. */
export function listingSnapshot(files: SkillFile[]) {
  if (!has(files, PLUGIN_MANIFEST) && !has(files, 'SKILL.md')) {
    // Picking the folder above the skill is the usual slip: point at where SKILL.md is.
    const nested = files.find((f) => /^[^/]+\/SKILL\.md$/.test(f.path))?.path
    return nested
      ? fail('invalid', 'SKILL.md 不在根目录（在 {path}），请选择它所在的文件夹', { path: nested })
      : fail('invalid', '根目录缺少 SKILL.md（Skill）或 gonggong-plugin.json（插件）')
  }
  if (has(files, PLUGIN_MANIFEST)) return pluginSnapshot(files)
  const { name, description, ...checked } = snapshot(files)
  const manifest: SkillListingManifest = { name, description }
  return { ...checked, manifest, type: 'skill' as const }
}
export type ListingSnapshot = ReturnType<typeof listingSnapshot>

const layerSlot = (l: Layer) =>
  and(
    eq(plugins.scope, l.scope),
    l.teamId ? eq(plugins.teamId, l.teamId) : isNull(plugins.teamId),
    l.groupId ? eq(plugins.groupId, l.groupId) : isNull(plugins.groupId),
  )

/** The layer's own listings; authors' market listings (with a visibility) share the team slot but not its lists. */
export const inLayer = (l: Layer) => and(layerSlot(l), isNull(plugins.visibility))

/** Plugins joined with their current version (without files) and last editor. */
export const listed = (db: Read, where?: SQL) =>
  db
    .select({ plugin: plugins, version: versionCols, updatedBy: users.name })
    .from(plugins)
    .innerJoin(pluginVersions, eq(pluginVersions.id, plugins.versionId))
    .leftJoin(users, eq(users.id, plugins.updatedBy))
    .where(where)
    .orderBy(asc(plugins.name))

export const pluginDto = ({ plugin, version, updatedBy }: Listed): PluginDto => ({
  id: plugin.id,
  layer: plugin.scope as PluginLayer,
  manifest: version.manifest,
  versionId: version.id,
  revision: version.revision,
  size: version.size,
  updatedBy,
  updatedAt: plugin.updatedAt.toISOString(),
  builtin: isBuiltin(plugin),
})

/** Saved by syncBuiltinPlugins at startup, the only writer without an editor. */
const isBuiltin = (row: PluginRow) => row.scope === 'platform' && row.updatedBy === null

const log = (ctx: Ctx, actorId: string | null, l: Layer, action: string, row: PluginRow, revision?: number) =>
  audit(ctx, {
    category: 'admin',
    actorUserId: actorId,
    teamId: l.teamId,
    groupId: l.groupId,
    action,
    detail: { id: row.id, layer: l.scope, name: row.name, revision },
  })

/**
 * A new listing, or a new version of the layer's listing of the same name unless the content is identical; admins'
 * uploads are approved at once, so installs following the listing move to the new version.
 */
export async function savePlugin(ctx: Ctx, l: Layer, s: ListingSnapshot, actorId: string | null) {
  const name = s.manifest.name
  if (l.scope !== 'platform') presetsOnPlatformOnly(s)
  const saved = await ctx.db.transaction(async (tx) => {
    const values = { ...l, name, type: s.type, authorId: actorId, updatedBy: actorId, updatedAt: ctx.now() }
    const [made] = await tx.insert(plugins).values(values).onConflictDoNothing().returning()
    const [plugin] = made
      ? [made]
      : await tx
          .select()
          .from(plugins)
          .where(and(layerSlot(l), eq(plugins.name, name)))
          .for('update')
    if (!plugin) return fail('conflict', '插件正在被修改，请重试')
    if (actorId && isBuiltin(plugin)) fail('forbidden', '内置插件不能覆盖，可以上传到团队或群里替换')
    if (plugin.type !== s.type || plugin.visibility) fail('conflict', '同名的插件或 Skill 已存在')
    const [last] = await tx
      .select({ revision: pluginVersions.revision, digest: pluginVersions.digest, id: pluginVersions.id })
      .from(pluginVersions)
      .where(eq(pluginVersions.pluginId, plugin.id))
      .orderBy(desc(pluginVersions.revision))
      .limit(1)
    const current = plugin.versionId === last?.id ? last : undefined
    if (current && current.digest === s.digest) return { plugin, created: false, revision: null }
    const revision = (last?.revision ?? 0) + 1
    const [v] = await tx
      .insert(pluginVersions)
      .values({
        pluginId: plugin.id,
        revision,
        files: s.files,
        manifest: s.manifest as PluginManifest,
        digest: s.digest,
        size: s.size,
        createdBy: actorId,
      })
      .returning({ id: pluginVersions.id })
    await tx
      .update(plugins)
      .set({ versionId: v!.id, updatedBy: actorId, updatedAt: ctx.now() })
      .where(eq(plugins.id, plugin.id))
    await listVersion(tx, plugin.id, v!.id)
    return { plugin, created: !!made, revision }
  })
  if (saved.revision)
    await log(
      ctx,
      actorId,
      l,
      saved.created ? 'plugin.create' : 'plugin.update',
      saved.plugin,
      saved.revision,
    )
  if (saved.revision && l.scope === 'platform') await broadcastPresets(ctx)
  return saved
}

/** Provider presets apply to every machine: only platform-layer plugins may bring them (§6). */
export function presetsOnPlatformOnly(s: ListingSnapshot) {
  if (s.type === 'plugin' && s.manifest.contributes.providers.length)
    fail('invalid', '只有平台层插件可以带供应商预设')
}

export async function deletePlugin(ctx: Ctx, l: Layer, row: PluginRow, actorId: string) {
  if (isBuiltin(row)) fail('forbidden', '内置插件不能删除')
  await ctx.db.delete(plugins).where(eq(plugins.id, row.id))
  await log(ctx, actorId, l, 'plugin.delete', row)
  if (l.scope === 'platform') await broadcastPresets(ctx)
}

/**
 * For each group, one plugin per name across the layers' own plugins (platform, its team, itself) and the market
 * plugins installed for it (a lower layer replaces a same-named one above it); on when the highest scope that
 * installed it (group > repo > team) has it on, at that install's version.
 */
export async function groupPluginLists(db: Read, groupIds: string[]) {
  const [found, installed] = await Promise.all([
    groupIds.length
      ? db.select({ id: groups.id, teamId: groups.teamId }).from(groups).where(inArray(groups.id, groupIds))
      : [],
    groupsInstalls(db, groupIds, 'plugin'),
  ])
  const installedIds = [...new Set([...installed.values()].flat().map((i) => i.listingId))]
  const rows = found.length
    ? await listed(
        db,
        and(
          eq(plugins.type, 'plugin'),
          ne(plugins.status, 'banned'),
          or(
            and(
              isNull(plugins.visibility),
              or(
                eq(plugins.scope, 'platform'),
                and(
                  eq(plugins.scope, 'team'),
                  inArray(
                    plugins.teamId,
                    found.map((g) => g.teamId),
                  ),
                ),
                and(eq(plugins.scope, 'group'), inArray(plugins.groupId, groupIds)),
              ),
            ),
            installedIds.length ? inArray(plugins.id, installedIds) : undefined,
          ),
        ),
      )
    : []
  return new Map(
    found.map((g) => {
      const mine = installed.get(g.id) ?? []
      const top = new Map<string, (typeof mine)[number]>()
      for (const i of mine) {
        const had = top.get(i.listingId)
        if (!had || LAYER_RANK[i.layer]! > LAYER_RANK[had.layer]!) top.set(i.listingId, i)
      }
      const applies = (p: PluginRow) =>
        top.has(p.id) ||
        (!p.visibility &&
          (p.scope === 'platform' ||
            (p.scope === 'team' && p.teamId === g.teamId) ||
            (p.scope === 'group' && p.groupId === g.id)))
      const list = mergeSkills(
        rows
          .filter((r) => applies(r.plugin) && inGroups(r.version.manifest))
          .map((r) => ({ ...r, scope: r.plugin.scope, name: r.plugin.name })),
      ).map((r) => {
        const install = top.get(r.plugin.id)
        return { ...r, version: install?.version ?? r.version, enabledInGroup: install?.enabled ?? false }
      })
      return [g.id, list] as const
    }),
  )
}

/** Plugins that bring only provider presets apply to machines, not groups: groups do not list them. */
const inGroups = (m: PluginManifest) =>
  !!m.entry || m.contributes.mcp.length > 0 || m.contributes.commands.length > 0

export const groupPluginList = async (db: Read, groupId: string) =>
  (await groupPluginLists(db, [groupId])).get(groupId) ?? []

export async function setGroupPlugin(
  ctx: Ctx,
  groupId: string,
  plugin: PluginRow,
  enabled: boolean,
  actorId: string,
) {
  const set = { enabled, updatedBy: actorId, updatedAt: ctx.now() }
  await ctx.db
    .insert(installs)
    .values({
      listingId: plugin.id,
      scope: 'group',
      scopeId: groupId,
      resolvedVersionId: plugin.versionId!,
      ...set,
    })
    .onConflictDoUpdate({ target: [installs.listingId, installs.scope, installs.scopeId], set })
  await audit(ctx, {
    category: 'admin',
    actorUserId: actorId,
    groupId,
    action: 'plugin.group_toggle',
    detail: { id: plugin.id, name: plugin.name, enabled },
  })
}

export const pluginsOn = async (db: Read) => (await sysParams(db)).pluginsEnabled

export async function requirePluginsOn(db: Read) {
  if (!(await pluginsOn(db))) fail('forbidden', '插件功能未开启')
}

/** What decides whether a bot may use a plugin this turn. */
export type BotState = {
  agentKind: string
  online: boolean
  features: string[]
  daemonVersion: string | null
  /** The secrets this turn would get (resolveSecrets env). */
  env: Record<string, string>
  /** 系统参数 · 插件代码. */
  codeEnabled: boolean
  /** Plugin versions the owner of the bot's machine allowed to run code there. */
  trusted: string[]
}

/** Why the bot cannot use plugin version `versionId` now, or null; shared by the group list, creations and run.start. */
export function pluginBlocker(m: PluginManifest, b: BotState, versionId: string): PluginBlocker | null {
  if (!(m.agents as string[]).includes(b.agentKind)) return 'agent'
  if (!b.online) return 'offline'
  if (
    !b.features.includes('plugins') ||
    (m.contributes.mcp.length && !b.features.includes('pluginMcp')) ||
    !b.daemonVersion ||
    compareVersions(b.daemonVersion, m.minDaemon) < 0
  )
    return 'daemon'
  if (pluginRunsCode(m) && !b.codeEnabled) return 'code'
  if (m.secrets.some((name) => !(name in b.env))) return 'secret'
  if (pluginRunsCode(m) && !b.trusted.includes(versionId)) return 'trust'
  return null
}

/** Chat commands of these plugins, one per name (the first plugin's), none named like a system command. */
export function chatCommands(manifests: PluginManifest[]) {
  const reserved = new Set(systemCommands.list().map((c) => c.name))
  const out = new Map<string, { manifest: PluginManifest; command: PluginCommand }>()
  for (const m of manifests)
    for (const c of m.contributes.commands)
      if (c.where === 'chat' && !reserved.has(c.name) && !out.has(c.name))
        out.set(c.name, { manifest: m, command: c })
  return [...out.values()]
}

/** The run's prompt for a message invoking a plugin's chat command (`/name args` anywhere in it), else null. */
export function commandPrompt(body: string, commands: ReturnType<typeof chatCommands>) {
  for (const { manifest: m, command: c } of commands) {
    const hit = new RegExp(`(?:^|\\s)/${c.name}(?=\\s|$)([\\s\\S]*)$`).exec(body)
    if (!hit) continue
    // Agent-facing: not translated.
    return [
      body,
      '',
      `[插件命令 /${c.name}：插件「${m.title}」（${m.name}）]`,
      c.prompt.replaceAll('{args}', hit[1]!.trim()),
      ...(m.entry
        ? [
            `Skill：Claude 用 ${m.name}:${m.entry}；Codex、Gemini、pi、DeepSeek Harness 用 ${m.entry}（目录 .agents/skills/${m.name}-${m.entry}）。`,
          ]
        : []),
    ].join('\n')
  }
  return null
}

/** Versions allowed to run code on each machine. */
async function trustedOn(db: Read, machineIds: string[]) {
  const rows = machineIds.length
    ? await db
        .select({ machineId: pluginTrusts.machineId, versionId: pluginTrusts.versionId })
        .from(pluginTrusts)
        .where(and(inArray(pluginTrusts.machineId, machineIds), eq(pluginTrusts.status, 'allowed')))
    : []
  return (machineId: string | null) => rows.filter((r) => r.machineId === machineId).map((r) => r.versionId)
}

/** The group's bots (or one of them) as a turn `originUserId` starts now would see them. */
export async function botStates(ctx: Ctx, groupId: string, originUserId: string, botId?: string) {
  const rows = await ctx.db
    .select({
      id: bots.id,
      name: bots.name,
      agentKind: bots.agentKind,
      machineId: bots.machineId,
      daemonVersion: machines.daemonVersion,
    })
    .from(groupBots)
    .innerJoin(bots, eq(bots.id, groupBots.botId))
    .leftJoin(machines, eq(machines.id, bots.machineId))
    .where(
      and(
        eq(groupBots.groupId, groupId),
        isNull(groupBots.removedAt),
        isNull(bots.deletedAt),
        botId ? eq(bots.id, botId) : undefined,
      ),
    )
    .orderBy(asc(groupBots.addedAt))
  const [params, trusted] = await Promise.all([
    sysParams(ctx.db),
    trustedOn(
      ctx.db,
      rows.flatMap((r) => (r.machineId ? [r.machineId] : [])),
    ),
  ])
  return Promise.all(
    rows.map(async (r) => {
      const online = !!r.machineId && ctx.hub.isOnline(r.machineId)
      const { env } = await resolveSecrets(ctx.db, { groupId, botId: r.id, originUserId }, ctx.now())
      const state: BotState = {
        agentKind: r.agentKind,
        online,
        features: online ? ctx.hub.features(r.machineId!) : [],
        daemonVersion: r.daemonVersion,
        env,
        codeEnabled: params.pluginCodeEnabled,
        trusted: trusted(r.machineId),
      }
      return { id: r.id, name: r.name, state }
    }),
  )
}

/** A plugin's MCP servers as the run gets them: `<plugin>-<name>`, secrets filled in, the group's overrides applied. */
function pluginMcp(name: string, m: PluginManifest, env: Record<string, string>, off: Set<string>) {
  // Every name is in the manifest's `secrets`, which the run has (else the plugin is blocked).
  const fill = (values: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(values).map(([k, v]) => [k, v.replace(SECRET_REF, (_, n: string) => env[n] ?? '')]),
    )
  return m.contributes.mcp.flatMap((c): McpServer[] => {
    const full = `${name}-${c.name}`
    if (off.has(full)) return []
    return [
      c.transport === 'stdio'
        ? {
            transport: 'stdio',
            name: full,
            command: c.command[0]!,
            args: c.command.slice(1),
            env: fill(c.env),
          }
        : { transport: 'http', name: full, url: c.url, headers: fill(c.headers) },
    ]
  })
}

/**
 * RunStart.plugins (the caller checks the master switch): enabled in the group and usable by the bot this turn.
 * `asks`: versions held back only for want of the machine owner's consent.
 */
export async function runPlugins(
  db: Read,
  groupId: string,
  bot: { agentKind: string },
  machineId: string,
  features: string[],
  env: Record<string, string>,
  codeEnabled: boolean,
) {
  const [list, [machine], trusted, off] = await Promise.all([
    groupPluginList(db, groupId),
    db.select({ version: machines.daemonVersion }).from(machines).where(eq(machines.id, machineId)),
    trustedOn(db, [machineId]),
    mcpTurnedOff(db, groupId),
  ])
  const state: BotState = {
    agentKind: bot.agentKind,
    online: true,
    features,
    daemonVersion: machine?.version ?? null,
    env,
    codeEnabled,
    trusted: trusted(machineId),
  }
  const on = list.filter((r) => r.enabledInGroup)
  const blocked = (r: (typeof on)[number]) => pluginBlocker(r.version.manifest, state, r.version.id)
  const usable = on.filter((r) => !blocked(r))
  return {
    refs: usable.map((r): PluginRef => {
      const mcp = pluginMcp(r.plugin.name, r.version.manifest, env, off)
      return {
        name: r.plugin.name,
        versionId: r.version.id,
        digest: r.version.digest,
        ...(mcp.length ? { mcp } : {}),
      } as PluginRef
    }),
    /** Plugins with a creation skill, for the system prompt. */
    creations: usable.filter((r) => r.version.manifest.entry).map((r) => r.plugin.name),
    commands: chatCommands(usable.map((r) => r.version.manifest)),
    asks: on
      .filter((r) => blocked(r) === 'trust')
      .map((r) => ({ pluginId: r.plugin.id, versionId: r.version.id })),
  }
}

/**
 * Asks the machine's owner to allow plugin versions to run code there, once per version: a pending or decided
 * request is not asked again.
 */
export async function askPluginTrust(
  ctx: Ctx,
  machineId: string,
  asks: { pluginId: string; versionId: string }[],
) {
  if (!asks.length) return
  const made = await ctx.db
    .insert(pluginTrusts)
    .values(asks.map((a) => ({ machineId, ...a })))
    .onConflictDoNothing()
    .returning()
  if (!made.length) return
  const [machine] = await ctx.db.select().from(machines).where(eq(machines.id, machineId))
  if (!machine) return
  const rows = await ctx.db
    .select({ id: pluginTrusts.id, manifest: pluginVersions.manifest })
    .from(pluginTrusts)
    .innerJoin(pluginVersions, eq(pluginVersions.id, pluginTrusts.versionId))
    .where(
      inArray(
        pluginTrusts.id,
        made.map((m) => m.id),
      ),
    )
  for (const r of rows)
    await notify(
      ctx,
      machine.ownerId,
      'plugin_trust',
      {
        trustId: r.id,
        machineId,
        machineName: machine.label ?? machine.name,
        pluginTitle: r.manifest.title,
        version: r.manifest.version,
      },
      null,
    )
}
