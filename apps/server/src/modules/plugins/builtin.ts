import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { SkillFile } from '@gonggong/protocol'
import type { Ctx } from '../../context.js'
import { pluginSnapshot, savePlugin } from './service.js'

/** Shipped with the server package, so the Docker image carries them too. */
export const BUILTIN_PLUGINS = join(import.meta.dirname, '../../../plugins/official')
/** Internal plugins (internal addresses): a submodule only the internal GitLab has; absent in public checkouts. */
export const INTERNAL_PLUGINS = join(import.meta.dirname, '../../../plugins/internal')

function files(root: string, dir = root): SkillFile[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return files(root, full)
    const buf = readFileSync(full)
    const text = buf.toString('utf8')
    const path = relative(root, full).split('\\').join('/')
    return Buffer.from(text, 'utf8').equals(buf)
      ? [{ path, content: text, encoding: 'utf8' as const }]
      : [{ path, content: buf.toString('base64'), encoding: 'base64' as const }]
  })
}

/**
 * Installs each built-in folder on the platform layer at startup, as a new version only when its content changed.
 * No editor marks them built-in: they cannot be deleted or replaced there, and groups still turn them on.
 */
export async function syncBuiltinPlugins(ctx: Ctx, dir = BUILTIN_PLUGINS) {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name)
    if (!statSync(full).isDirectory()) continue
    await savePlugin(
      ctx,
      { scope: 'platform', teamId: null, groupId: null },
      pluginSnapshot(files(full)),
      null,
    )
  }
}
