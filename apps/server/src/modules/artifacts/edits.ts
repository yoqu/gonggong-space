import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import {
  ARTIFACT_REF_EXT,
  ARTIFACT_REF_TYPES,
  ARTIFACT_UPLOAD_MAX_BYTES,
  ARTIFACT_UPLOAD_PDF_MAX_BYTES,
  ARTIFACT_UPLOAD_TYPES,
  type ArtifactEditOp,
  type ArtifactEditReq,
  type ArtifactFile,
  ArtifactFiles,
  type ArtifactUploadRes,
  GG_ARTIFACT_MANIFEST,
  GgArtifactManifest,
  type GgArtifactScreen,
  ruleFileOf,
} from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { artifacts } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { artifactBlobs, readBlob } from './blobs.js'
import { type ElementEdit, editHtml, editToken } from './html.js'
import { readableImage } from './images.js'
import { designSystemFiles } from './kit.js'
import { parseManifest } from './lint.js'
import { type Artifact, requireVersion, submitVersion } from './service.js'

const TOKENS = 'tokens.css'
/** `<sha256>.<ext>`: the upload's blob in the group's artifact store; an image's name under `assets/`. */
const UPLOAD_ID = /^[0-9a-f]{64}\.(png|jpg|webp|gif|pdf|txt|md)$/
const IMAGE_ID = /\.(png|jpg|webp|gif)$/

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex')

/** Magic bytes, so a renamed SVG or HTML page cannot pass as an image. */
const SIGNATURES: Record<string, (b: Buffer) => boolean> = {
  png: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  jpg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  gif: (b) => /^GIF8[79]a/.test(b.subarray(0, 6).toString('latin1')),
  webp: (b) =>
    b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  pdf: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-',
  txt: (b) => isText(b),
  md: (b) => isText(b),
}

/** UTF-8 without NUL bytes: plain text, not a binary renamed. */
function isText(b: Buffer) {
  if (b.includes(0)) return false
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(b)
    return true
  } catch {
    return false
  }
}

/** The larger of the per-type limits: the route reads at most this much. */
export const UPLOAD_READ_MAX = Math.max(ARTIFACT_UPLOAD_MAX_BYTES, ARTIFACT_UPLOAD_PDF_MAX_BYTES)

/** POST /api/artifacts/:id/uploads: an image for a later `asset` op, or a file for a `ref` op. */
export async function uploadFile(
  a: Artifact,
  type: string | undefined,
  body: Buffer,
): Promise<ArtifactUploadRes> {
  const ext = ARTIFACT_REF_TYPES[(type ?? '').split(';')[0]?.trim() as keyof typeof ARTIFACT_REF_TYPES]
  if (!ext) return fail('invalid', '只能上传图片（PNG、JPG、WebP、GIF）、PDF 或文本文件')
  const max = ext === 'pdf' ? ARTIFACT_UPLOAD_PDF_MAX_BYTES : ARTIFACT_UPLOAD_MAX_BYTES
  if (body.length > max) return fail('invalid', '文件不能超过 {mb} MB', { mb: max / 1024 / 1024 })
  if (!SIGNATURES[ext]?.(body)) return fail('invalid', '文件内容与类型不符')
  if (!readableImage(ext, body)) return fail('invalid', '图片无法读取，文件可能已损坏')
  const hash = sha256(body)
  if ((await artifactBlobs.touch(a.groupId, hash)) === null)
    await artifactBlobs.write(a.groupId, hash, Readable.from([body]), false)
  const uploadId = `${hash}.${ext}`
  const image = Object.values(ARTIFACT_UPLOAD_TYPES).includes(ext as never)
  return { uploadId, path: image ? `assets/${uploadId}` : null, kind: ARTIFACT_REF_EXT[ext] }
}

/** An upload's blob size; refuses unknown ids. */
async function uploaded(a: Artifact, uploadId: string, image: boolean) {
  if (!UPLOAD_ID.test(uploadId) || (image && !IMAGE_ID.test(uploadId))) fail('invalid', '上传的文件不存在')
  return (await artifactBlobs.size(a.groupId, uploadId.slice(0, 64))) ?? fail('invalid', '上传的文件不存在')
}

/** `src` of `assets/<name>` as written in `file`. */
const assetSrc = (file: string, name: string) => (file.includes('/') ? `../assets/${name}` : `assets/${name}`)

type ManifestOp = Extract<ArtifactEditOp, { kind: 'manifest' | 'screen-move' | 'pages' }>
type RefOp = Extract<ArtifactEditOp, { kind: 'ref' | 'ref-delete' | 'ref-move' | 'ref-rename' }>
type LinkOp = Extract<ArtifactEditOp, { kind: 'link' | 'link-update' | 'link-move' | 'link-delete' }>

const kebab = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

/** A link node's id from its title, else its host (`www.` dropped); `-2`, `-3`… when taken. */
function linkId(title: string, url: string, taken: Set<string>) {
  const base = (kebab(title) || kebab(new URL(url).hostname.replace(/^www\./, '')) || 'link').slice(0, 34)
  const root = base.replace(/-+$/, '')
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? root : `${root}-${n}`
    if (!taken.has(candidate)) return candidate
  }
}

/** `<id>-copy`, then `<id>-copy-2`…, within the 40 characters of a screen id. */
function copyId(id: string, taken: Set<string>) {
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? '-copy' : `-copy-${n}`
    const candidate = `${id.slice(0, 40 - suffix.length).replace(/-+$/, '')}${suffix}`
    if (!taken.has(candidate)) return candidate
  }
}

/**
 * The `pages` op: the same screens in the op's order, each in its group or under its parent page (the manifest check
 * validates both).
 */
function pageList(screens: GgArtifactScreen[], op: Extract<ArtifactEditOp, { kind: 'pages' }>) {
  const byId = new Map(screens.map((s) => [s.id, s]))
  if (op.screens.length !== screens.length || new Set(op.screens.map((s) => s.id)).size !== screens.length)
    fail('invalid', '页面列表已变化，请刷新后重试')
  return op.screens.map(({ id, group, parent }) => {
    const {
      group: _,
      parent: __,
      ...screen
    } = byId.get(id) ?? fail('invalid', '页面列表已变化，请刷新后重试')
    return { ...screen, ...(group && { group }), ...(parent && { parent }) }
  })
}

/**
 * POST /api/artifacts/:id/edits (§3.5): every op applied to the head's files, saved as one new version (source
 * `edit`). Once the head moved past `baseVersionId` it merges in by file, or refuses with 409 when they overlap.
 */
export async function applyEdits(ctx: Ctx, a: Artifact, userId: string, req: ArtifactEditReq) {
  const base = await requireVersion(ctx.db, a, req.baseVersionId)
  const files = new Map<string, ArtifactFile>(base.files.map((f) => [f.path, f]))
  const changed = new Map<string, Buffer>()
  const read = async (path: string) => {
    const known = changed.get(path)
    if (known) return known
    const f = files.get(path) ?? fail('invalid', '文件不存在：{path}', { path })
    return readBlob(a.groupId, f.hash)
  }

  const byFile = new Map<string, ElementEdit[]>()
  const element = (file: string, e: ElementEdit) => byFile.set(file, [...(byFile.get(file) ?? []), e])
  const tokens: Extract<ArtifactEditOp, { kind: 'token' }>[] = []
  const screens: ManifestOp[] = []
  const refs: RefOp[] = []
  const linkOps: LinkOp[] = []
  const links = new Set<string>()
  const removed = new Set<string>()
  let designSystemId: string | null = null
  for (const op of req.ops) {
    switch (op.kind) {
      case 'text':
        element(op.file, { ggId: op.ggId, kind: 'text', text: op.text })
        break
      case 'attr': {
        const value = op.value === '' && op.name.startsWith('data-gg-') ? null : op.value
        if (op.name === 'data-gg-link' && value) links.add(value)
        element(op.file, { ggId: op.ggId, kind: 'attr', name: op.name, value })
        break
      }
      case 'style':
        element(op.file, { ggId: op.ggId, kind: 'style', props: op.props })
        break
      case 'delete':
        element(op.file, { ggId: op.ggId, kind: 'delete' })
        break
      case 'asset': {
        const size = await uploaded(a, op.uploadId, true)
        files.set(`assets/${op.uploadId}`, {
          path: `assets/${op.uploadId}`,
          hash: op.uploadId.slice(0, 64),
          size,
        })
        element(op.file, { ggId: op.ggId, kind: 'attr', name: 'src', value: assetSrc(op.file, op.uploadId) })
        break
      }
      case 'token':
        tokens.push(op)
        break
      case 'manifest':
      case 'screen-move':
      case 'pages':
        screens.push(op)
        break
      case 'ref':
      case 'ref-delete':
      case 'ref-move':
      case 'ref-rename':
        refs.push(op)
        break
      case 'link':
      case 'link-update':
      case 'link-move':
      case 'link-delete':
        linkOps.push(op)
        break
      case 'file':
        // An emptied rule file goes: a screen without rules has none.
        if (op.path.startsWith('rules/') && !op.content.trim()) {
          changed.delete(op.path)
          removed.add(op.path)
        } else {
          changed.set(op.path, Buffer.from(op.content))
          removed.delete(op.path)
        }
        break
      case 'design-system': {
        const ds =
          (await designSystemFiles(ctx.db, a.pluginVersionId, op.id)) ??
          fail('invalid', '设计系统不存在：{id}', { id: op.id })
        for (const [path, content] of Object.entries(ds)) changed.set(path, content)
        designSystemId = op.id
        break
      }
    }
  }

  for (const [file, edits] of byFile)
    changed.set(file, Buffer.from(editHtml((await read(file)).toString('utf8'), edits)))

  if (tokens.length) {
    let css = (await read(TOKENS)).toString('utf8')
    for (const op of tokens)
      css = editToken(css, op.name, op.value) ?? fail('invalid', '令牌不存在：{name}', { name: op.name })
    changed.set(TOKENS, Buffer.from(css))
  }

  const manifest = async () => {
    const parsed = files.has(GG_ARTIFACT_MANIFEST)
      ? parseManifest((await read(GG_ARTIFACT_MANIFEST)).toString('utf8'))
      : null
    return parsed && 'manifest' in parsed ? parsed.manifest : null
  }
  if (screens.length || refs.length || linkOps.length) {
    const m = (await manifest()) ?? fail('invalid', '清单无效，不能调整屏幕')
    for (const op of screens) {
      if (op.kind === 'pages') {
        m.screens = pageList(m.screens, op)
        if (op.groups.length) m.groups = op.groups
        else delete m.groups
        continue
      }
      const i = m.screens.findIndex((s) => s.id === op.screenId)
      const screen = m.screens[i] ?? fail('invalid', '屏幕不存在：{id}', { id: op.screenId })
      if (op.kind === 'screen-move') Object.assign(screen, { x: op.x, y: op.y })
      else if (op.op === 'rename') screen.title = op.title ?? screen.title
      else if (op.op === 'duplicate') {
        const paths = [...files.keys(), ...changed.keys()]
        const taken = new Set([
          ...m.screens.map((s) => s.id),
          ...paths.flatMap((p) => /^screens\/(.+)\.html$/.exec(p)?.[1] ?? []),
        ])
        const id = copyId(screen.id, taken)
        const file = `screens/${id}.html`
        changed.set(file, await read(screen.file))
        removed.delete(file)
        const rules = ruleFileOf(screen.id)
        if (!removed.has(rules) && (changed.has(rules) || files.has(rules))) {
          changed.set(ruleFileOf(id), await read(rules))
          removed.delete(ruleFileOf(id))
        }
        // The copy goes back to the layout rather than on top of its original.
        const { x: _x, y: _y, ...rest } = screen
        m.screens.splice(i + 1, 0, {
          ...rest,
          id,
          title: op.title ?? `${screen.title} 副本`.slice(0, 80),
          file,
        })
      } else if (op.op === 'delete') {
        if (m.screens.length === 1) fail('invalid', '不能删除最后一屏')
        m.screens.splice(i, 1)
        // Its subpages take its place: under its parent page, or in its group.
        for (const sub of m.screens)
          if (sub.parent === screen.id) {
            delete sub.parent
            if (screen.parent) sub.parent = screen.parent
            else if (screen.group) sub.group = screen.group
          }
        for (const path of [screen.file, ruleFileOf(screen.id)]) {
          removed.add(path)
          changed.delete(path)
        }
        if (m.entry === screen.id) m.entry = m.screens[0]?.id ?? m.entry
      } else {
        m.screens.splice(i, 1)
        m.screens.splice(Math.min(op.index ?? i, m.screens.length), 0, screen)
      }
    }
    for (const op of refs) {
      const list = m.refs ?? []
      if (op.kind === 'ref') {
        const size = await uploaded(a, op.uploadId, false)
        const ext = op.uploadId.slice(65) as keyof typeof ARTIFACT_REF_EXT
        const taken = new Set(list.map((r) => r.id))
        let id = `ref-${op.uploadId.slice(0, 8)}`
        for (let n = 2; taken.has(id); n++) id = `ref-${op.uploadId.slice(0, 8)}-${n}`
        const file = `refs/${id}.${ext}`
        files.set(file, { path: file, hash: op.uploadId.slice(0, 64), size })
        removed.delete(file)
        m.refs = [...list, { id, title: op.title, file, kind: ARTIFACT_REF_EXT[ext] }]
        continue
      }
      const ref = list.find((r) => r.id === op.id) ?? fail('invalid', '参考不存在：{id}', { id: op.id })
      if (op.kind === 'ref-move') Object.assign(ref, { x: op.x, y: op.y })
      else if (op.kind === 'ref-rename') ref.title = op.title
      else {
        m.refs = list.filter((r) => r !== ref)
        removed.add(ref.file)
      }
    }
    for (const op of linkOps) {
      const list = m.links ?? []
      if (op.kind === 'link') {
        const taken = new Set([...list, ...m.screens, ...(m.refs ?? [])].map((x) => x.id))
        const { kind: _, ...fields } = op
        m.links = [...list, { id: linkId(op.title, op.url, taken), ...fields }]
        continue
      }
      const link = list.find((l) => l.id === op.id) ?? fail('invalid', '链接不存在：{id}', { id: op.id })
      if (op.kind === 'link-move') Object.assign(link, { x: op.x, y: op.y })
      else if (op.kind === 'link-delete') m.links = list.filter((l) => l !== link)
      else {
        const { kind: _, id: _id, h, ...fields } = op
        Object.assign(link, fields)
        if (h) link.h = h
        if (h === null || link.ratio !== 'free') delete link.h
      }
    }
    const valid = GgArtifactManifest.safeParse(m)
    if (!valid.success)
      fail(
        'invalid',
        linkOps.length ? '链接太多或无效' : refs.length ? '参考太多或无效' : '清单无效，不能调整屏幕',
      )
    changed.set(GG_ARTIFACT_MANIFEST, Buffer.from(`${JSON.stringify(m, null, 2)}\n`))
  }
  if (links.size) {
    const ids = new Set(
      ((await manifest()) ?? fail('invalid', '清单无效，不能设置跳转')).screens.map((x) => x.id),
    )
    for (const to of links) if (!ids.has(to)) fail('invalid', '跳转目标屏幕不存在：{id}', { id: to })
  }

  for (const path of removed) files.delete(path)
  for (const [path, content] of changed) {
    const hash = sha256(content)
    if ((await artifactBlobs.touch(a.groupId, hash)) === null)
      await artifactBlobs.write(a.groupId, hash, Readable.from([content]), false)
    files.set(path, { path, hash, size: content.length })
  }
  const list = ArtifactFiles.safeParse([...files.values()])
  if (!list.success) fail('invalid', '超出单版大小上限')
  const out = await submitVersion(ctx, a, {
    parent: base.id,
    submitKey: null,
    files: [...files.values()],
    source: 'edit',
    runId: null,
    userId,
    onlyHead: true,
  })
  if (designSystemId) await ctx.db.update(artifacts).set({ designSystemId }).where(eq(artifacts.id, a.id))
  return out
}
