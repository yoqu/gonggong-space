import { randomUUID } from 'node:crypto'
import type {
  ArtifactCommand,
  ArtifactCommandReq,
  ArtifactContext,
  ArtifactElementRef,
  GgArtifactManifest,
  MessageDto,
  SendAnnotationsReq,
} from '@gonggong/protocol'
import { and, eq, inArray } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { artifactAnnotations, messages } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { isUuid } from '../../lib/ids.js'
import { mirrorUserMessage } from '../feishu/mirror.js'
import { activeBots } from '../groups/service.js'
import { type MessageMeta, type MessageRow, messageDto, publishMessage } from '../messages/service.js'
import { triggerRuns } from '../runs/trigger.js'
import { readBlob } from './blobs.js'
import { type Element, elementsOf, lineOf, sectionOf } from './html.js'
import { type Artifact, manifestOf, requireVersion, type Version } from './service.js'

// Everything here is read by agents: not translated.

const SNIPPET_MAX = 300

/** Reads a version's HTML files once each, with their located elements. */
function sources(a: Artifact, v: Version) {
  const cache = new Map<string, Promise<{ html: string; els: Map<number, Element> } | null>>()
  return (file: string) => {
    let hit = cache.get(file)
    if (!hit) {
      const f = v.files.find((x) => x.path === file)
      hit = f
        ? readBlob(a.groupId, f.hash).then((b) => {
            const html = b.toString('utf8')
            return { html, els: elementsOf(html) }
          })
        : Promise.resolve(null)
      cache.set(file, hit)
    }
    return hit
  }
}

/** `screens/home.html 第 12 行（区块 data-section="hero"）：<h1 …>…</h1>` */
async function elementLine(source: ReturnType<typeof sources>, file: string, ggId: string | null) {
  const src = await source(file)
  const el = ggId === null ? undefined : src?.els.get(Number(ggId))
  const loc = el?.sourceCodeLocation
  if (!src || !el || !loc) return `${file}（脚本生成的元素，源码里没有对应位置）`
  const section = sectionOf(el)
  const snippet = src.html.slice(loc.startOffset, loc.endOffset).replace(/\s+/g, ' ').trim()
  return `${file} 第 ${lineOf(src.html, loc.startOffset)} 行${section ? `（区块 data-section="${section}"）` : ''}：${
    snippet.length > SNIPPET_MAX ? `${snippet.slice(0, SNIPPET_MAX)}…` : snippet
  }`
}

const screenLine = (m: GgArtifactManifest | null, id: string) => {
  const s = m?.screens.find((x) => x.id === id)
  return s ? `${s.id}（${s.title}，${s.file}）` : `${id}（清单里没有这一屏）`
}

async function contextLines(
  ctx: Ctx,
  a: Artifact,
  screenIds: string[],
  elements: (ArtifactElementRef & { label?: string })[],
) {
  const v = await requireVersion(ctx.db, a, null)
  const source = sources(a, v)
  const m = screenIds.length ? await manifestOf(a, v) : null
  const lines = [`产物「${a.title}」，目录 ${a.dir}/，当前版本 v${v.n}。`]
  if (screenIds.length) lines.push('选中的屏幕：', ...screenIds.map((id) => `- ${screenLine(m, id)}`))
  if (elements.length) {
    lines.push('选中的元素：')
    for (const e of elements)
      lines.push(`- ${await elementLine(source, e.file, e.ggId)}${e.label ? `（${e.label}）` : ''}`)
  }
  return { v, lines }
}

const RULES =
  '新增、删除屏幕时同步更新 gg-artifact.json；遵守产品原型插件 SKILL.md 的约定（颜色、圆角、字号只用令牌，不引入外部资源，不改 index.html 和 _gg/）。'

/** One instruction per command (§ Stitch Generate menu), for the selection that follows it. */
export function commandInstruction(r: Pick<ArtifactCommandReq, 'command' | 'text' | 'count'>, dir: string) {
  const ask = r.text?.trim() ? `要求：${r.text.trim()}` : ''
  const n = r.count ?? 3
  const by: Record<ArtifactCommand, string> = {
    variations: `为选中的每个屏幕各出 ${n} 个变体${ask ? `（${ask}）` : '（布局、配色、图片、字体、文案各有侧重）'}：每个变体是一个新屏（新 id，文件 screens/<id>.html），在 gg-artifact.json 里紧跟在原屏之后登记，标题写明变体方向；不要改原屏。`,
    regenerate: `重新设计选中的屏幕：保留屏幕 id、文件名和进出跳转（data-gg-link / data-gg-back），其余可以重做。${ask}`,
    'desktop-version': `为选中的屏幕各生成一个桌面端（宽 1280）版本：新屏 id 为 <原 id>-desktop，紧跟在原屏之后登记进 gg-artifact.json；内容与原屏一致，布局按桌面重新排。${ask}`,
    'missing-states': `为选中的屏幕补齐缺失的状态：空状态、加载中、出错（需要时再加无权限、离线），每个状态一个新屏，id 为 <原 id>-empty / -loading / -error 等，紧跟在原屏之后登记进 gg-artifact.json。${ask}`,
    animate: `给选中的屏幕加入场动效和交互反馈（元素依次出现、按钮按下、卡片悬停等），只用 CSS（transition、@keyframes），遵守 prefers-reduced-motion，不引入脚本库。${ask}`,
    'accessibility-audit': `对选中的屏幕做无障碍审计：对比度、字号、点击区域、图片 alt、语义标签、表单 label、焦点顺序。能修的直接在源码里修，回复里逐条列出发现的问题和处理结果。${ask}`,
    'instant-prototype': `把产物连成可点击的原型：给所有应该跳转的可点元素补上 data-gg-link="<目标屏 id>"（缺的目标屏就新建并登记），除入口屏外每屏都要有带 data-gg-back 的返回按钮。${ask}`,
    'app-store-assets': `生成应用商店上架物料：3–5 张竖屏截图（1290×2796，每张带一句卖点标题）作为新屏（id 以 store- 开头），1024×1024 的应用图标放到 assets/。${ask}`,
    'web-assets': `生成网站物料：落地页首屏横幅、社交分享图（1200×630）、favicon，作为新屏（id 以 web- 开头）或 assets/ 下的文件。${ask}`,
    'marketing-kit': `生成一套营销物料：海报、社交媒体配图、宣传横幅，风格与设计系统一致，作为新屏（id 以 mkt- 开头）登记进 gg-artifact.json。${ask}`,
    logo: `设计产品 logo：至少 3 个方案，每个写成 assets/logo-<n>.svg，再新建一屏（id 为 logo）在浅色和深色底上展示各方案。${ask}`,
    image: `按要求绘制插图，用 SVG 或 CSS 画，写到 assets/ 下并用在选中的屏幕里，不引用外部图片。${ask}`,
    diagram: `按要求画图表或流程图：作为新屏（id 以 diagram- 开头）用 HTML / SVG 绘制，登记进 gg-artifact.json。${ask}`,
    'project-brief': `根据当前产物写一份产品需求文档（PRD）到 ${dir}/brief.md：背景、目标用户、核心流程、每屏的功能与字段、交互与状态、待定问题。回复里用几句话总结。${ask}`,
    'edit-with-ai': `只修改下面选中的元素，${ask || '按说明修改'}。不要改动其他元素和屏幕。`,
    'apply-design-system': `按产物当前的 ${dir}/DESIGN.md 和 ${dir}/tokens.css 统一所有屏幕的视觉：颜色、字体、圆角、间距、组件样式改用其中的令牌和规范，不改内容和结构（文案、区块、屏幕、跳转都保持不变）。${ask}`,
    'connect-element': `新建一屏：${r.text?.trim() ?? ''}。新屏用新 id（文件 screens/<id>.html），登记进 gg-artifact.json，内容与风格和现有屏幕一致、带 data-gg-back 返回按钮；再给下面选中的元素加 data-gg-link="<新屏 id>"，其他元素和屏幕不要改。`,
  }
  return by[r.command]
}

/** Posts a message as the member @-ing the bot about the artifact: its run checks the artifact out first. */
async function postAsMember(
  ctx: Ctx,
  me: { id: string; name: string },
  a: Artifact,
  botId: string,
  body: (botName: string) => string,
) {
  const bot =
    (await activeBots(ctx, a.groupId)).find((b) => b.id === botId) ?? fail('invalid', 'Bot 不在本群')
  const meta: MessageMeta = { mentions: [bot.id], artifactRefs: [a.id], clientId: randomUUID() }
  const [row] = (await ctx.db
    .insert(messages)
    .values({ groupId: a.groupId, kind: 'user', authorUserId: me.id, body: body(bot.name), meta })
    .returning()) as [MessageRow]
  const dto = messageDto(row, me.name)
  await publishMessage(ctx, dto)
  await mirrorUserMessage(ctx, row, me)
  await triggerRuns(ctx, row)
  return dto
}

/** POST /api/artifacts/:id/commands */
export async function sendCommand(
  ctx: Ctx,
  me: { id: string; name: string },
  a: Artifact,
  r: ArtifactCommandReq,
): Promise<MessageDto> {
  const { lines } = await contextLines(ctx, a, r.screenIds ?? [], r.ggIds ?? [])
  return postAsMember(ctx, me, a, r.botId, (bot) =>
    [`@${bot} ${commandInstruction(r, a.dir)}`, '', ...lines, '', RULES].join('\n'),
  )
}

/** POST /api/artifacts/:id/annotations/send — the open annotations become `sent` with the message. */
export async function sendAnnotations(
  ctx: Ctx,
  me: { id: string; name: string },
  a: Artifact,
  r: SendAnnotationsReq,
): Promise<MessageDto> {
  const ids = r.annotationIds.filter(isUuid)
  const rows = ids.length
    ? await ctx.db
        .select()
        .from(artifactAnnotations)
        .where(and(eq(artifactAnnotations.artifactId, a.id), inArray(artifactAnnotations.id, ids)))
    : []
  if (rows.length !== new Set(r.annotationIds).size) fail('not_found', '批注不存在')
  const head = await requireVersion(ctx.db, a, null)
  const byVersion = new Map<string, ReturnType<typeof sources>>()
  const lines: string[] = []
  for (const [i, n] of rows.entries()) {
    const v = await requireVersion(ctx.db, a, n.versionId)
    const source = byVersion.get(v.id) ?? sources(a, v)
    byVersion.set(v.id, source)
    lines.push(
      `${i + 1}. ${await elementLine(source, n.file, n.ggId)}`,
      `   选择器：${n.selector}${v.id === head.id ? '' : `（批注于 v${v.n}，当前是 v${head.n}，位置可能已变）`}`,
      `   意见：${n.note}`,
    )
  }
  const dto = await postAsMember(ctx, me, a, r.botId, (bot) =>
    [
      `@${bot} 请按以下批注修改产物「${a.title}」（目录 ${a.dir}/，当前版本 v${head.n}）：`,
      ...lines,
      ...(r.extra?.trim() ? ['', `补充说明：${r.extra.trim()}`] : []),
      '',
      RULES,
      '改完后简短说明每条批注是怎么处理的。',
    ].join('\n'),
  )
  await ctx.db
    .update(artifactAnnotations)
    .set({ status: 'sent', sentMessageId: dto.id })
    .where(
      inArray(
        artifactAnnotations.id,
        rows.map((n) => n.id),
      ),
    )
  return dto
}

/** SendMessageReq.artifactContext: what the agent reads after the member's text (meta.artifactNote). */
export async function artifactContextNote(ctx: Ctx, a: Artifact, c: ArtifactContext) {
  const { lines } = await contextLines(ctx, a, c.screenIds ?? [], c.elements ?? [])
  return ['[画布上下文：这条消息针对下面的产物和选中内容]', ...lines].join('\n')
}
