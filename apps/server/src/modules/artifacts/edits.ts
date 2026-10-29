import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import {
  ARTIFACT_UPLOAD_MAX_BYTES,
  ARTIFACT_UPLOAD_TYPES,
  type ArtifactEditOp,
  type ArtifactEditReq,
  type ArtifactFile,
  ArtifactFiles,
  type ArtifactUploadRes,
  GG_ARTIFACT_MANIFEST,
  GgArtifactManifest,
} from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { artifacts } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { artifactBlobs, readBlob } from './blobs.js'
import { type ElementEdit, editHtml, editToken } from './html.js'
import { designSystemFiles } from './kit.js'
import { parseManifest } from './lint.js'
import { type Artifact, isRunning, requireVersion, submitVersion } from './service.js'

const TOKENS = 'tokens.css'
/** `<sha256>.<ext>`: the image's blob in the group's artifact store and its name under `assets/`. */
const UPLOAD_ID = /^[0-9a-f]{64}\.(png|jpg|webp|gif)$/

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex')

/** Magic bytes, so a renamed SVG or HTML page cannot pass as an image. */
const SIGNATURES: Record<string, (b: Buffer) => boolean> = {
  png: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  jpg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  gif: (b) => /^GIF8[79]a/.test(b.subarray(0, 6).toString('latin1')),
  webp: (b) =>
    b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
}

/** POST /api/artifacts/:id/uploads: an image for a later `asset` op. */
export async function uploadImage(
  a: Artifact,
  type: string | undefined,
  body: Buffer,
): Promise<ArtifactUploadRes> {
  const ext = ARTIFACT_UPLOAD_TYPES[(type ?? '').split(';')[0]?.trim() as keyof typeof ARTIFACT_UPLOAD_TYPES]
  if (!ext) return fail('invalid', '只能上传 PNG、JPG、WebP 或 GIF 图片')
  if (body.length > ARTIFACT_UPLOAD_MAX_BYTES)
    return fail('invalid', '图片不能超过 {mb} MB', { mb: ARTIFACT_UPLOAD_MAX_BYTES / 1024 / 1024 })
  if (!SIGNATURES[ext]?.(body)) return fail('invalid', '图片内容与类型不符')
  const hash = sha256(body)
  if ((await artifactBlobs.touch(a.groupId, hash)) === null)
    await artifactBlobs.write(a.groupId, hash, Readable.from([body]), false)
  const uploadId = `${hash}.${ext}`
  return { uploadId, path: `assets/${uploadId}` }
}

/** `src` of `assets/<name>` as written in `file`. */
const assetSrc = (file: string, name: string) => (file.includes('/') ? `../assets/${name}` : `assets/${name}`)

type ManifestOp = Extract<ArtifactEditOp, { kind: 'manifest' }>

/** `<id>-copy`, then `<id>-copy-2`…, within the 40 characters of a screen id. */
function copyId(id: string, taken: Set<string>) {
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? '-copy' : `-copy-${n}`
    const candidate = `${id.slice(0, 40 - suffix.length).replace(/-+$/, '')}${suffix}`
    if (!taken.has(candidate)) return candidate
  }
}

/**
 * POST /api/artifacts/:id/edits (§3.5): every op applied to the head's files, saved as one new version (source
 * `edit`). Refuses with 409 while a run has it or once the head moved past `baseVersionId`.
 */
export async function applyEdits(ctx: Ctx, a: Artifact, userId: string, req: ArtifactEditReq) {
  if (await isRunning(ctx.db, a)) fail('conflict', '产物正在被 AI 修改，请等运行结束')
  if (req.baseVersionId !== a.headVersionId) fail('conflict', '产物已有新版本，请刷新后重做')
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
  const links = new Set<string>()
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
        if (!UPLOAD_ID.test(op.uploadId)) fail('invalid', '上传的图片不存在')
        const size =
          (await artifactBlobs.size(a.groupId, op.uploadId.slice(0, 64))) ??
          fail('invalid', '上传的图片不存在')
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
        screens.push(op)
        break
      case 'file':
        changed.set(op.path, Buffer.from(op.content))
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

  const removed = new Set<string>()
  const manifest = async () => {
    const parsed = files.has(GG_ARTIFACT_MANIFEST)
      ? parseManifest((await read(GG_ARTIFACT_MANIFEST)).toString('utf8'))
      : null
    return parsed && 'manifest' in parsed ? parsed.manifest : null
  }
  if (screens.length) {
    const m = (await manifest()) ?? fail('invalid', '清单无效，不能调整屏幕')
    for (const op of screens) {
      const i = m.screens.findIndex((s) => s.id === op.screenId)
      const screen = m.screens[i] ?? fail('invalid', '屏幕不存在：{id}', { id: op.screenId })
      if (op.op === 'rename') screen.title = op.title ?? screen.title
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
        m.screens.splice(i + 1, 0, {
          ...screen,
          id,
          title: op.title ?? `${screen.title} 副本`.slice(0, 80),
          file,
        })
      } else if (op.op === 'delete') {
        if (m.screens.length === 1) fail('invalid', '不能删除最后一屏')
        m.screens.splice(i, 1)
        removed.add(screen.file)
        changed.delete(screen.file)
        if (m.entry === screen.id) m.entry = m.screens[0]?.id ?? m.entry
      } else {
        m.screens.splice(i, 1)
        m.screens.splice(Math.min(op.index ?? i, m.screens.length), 0, screen)
      }
    }
    const valid = GgArtifactManifest.safeParse(m)
    if (!valid.success) fail('invalid', '清单无效，不能调整屏幕')
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
