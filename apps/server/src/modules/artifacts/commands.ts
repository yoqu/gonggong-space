import { randomUUID } from 'node:crypto'
import {
  ArtifactCommand,
  type ArtifactCommandReq,
  type ArtifactContext,
  type ArtifactElementRef,
  type GgArtifactManifest,
  type MessageCanvas,
  type MessageDto,
  type SendAnnotationsReq,
} from '@gonggong/protocol'
import { and, eq, inArray } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { artifactAnnotations, messages } from '../../db/schema.js'
import { type MessageKey, t } from '../../i18n/index.js'
import { fail } from '../../lib/errors.js'
import { isUuid } from '../../lib/ids.js'
import { mirrorUserMessage } from '../feishu/mirror.js'
import { activeBots } from '../groups/service.js'
import { type MessageMeta, type MessageRow, messageDto, publishMessage } from '../messages/service.js'
import { findDesignSystem } from '../plugins/designSystems.js'
import { triggerRuns } from '../runs/trigger.js'
import { readBlob } from './blobs.js'
import { type Element, elementsOf, lineOf, sectionOf, textOf } from './html.js'
import { pluginCommands } from './kit.js'
import { type Artifact, manifestOf, requireVersion, type Version } from './service.js'

// Everything here is read by agents (not translated), except the short message bodies members see.

const SNIPPET_MAX = 300
/** Elements of a region annotation listed for the agent. */
const REGION_LINES = 10

/** The `data-gg-id`s a region annotation's snippet lists (the web writes them separated by commas or spaces). */
function regionIds(snippet: string) {
  const parts = snippet.split(/[\s,，、]+/).filter(Boolean)
  return parts.every((p) => /^\d{1,9}$/.test(p)) ? parts : []
}

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

const LABEL_MAX = 40
const cut = (text: string) => {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > LABEL_MAX ? `${one.slice(0, LABEL_MAX)}…` : one
}

/** An element's label for the message bubble: its text, else its tag. */
async function elementLabel(source: ReturnType<typeof sources>, file: string, ggId: string) {
  const el = (await source(file))?.els.get(Number(ggId))
  return el ? cut(textOf(el)) || `<${el.tagName}>` : `#${ggId}`
}

/** One per element (`file#ggId`), the first kept: several annotations on one element name it once. */
const uniqueElements = <T extends ArtifactElementRef>(list: T[]) => {
  const seen = new Set<string>()
  return list.filter((e) => !seen.has(`${e.file}#${e.ggId}`) && !!seen.add(`${e.file}#${e.ggId}`))
}

type Selection = {
  screenIds: string[]
  elements: (ArtifactElementRef & { label?: string })[]
  refs?: string[]
}

const REF_KIND = { image: '图片', pdf: 'PDF', text: '文本' } as const

/** The agent's context lines for a selection, and the selection as the message bubble shows it. */
async function contextLines(ctx: Ctx, a: Artifact, sel: Selection) {
  const v = await requireVersion(ctx.db, a, null)
  const source = sources(a, v)
  const m = await manifestOf(a, v)
  const lines = [`产物「${a.title}」，目录 ${a.dir}/，当前版本 v${v.n}。`]
  if (sel.screenIds.length) lines.push('选中的屏幕：', ...sel.screenIds.map((id) => `- ${screenLine(m, id)}`))
  const elements: MessageCanvas['elements'] = []
  if (sel.elements.length) {
    lines.push('选中的元素：')
    for (const e of uniqueElements(sel.elements)) {
      lines.push(`- ${await elementLine(source, e.file, e.ggId)}${e.label ? `（${e.label}）` : ''}`)
      elements.push({
        file: e.file,
        ggId: e.ggId,
        label: e.label || (await elementLabel(source, e.file, e.ggId)),
      })
    }
  }
  const refs = (sel.refs ?? []).map(
    (file) => m?.refs?.find((r) => r.file === file) ?? fail('invalid', '参考不存在：{id}', { id: file }),
  )
  if (refs.length)
    lines.push(
      '参考文件（成员放到画布上的资料，已随产物检出，请先查看再按要求处理）：',
      ...refs.map((r) => `- ${a.dir}/${r.file}（${REF_KIND[r.kind]}：${r.title}）`),
    )
  const canvas: MessageCanvas = {
    artifactId: a.id,
    title: a.title,
    screens: sel.screenIds.map((id) => ({ id, title: m?.screens.find((x) => x.id === id)?.title ?? id })),
    elements,
    ...(refs.length && { refs: refs.map((r) => ({ id: r.id, title: r.title })) }),
  }
  return { v, lines, canvas }
}

/** `「产物」 › 首页、详情 › 标题`: the selection in one line, under the short message. */
const summaryLine = (c: MessageCanvas) =>
  [
    `「${c.title}」`,
    c.screens.map((s) => s.title).join('、'),
    c.elements.map((e) => e.label).join('、'),
    (c.refs ?? []).map((r) => r.title).join('、'),
  ]
    .filter(Boolean)
    .join(' › ')

const RULES =
  '新增、删除屏幕时同步更新 gg-artifact.json；遵守产物所属插件 SKILL.md 的约定（颜色、圆角、字号只用令牌，不引入外部资源，不改 index.html 和 _gg/）。'

/** One instruction per platform command (§ Stitch Generate menu), for the selection that follows it. */
export function commandInstruction(
  r: Pick<ArtifactCommandReq, 'text' | 'count' | 'ggIds'> & { command: ArtifactCommand },
  dir: string,
) {
  const ask = r.text?.trim() ? `要求：${r.text.trim()}` : ''
  const n = r.count ?? 3
  // Without elements the selection is whole screens.
  const elements = !!r.ggIds?.length
  const newScreen = `新建一屏：${r.text?.trim() ?? ''}。新屏用新 id（文件 screens/<id>.html），登记进 gg-artifact.json，内容与风格和现有屏幕一致、带 data-gg-back 返回按钮；`
  const by: Record<ArtifactCommand, string> = {
    variations: `为选中的每个屏幕各出 ${n} 个变体${ask ? `（${ask}）` : '（布局、配色、图片、字体、文案各有侧重）'}：每个变体是一个新屏（新 id，文件 screens/<id>.html），在 gg-artifact.json 里紧跟在原屏之后登记，标题写明变体方向；不要改原屏。`,
    regenerate: `重新设计选中的屏幕：保留屏幕 id、文件名和进出跳转（data-gg-link / data-gg-back），其余可以重做。${ask}`,
    animate: `给选中的屏幕加入场动效和交互反馈（元素依次出现、按钮按下、卡片悬停等），只用 CSS（transition、@keyframes），遵守 prefers-reduced-motion，不引入脚本库。${ask}`,
    logo: `设计产品 logo：至少 3 个方案，每个写成 assets/logo-<n>.svg，再新建一屏（id 为 logo）在浅色和深色底上展示各方案。${ask}`,
    image: `按要求绘制插图，用 SVG 或 CSS 画，写到 assets/ 下并用在选中的屏幕里，不引用外部图片。${ask}`,
    diagram: `按要求画图表或流程图：作为新屏（id 以 diagram- 开头）用 HTML / SVG 绘制，登记进 gg-artifact.json。${ask}`,
    'edit-with-ai': elements
      ? `只修改下面选中的元素，${ask || '按说明修改'}。不要改动其他元素和屏幕。`
      : `按要求修改下面选中的整屏，${ask || '按说明修改'}。保留屏幕 id、文件名和进出跳转（data-gg-link / data-gg-back），不要改动其他屏幕。`,
    'apply-design-system': `按产物当前的 ${dir}/DESIGN.md 和 ${dir}/tokens.css 统一所有屏幕的视觉：颜色、字体、圆角、间距、组件样式改用其中的令牌和规范，不改内容和结构（文案、区块、屏幕、跳转都保持不变）。${ask}`,
    'connect-element': elements
      ? `${newScreen}再给下面选中的元素加 data-gg-link="<新屏 id>"，其他元素和屏幕不要改。`
      : `${newScreen}再在下面选中的屏幕里找合适的位置加一个进入新屏的入口（按钮、列表项或卡片等，带 data-gg-link="<新屏 id>"），与原有布局协调，其他屏幕不要改。`,
  }
  return by[r.command]
}

/** What members see of each command (the message body); the agent gets commandInstruction in the note. */
const COMMAND_LABEL: Record<ArtifactCommand, MessageKey> = {
  variations: '生成 {n} 个变体',
  regenerate: '重新生成',
  animate: '添加动效',
  logo: '设计 Logo',
  image: '绘制插图',
  diagram: '绘制图表',
  'edit-with-ai': '修改#edit',
  'apply-design-system': '套用设计系统',
  'connect-element': '新建一屏并连接',
}

const withText = (action: string, text: string | undefined) =>
  text?.trim() ? t('{action}：{text}', { action, text: text.trim() }) : action

/**
 * Posts a message as the member @-ing the bot about the artifact: a short sentence and the selection for people, the
 * full instruction in `artifactNote` for the agent. Its run checks the artifact out first.
 */
async function postAsMember(
  ctx: Ctx,
  me: { id: string; name: string },
  a: Artifact,
  botId: string,
  say: { action: string; canvas: MessageCanvas; note: string[] },
) {
  const bot =
    (await activeBots(ctx, a.groupId)).find((b) => b.id === botId) ?? fail('invalid', 'Bot 不在本群')
  const meta: MessageMeta = {
    mentions: [bot.id],
    artifactRefs: [a.id],
    artifactNote: say.note.join('\n'),
    canvas: say.canvas,
    clientId: randomUUID(),
  }
  const body = `@${bot.name} ${say.action}\n${summaryLine(say.canvas)}`
  const [row] = (await ctx.db
    .insert(messages)
    .values({ groupId: a.groupId, kind: 'user', authorUserId: me.id, body, meta })
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
  const core = ArtifactCommand.safeParse(r.command)
  const plugin = core.success
    ? null
    : ((await pluginCommands(ctx.db, a.pluginVersionId)).find((c) => c.name === r.command) ??
      fail('invalid', '这个产物没有指令 {name}', { name: r.command }))
  const ds =
    r.command === 'apply-design-system' && r.designSystemId
      ? ((await findDesignSystem(ctx, a.groupId, r.designSystemId)) ?? fail('not_found', '设计系统不存在'))
      : null
  const { lines, canvas } = await contextLines(ctx, a, {
    screenIds: r.screenIds ?? [],
    elements: r.ggIds ?? [],
  })
  return postAsMember(ctx, me, a, r.botId, {
    action: withText(
      core.success ? t(COMMAND_LABEL[core.data], { n: r.count ?? 3 }) : plugin!.title,
      ds?.title ?? r.text,
    ),
    canvas,
    note: [
      '[画布指令：上面这条消息的完整要求]',
      ...(ds ? importedDesignLines(ds, a.dir) : []),
      core.success
        ? commandInstruction({ ...r, command: core.data }, a.dir)
        : `${plugin!.prompt.replaceAll('{dir}', a.dir)}${r.text?.trim() ? `要求：${r.text.trim()}` : ''}`,
      '',
      ...lines,
      '',
      RULES,
    ],
  })
}

/** A design system the group imported, for apply-design-system (agent-facing: not translated). */
function importedDesignLines(
  ds: { title: string; designMd: string | null; url: string | null; repo: string | null },
  dir: string,
) {
  return [
    `先套用本群导入的设计系统「${ds.title}」：按 SKILL.md ${ds.designMd ? '当作「粘贴 DESIGN.md」处理（原文见下）' : '从下面的参考来源提取'}，重写 ${dir}/DESIGN.md 和 ${dir}/tokens.css。tokens.css 保留现有的变量名、只改取值，缺的令牌再补。`,
    ...(ds.url ? [`参考网站：${ds.url}`] : []),
    ...(ds.repo ? [`参考仓库：${ds.repo}`] : []),
    // Four backticks: a DESIGN.md may hold ``` blocks of its own.
    ...(ds.designMd ? ['DESIGN.md 原文：', '````markdown', ds.designMd, '````'] : []),
    '然后：',
  ]
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
  const m = await manifestOf(a, head)
  const byVersion = new Map<string, ReturnType<typeof sources>>()
  const lines: string[] = []
  for (const [i, n] of rows.entries()) {
    const v = await requireVersion(ctx.db, a, n.versionId)
    const source = byVersion.get(v.id) ?? sources(a, v)
    byVersion.set(v.id, source)
    const region = n.ggId === null && n.selector === ''
    const ids = region ? regionIds(n.snippet) : []
    const r = [n.rect.x, n.rect.y, n.rect.w, n.rect.h].map(Math.round).join(',')
    const target = region
      ? [
          `${n.file} 区域 (${r})（x,y,w,h，屏幕 CSS 像素）内：${n.snippet || '（没有元素，指这块空白区域）'}`,
          ...(await Promise.all(
            ids.slice(0, REGION_LINES).map(async (id) => `   - ${await elementLine(source, n.file, id)}`),
          )),
          ...(ids.length > REGION_LINES ? [`   - …另有 ${ids.length - REGION_LINES} 个元素`] : []),
        ].join('\n')
      : await elementLine(source, n.file, n.ggId)
    lines.push(
      `${i + 1}. ${target}`,
      `   ${n.selector ? `选择器：${n.selector}` : '框选区域'}${v.id === head.id ? '' : `（批注于 v${v.n}，当前是 v${head.n}，位置可能已变）`}`,
      `   意见：${n.note}`,
    )
  }
  const screenIds = [
    ...new Set(rows.map((n) => /^screens\/(.+)\.html$/.exec(n.file)?.[1]).filter((x) => !!x)),
  ]
  const canvas: MessageCanvas = {
    artifactId: a.id,
    title: a.title,
    screens: (screenIds as string[]).map((id) => ({
      id,
      title: m?.screens.find((x) => x.id === id)?.title ?? id,
    })),
    elements: uniqueElements(
      rows.flatMap((n) => (n.ggId === null ? [] : [{ file: n.file, ggId: n.ggId, label: cut(n.note) }])),
    ),
  }
  const dto = await postAsMember(ctx, me, a, r.botId, {
    action: withText(t('按 {n} 条批注修改', { n: rows.length }), r.extra),
    canvas,
    note: [
      '[批注：上面这条消息的完整要求]',
      `请按以下批注修改产物「${a.title}」（目录 ${a.dir}/，当前版本 v${head.n}）：`,
      ...lines,
      ...(r.extra?.trim() ? ['', `补充说明：${r.extra.trim()}`] : []),
      '',
      RULES,
      '改完后简短说明每条批注是怎么处理的。',
    ],
  })
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

/** SendMessageReq.artifactContext: what the agent reads after the member's text (meta.artifactNote) and the bubble shows. */
export async function artifactContextNote(ctx: Ctx, a: Artifact, c: ArtifactContext) {
  const { lines, canvas } = await contextLines(ctx, a, {
    screenIds: c.screenIds ?? [],
    elements: c.elements ?? [],
    refs: c.refs ?? [],
  })
  return { note: ['[画布上下文：这条消息针对下面的产物和选中内容]', ...lines].join('\n'), canvas }
}
