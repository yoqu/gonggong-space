import { promisify } from 'node:util'
import { GG_ARTIFACT_MANIFEST } from '@gonggong/protocol'
import { type AsyncZippable, zip } from 'fflate'
import type { Ctx } from '../../context.js'
import { t } from '../../i18n/index.js'
import { readBlob } from './blobs.js'
import { kitName, pluginKit } from './kit.js'
import type { Artifact, Version } from './service.js'

const zipAsync = promisify(
  zip as (data: AsyncZippable, cb: (err: Error | null, out: Uint8Array) => void) => void,
)

const TEXT = /\.(html?|css|m?js|json|md|svg|txt)$/i

/** `assets/*` no other file mentions (an image replaced on the canvas): the version keeps them, the zip does not. */
function unusedAssets(files: Map<string, Buffer>) {
  const texts = [...files].filter(([p]) => TEXT.test(p)).map(([p, b]) => [p, b.toString('utf8')] as const)
  return new Set(
    [...files.keys()].filter(
      (p) => p.startsWith('assets/') && !texts.some(([other, text]) => other !== p && text.includes(p)),
    ),
  )
}

/** The shell with gg-artifact.json inline ahead of its scripts: opened from disk it cannot fetch the file. */
function withManifest(shell: Buffer, manifest: Buffer) {
  const html = shell.toString('utf8')
  const at = html.indexOf('<script')
  if (at < 0) return shell
  const json = manifest.toString('utf8').replace(/</g, '\\u003c')
  const tag = `<script type="application/json" id="gg-manifest">${json}</script>\n`
  return Buffer.from(html.slice(0, at) + tag + html.slice(at))
}

/**
 * GET /api/artifacts/:id/export.zip: the version's files under `<slug>/`, with an L1 artifact's shell (index.html,
 * _gg/) taken from its plugin version like the preview serves it, its manifest inline so index.html opens with a
 * double-click, and a README.
 */
export async function exportZip(ctx: Ctx, a: Artifact, v: Version) {
  const slug = a.dir.slice('design/'.length)
  const manifest = v.files.find((f) => f.path === GG_ARTIFACT_MANIFEST)
  const kit = manifest ? await pluginKit(ctx.db, a.pluginVersionId) : null
  const files = new Map<string, Buffer>()
  for (const f of v.files) if (!(kit && kitName(f.path))) files.set(f.path, await readBlob(a.groupId, f.hash))
  const unused = unusedAssets(files)
  const entries: AsyncZippable = {}
  for (const [path, content] of files) if (!unused.has(path)) entries[`${slug}/${path}`] = content
  for (const [name, content] of kit ?? [])
    entries[`${slug}/${name === 'index.html' ? name : `_gg/${name}`}`] =
      name === 'index.html' && manifest ? withManifest(content, files.get(manifest.path) as Buffer) : content
  entries[`${slug}/README.txt`] = Buffer.from(
    `${t('「{title}」v{n}：双击 index.html 即可预览；也可以在这个目录运行 npx serve（或任意静态服务器），再打开它给出的地址。', { title: a.title, n: v.n })}\n`,
  )
  return { name: `${slug}-v${v.n}.zip`, body: Buffer.from(await zipAsync(entries)) }
}
