import type {
  GONGGONG_TOOLS,
  InstallDto,
  InstalledTarget,
  ListingVersionDto,
  ListingVisibility,
  MarketSource,
  ReviewStatus,
  SkillFile,
} from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import type { z } from 'zod'
import type { Ctx } from '../../context.js'
import { skills, users } from '../../db/schema.js'
import { HttpError } from '../../lib/errors.js'
import { isUuid } from '../../lib/ids.js'
import {
  importGithub,
  listingFile,
  marketDetail,
  marketList,
  myListings,
  publish,
  reviewQueue,
  reviewVersion,
  submitVersion,
  updateListing,
} from '../market/publish.js'
import { createRequest } from '../market/requests.js'
import { deleteInstall, listInstalls, putInstall, type Target } from '../market/service.js'
import { listed, mergeSkills, visibleIn } from '../skills/service.js'
import { isLayerAdmin, type Run, teamOf } from './layers.js'
import { asTool, refuse, type ToolOutput } from './service.js'

type Args<N extends keyof typeof GONGGONG_TOOLS> = z.infer<(typeof GONGGONG_TOOLS)[N]['input']>
type Me = typeof users.$inferSelect
type InstallLayer = 'group' | 'team' | 'personal'
type Ref = { id: string; name: string; team: string | null }

const TYPE = { skill: 'Skill', plugin: '插件' } as const
const VISIBILITY: Record<ListingVisibility, string> = { team: '团队内可见', public: '公开' }
const REVIEW: Record<ReviewStatus, string> = {
  draft: '草稿',
  pending: '待审核',
  approved: '已通过',
  rejected: '已驳回',
}
const STATUS = { listed: '已上架', unlisted: '已下架', banned: '已封禁' } as const
/** `listed` only means not taken down: nothing shows in the market before a version is approved. */
const statusOf = (l: { status: keyof typeof STATUS; listedVersionId: string | null }) =>
  l.status === 'listed' && !l.listedVersionId ? '未上架' : STATUS[l.status]
const LAYER: Record<InstallLayer, string> = { group: '本群', team: '本团队', personal: '发起人个人' }

const time = (iso: string) => `${iso.slice(0, 16).replace('T', ' ')} UTC`
const text = (lines: string[]): ToolOutput => ({ text: lines.join('\n'), groups: [] })

async function originator(ctx: Ctx, run: Run): Promise<Me> {
  const [me] = await ctx.db.select().from(users).where(eq(users.id, run.originUserId))
  return me ?? refuse('发起人不存在')
}

const forbiddenAsEmpty = (e: unknown): never[] => {
  if (e instanceof HttpError && e.code === 'forbidden') return []
  throw e
}

/** A listing named by id, or by name among `pool` (several teams may use one name: then by id). */
function pick(ref: string, pool: Ref[], hint: string) {
  if (isUuid(ref)) return ref
  const hits = [...new Map(pool.filter((p) => p.name === ref).map((p) => [p.id, p])).values()]
  if (!hits.length) return refuse(`没有找到条目「${ref}」，${hint}`)
  if (hits.length > 1)
    refuse(
      [
        `有 ${hits.length} 个名为「${ref}」的条目，请用 id 指定：`,
        ...hits.map((h) => `- ${h.id}（${h.team ? `团队「${h.team}」` : '官方'}）`),
      ].join('\n'),
    )
  return hits[0]!.id
}

const refs = (rows: { id: string; name: string; teamName?: string | null }[]): Ref[] =>
  rows.map((r) => ({ id: r.id, name: r.name, team: r.teamName ?? null }))

/** Pending versions the originator reviews: their group's team's (as its admin) and, for sysadmins, public ones. */
async function myQueue(ctx: Ctx, me: Me, teamId: string) {
  return [
    ...(await reviewQueue(ctx, me, teamId).catch(forbiddenAsEmpty)),
    ...(me.role === 'sysadmin' ? await reviewQueue(ctx, me) : []),
  ]
}

/** The listing's version numbered `revision`, among those the originator may see. */
async function versionOf(ctx: Ctx, me: Me, listingId: string, revision: number) {
  const detail = await marketDetail(ctx, me, listingId)
  return (
    detail.versions.find((v) => v.revision === revision) ??
    refuse(`「${detail.name}」没有可见的 v${revision}，请用 market_get 查看版本`)
  )
}

const sourceLabel = (source: MarketSource, team: string | null) =>
  source === 'official' ? '官方' : source === 'team' ? `团队「${team}」` : `公开 · 团队「${team}」`

const targetLabel = (t: InstalledTarget) =>
  ({
    user: '个人',
    group: `群「${t.label}」`,
    team: `团队「${t.label}」`,
    repo: `仓库「${t.label}」`,
  })[t.scope]

const versionLine = (v: ListingVersionDto, listedId: string | null) => [
  `- v${v.revision} · ${REVIEW[v.reviewStatus]}${v.id === listedId ? '（上架中）' : ''} · ${v.createdBy ?? '已删除用户'} · ${time(v.createdAt)}`,
  ...(v.changelog ? [`  更新说明：${v.changelog}`] : []),
  ...(v.reviewNote ? [`  审核意见：${v.reviewNote}`] : []),
]

export async function marketListTool(ctx: Ctx, run: Run, a: Args<'market_list'>): Promise<ToolOutput> {
  const rows = await marketList(ctx, await originator(ctx, run), a)
  if (!rows.length) return text([a.q || a.type || a.source ? '市场里没有符合条件的条目' : '市场里还没有条目'])
  return text([
    `市场条目（${rows.length} 个）：`,
    ...rows.flatMap((r) => [
      `- ${r.name}（${r.title}）· ${TYPE[r.type]} · ${sourceLabel(r.source, r.teamName)} · v${r.listedRevision} · 引入 ${r.installs} 次 · id ${r.id}`,
      `  说明：${r.description}`,
      ...(r.installedIn?.length ? [`  已引入：${r.installedIn.map(targetLabel).join('、')}`] : []),
    ]),
    '用 market_get 查看详情，market_install 引入。',
  ])
}

export async function marketGet(ctx: Ctx, run: Run, a: Args<'market_get'>): Promise<ToolOutput> {
  const me = await originator(ctx, run)
  const id = isUuid(a.listing)
    ? a.listing
    : pick(
        a.listing,
        [
          ...refs(await marketList(ctx, me, { q: a.listing })),
          ...refs(await myListings(ctx.db, me)),
          ...refs((await myQueue(ctx, me, await teamOf(ctx, run))).map((r) => r.listing)),
        ],
        '请用 market_list 或 market_mine 查看',
      )
  return asTool(async () => {
    const versionId = a.version ? (await versionOf(ctx, me, id, a.version)).id : undefined
    if (a.path) {
      const f = await listingFile(ctx, me, id, a.path, versionId)
      return text([
        `=== ${f.path} ===`,
        f.encoding === 'base64'
          ? `（二进制文件，${Buffer.from(f.content, 'base64').length} 字节，内容省略）`
          : f.content,
      ])
    }
    const d = await marketDetail(ctx, me, id, versionId)
    const status = d.status === 'banned' ? `已封禁：${d.banReason}` : statusOf(d)
    return text([
      `「${d.title}」（${d.name}）· ${TYPE[d.type]} · ${sourceLabel(d.source, d.teamName)}${d.visibility ? ` · ${VISIBILITY[d.visibility]}` : ''} · ${status}`,
      `id ${d.id} · 作者 ${d.author ?? '—'} · 显示 v${d.revision} · 引入 ${d.installs} 次${d.canEdit ? ' · 发起人是维护者' : ''}${d.canReview ? ' · 发起人可审核' : ''}`,
      `说明：${d.description}`,
      ...(d.ghSource ? [`来源：${d.ghSource.url}（commit ${d.ghSource.commit.slice(0, 7)}）`] : []),
      ...(d.installedIn?.length ? [`已引入：${d.installedIn.map(targetLabel).join('、')}`] : []),
      '版本：',
      ...d.versions.flatMap((v) => versionLine(v, d.listedVersionId)),
      `文件（${d.files.length}）：`,
      ...d.files.map((f) => `- ${f.path} · ${f.size} 字节`),
      ...(d.readme ? ['=== README ===', d.readme] : []),
    ])
  })
}

/** The files of the skill in effect here named `name` (as skill_get picks it). */
async function skillFiles(ctx: Ctx, run: Run, name: string) {
  const rows = await listed(ctx.db).where(and(visibleIn(ctx.db, run.groupId), eq(skills.name, name)))
  const winner =
    mergeSkills(rows.filter((r) => r.skill.enabled).map((r) => r.skill))[0] ??
    mergeSkills(rows.map((r) => r.skill))[0] ??
    refuse(`本群没有名为「${name}」的 Skill，请用 skill_list 查看`)
  return rows.find((r) => r.skill === winner)!.version.files as SkillFile[]
}

const SUBMITTABLE = new Set<ReviewStatus>(['draft', 'rejected'])

export async function marketPublish(ctx: Ctx, run: Run, a: Args<'market_publish'>): Promise<ToolOutput> {
  const me = await originator(ctx, run)
  const teamId = await teamOf(ctx, run)
  const visibility = a.visibility ?? 'team'
  const files = a.skill ? await skillFiles(ctx, run, a.skill) : a.files
  return asTool(async () => {
    const { body } = files
      ? await publish(ctx, me, { teamId, visibility, files })
      : await importGithub(ctx, me, { teamId, visibility, url: a.github! })
    let { listing } = body
    const reviewers = listing.visibility === 'team' ? '团队管理员' : '系统管理员'
    const out = [
      body.unchanged
        ? `「${listing.name}」的内容与最新上传的 v${listing.latest.revision} 相同，没有新建版本`
        : `已上传「${listing.name}」到市场（${VISIBILITY[listing.visibility]}）：v${listing.latest.revision} 草稿 · id ${listing.id}`,
      ...body.warnings.map((w) => `注意：${w}`),
    ]
    if (a.submit && SUBMITTABLE.has(listing.latest.reviewStatus)) {
      listing = await submitVersion(ctx, me, listing.id, listing.latest.id, a.changelog ?? '')
      out.push(`已提交 v${listing.latest.revision} 审核，等${reviewers}审核通过后上架`)
    } else if (a.submit)
      out.push(`v${listing.latest.revision} 当前是${REVIEW[listing.latest.reviewStatus]}状态，无需再提交`)
    else out.push(`用 market_submit 提交审核，${reviewers}审核通过后上架`)
    return text(out)
  })
}

export async function marketMine(ctx: Ctx, run: Run): Promise<ToolOutput> {
  const rows = await myListings(ctx.db, await originator(ctx, run))
  if (!rows.length) return text(['发起人还没有发布过条目，用 market_publish 上传'])
  return text([
    `发起人维护的条目（${rows.length} 个）：`,
    ...rows.flatMap((r) => [
      `- ${r.name}（${r.title}）· ${TYPE[r.type]} · ${VISIBILITY[r.visibility]} · ${statusOf(r)} · 最新 v${r.latest.revision} ${REVIEW[r.latest.reviewStatus]} · 上架 ${r.listedVersionId ? `v${r.revision}` : '无'} · id ${r.id}`,
      ...(r.latest.reviewNote ? [`  审核意见：${r.latest.reviewNote}`] : []),
      ...(r.banReason ? [`  封禁原因：${r.banReason}`] : []),
    ]),
  ])
}

const MINE_HINT = '发起人只能操作自己维护的条目，请用 market_mine 查看'

export async function marketSubmit(ctx: Ctx, run: Run, a: Args<'market_submit'>): Promise<ToolOutput> {
  const me = await originator(ctx, run)
  const mine = await myListings(ctx.db, me)
  const id = pick(a.listing, refs(mine), MINE_HINT)
  return asTool(async () => {
    const versionId = a.version
      ? (await versionOf(ctx, me, id, a.version)).id
      : (mine.find((m) => m.id === id) ?? refuse(MINE_HINT)).latest.id
    const listing = await submitVersion(ctx, me, id, versionId, a.changelog)
    const v = a.version ?? listing.latest.revision
    return text([`已提交「${listing.name}」v${v} 审核`])
  })
}

export async function marketUpdate(ctx: Ctx, run: Run, a: Args<'market_update'>): Promise<ToolOutput> {
  const me = await originator(ctx, run)
  const id = pick(a.listing, refs(await myListings(ctx.db, me)), MINE_HINT)
  return asTool(async () => {
    const r = await updateListing(ctx, me, id, { visibility: a.visibility, status: a.status })
    return text([`已更新「${r.name}」：${VISIBILITY[r.visibility]} · ${statusOf(r)}`])
  })
}

async function targetOf(ctx: Ctx, run: Run, me: Me, layer: InstallLayer): Promise<Target> {
  if (layer === 'personal') return { scope: 'user', scopeId: me.id, teamId: null, groupId: null }
  const teamId = await teamOf(ctx, run)
  return layer === 'group'
    ? { scope: 'group', scopeId: run.groupId, teamId, groupId: run.groupId }
    : { scope: 'team', scopeId: teamId, teamId, groupId: null }
}

const administers = (ctx: Ctx, me: Me, t: Target) =>
  t.scope === 'user' ||
  isLayerAdmin(ctx, me.id, {
    scope: t.scope === 'group' ? 'group' : 'team',
    teamId: t.teamId,
    groupId: t.groupId,
  })

const installLine = (i: InstallDto) =>
  `- ${i.listing.name}（${i.listing.title}）· ${TYPE[i.listing.type]} · v${i.resolvedRevision}${i.pinVersionId ? '（固定版本）' : '（跟随最新）'} · ${i.enabled ? '启用' : '停用'}${i.banReason ? ` · 已封禁：${i.banReason}` : ''} · id ${i.listing.id}`

export async function marketInstalls(ctx: Ctx, run: Run): Promise<ToolOutput> {
  const me = await originator(ctx, run)
  const out: string[] = []
  for (const layer of ['group', 'team', 'personal'] as const) {
    const rows = await listInstalls(ctx.db, await targetOf(ctx, run, me, layer))
    out.push(`${LAYER[layer]}（${rows.length}）：`, ...rows.map(installLine))
  }
  return text(out)
}

export async function marketInstall(ctx: Ctx, run: Run, a: Args<'market_install'>): Promise<ToolOutput> {
  const me = await originator(ctx, run)
  const layer = a.layer ?? 'group'
  const t = await targetOf(ctx, run, me, layer)
  const installed = (await listInstalls(ctx.db, t)).find(
    (r) => r.listing.id === a.listing || r.listing.name === a.listing,
  )
  const id =
    installed?.listing.id ??
    pick(
      a.listing,
      [...refs(await marketList(ctx, me, { q: a.listing })), ...refs(await myListings(ctx.db, me))],
      '请用 market_list 查看',
    )
  return asTool(async () => {
    const pin =
      a.version === undefined
        ? (installed?.pinVersionId ?? null)
        : a.version === 'latest'
          ? null
          : (await versionOf(ctx, me, id, a.version)).id
    if (!(await administers(ctx, me, t))) {
      if (installed) refuse(`发起人不是${LAYER[layer]}的管理员，不能修改已引入的条目`)
      await createRequest(ctx, me, {
        listingId: id,
        scope: t.scope as 'group' | 'team',
        scopeId: t.scopeId,
        pinVersionId: pin,
        note: a.note ?? '',
      })
      return text([`发起人不是${LAYER[layer]}的管理员，已向管理员发出引入申请，批准后生效`])
    }
    const r = await putInstall(
      ctx,
      t,
      id,
      { enabled: a.enabled ?? installed?.enabled ?? true, pinVersionId: pin },
      me.id,
    )
    const how = r.pinVersionId ? `固定在 v${r.resolvedRevision}` : `跟随最新（当前 v${r.resolvedRevision}）`
    return text([
      `已${installed ? '更新' : '引入'}${LAYER[layer]}的「${r.listing.name}」：${how} · ${r.enabled ? '启用' : '停用'}，下一轮生效`,
    ])
  })
}

export async function marketUninstall(ctx: Ctx, run: Run, a: Args<'market_uninstall'>): Promise<ToolOutput> {
  const me = await originator(ctx, run)
  const layer = a.layer ?? 'group'
  const t = await targetOf(ctx, run, me, layer)
  if (!(await administers(ctx, me, t))) refuse(`发起人不是${LAYER[layer]}的管理员，不能移除`)
  const rows = await listInstalls(ctx.db, t)
  const hit =
    rows.find((r) => r.listing.id === a.listing || r.listing.name === a.listing) ??
    refuse(`${LAYER[layer]}没有引入「${a.listing}」，请用 market_installs 查看`)
  await deleteInstall(ctx, t, hit.listing.id, me.id)
  return text([`已从${LAYER[layer]}移除「${hit.listing.name}」，下一轮生效`])
}

export async function marketReviews(ctx: Ctx, run: Run): Promise<ToolOutput> {
  const me = await originator(ctx, run)
  const rows = await myQueue(ctx, me, await teamOf(ctx, run))
  if (!rows.length) return text(['没有等发起人审核的版本'])
  return text([
    `待审核版本（${rows.length} 个）：`,
    ...rows.flatMap(({ listing: l, version: v }) => [
      `- ${l.name}（${l.title}）v${v.revision} · ${TYPE[l.type]} · ${l.visibility ? VISIBILITY[l.visibility] : ''} · 团队「${l.teamName}」· ${v.createdBy ?? '已删除用户'} 提交于 ${time(v.createdAt)} · 上架中 ${l.listedRevision ? `v${l.listedRevision}` : '无'} · id ${l.id}`,
      ...(v.changelog ? [`  更新说明：${v.changelog}`] : []),
    ]),
    '用 market_get（带 version）阅读内容，再用 market_review 通过或驳回。',
  ])
}

export async function marketReview(ctx: Ctx, run: Run, a: Args<'market_review'>): Promise<ToolOutput> {
  const me = await originator(ctx, run)
  const queue = await myQueue(ctx, me, await teamOf(ctx, run))
  const id = pick(
    a.listing,
    refs(queue.map((r) => r.listing)),
    '没有等发起人审核的同名条目，请用 market_reviews 查看',
  )
  const item =
    queue.find((r) => r.listing.id === id && r.version.revision === a.version) ??
    refuse(`「${a.listing}」的 v${a.version} 不在发起人的待审核列表里，请用 market_reviews 查看`)
  await asTool(() =>
    reviewVersion(
      ctx,
      me,
      id,
      item.version.id,
      a.approve ? { approve: true, note: a.note ?? '' } : { approve: false, note: a.note! },
    ),
  )
  return text([
    a.approve
      ? `已通过「${item.listing.name}」v${a.version}${!item.listing.listedRevision || a.version > item.listing.listedRevision ? '，已上架' : ''}`
      : `已驳回「${item.listing.name}」v${a.version}：${a.note}`,
  ])
}
