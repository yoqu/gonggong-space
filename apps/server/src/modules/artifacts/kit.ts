import type { PluginManifest, SkillFile } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import type { Db } from '../../db/client.js'
import { pluginVersions } from '../../db/schema.js'
import { remember } from '../../lib/lru.js'

export type Kit = Map<string, Buffer>
/** Plugin versions are immutable: their shells are cached by version id. */
const cache = new Map<string, Kit | null>()

/** The L1 shell of a plugin version (`skills/<entry>/kit/`) by file name, or null when it ships none. */
export async function pluginKit(db: Pick<Db, 'select'>, pluginVersionId: string | null) {
  if (!pluginVersionId) return null
  if (cache.has(pluginVersionId)) return cache.get(pluginVersionId) ?? null
  const [v] = await db
    .select({ files: pluginVersions.files, manifest: pluginVersions.manifest })
    .from(pluginVersions)
    .where(eq(pluginVersions.id, pluginVersionId))
  const kit = v ? kitOf(v.manifest, v.files as SkillFile[]) : null
  remember(cache, pluginVersionId, kit, 50)
  return kit
}

export function kitOf(m: PluginManifest, files: SkillFile[]): Kit | null {
  const prefix = `skills/${m.entry}/kit/`
  const kit: Kit = new Map(
    files
      .filter((f) => f.path.startsWith(prefix))
      .map((f) => [
        f.path.slice(prefix.length),
        Buffer.from(f.content, f.encoding === 'base64' ? 'base64' : 'utf8'),
      ]),
  )
  return kit.has('index.html') ? kit : null
}

/** The kit file an artifact path stands for: the shell page and `_gg/*`. */
export const kitName = (path: string) =>
  path === 'index.html' ? 'index.html' : path.startsWith('_gg/') ? path.slice(4) : null
