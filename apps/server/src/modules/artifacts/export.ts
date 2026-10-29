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

/**
 * GET /api/artifacts/:id/export.zip: the version's files under `<slug>/`, with an L1 artifact's shell (index.html,
 * _gg/) taken from its plugin version like the preview serves it, and a README on how to open it.
 */
export async function exportZip(ctx: Ctx, a: Artifact, v: Version) {
  const slug = a.dir.slice('design/'.length)
  const kit = v.files.some((f) => f.path === GG_ARTIFACT_MANIFEST)
    ? await pluginKit(ctx.db, a.pluginVersionId)
    : null
  const entries: AsyncZippable = {}
  for (const f of v.files)
    if (!(kit && kitName(f.path))) entries[`${slug}/${f.path}`] = await readBlob(a.groupId, f.hash)
  for (const [name, content] of kit ?? [])
    entries[`${slug}/${name === 'index.html' ? name : `_gg/${name}`}`] = content
  entries[`${slug}/README.txt`] = Buffer.from(
    `${t('「{title}」v{n}：在这个目录运行 npx serve（或任意静态服务器），再打开它给出的地址即可预览。多屏原型要通过 HTTP 读取 gg-artifact.json，直接双击 index.html 打不开。', { title: a.title, n: v.n })}\n`,
  )
  return { name: `${slug}-v${v.n}.zip`, body: Buffer.from(await zipAsync(entries)) }
}
