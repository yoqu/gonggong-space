import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SERVER_ROOT = resolve(HERE, '../../../..')
const REPO_ROOT = resolve(SERVER_ROOT, '../..')

const EDITOR_TYPES = new Set(['slides', 'whiteboard', 'motion'])
const VERSION_RE = /^[a-zA-Z0-9._-]{1,64}$/

function readUpstreamVersion() {
  for (const p of [join(SERVER_ROOT, 'editors/UPSTREAM'), join(REPO_ROOT, 'vendor/open-artifact/UPSTREAM')]) {
    try {
      const s = readFileSync(p, 'utf8').trim()
      if (s) return s.slice(0, 7)
    } catch {}
  }
  return '0.13.0'
}

/** Current platform editor build version (short upstream commit hash). */
export const CURRENT_EDITOR_VERSION = readUpstreamVersion()

/** Where built open-artifact editors live on disk: env override → packaged server/editors → dev vendor/dist. */
export function resolveEditorsRoot(): string | null {
  const candidates = [
    process.env.GONGGONG_EDITORS_DIR,
    join(SERVER_ROOT, 'editors'),
    join(REPO_ROOT, 'vendor/open-artifact/dist/editors'),
  ].filter((x): x is string => !!x)
  for (const dir of candidates) if (existsSync(dir)) return resolve(dir)
  return null
}

/**
 * Resolves a static asset under `/__oa/<type>@<version>/<relPath>` strictly inside the platform editors directory.
 * Checks `<root>/<type>@<version>/` first, then `<root>/<type>/` when `<version>` is current.
 */
export function resolveEditorAsset(
  type: string,
  version: string,
  relPath: string,
): { fullPath: string; immutable: boolean } | null {
  if (!EDITOR_TYPES.has(type) || !VERSION_RE.test(version)) return null
  if (!relPath || relPath.includes('\0') || relPath.startsWith('/')) return null
  const root = resolveEditorsRoot()
  if (!root) return null
  const bases = [join(root, `${type}@${version}`)]
  if (version === CURRENT_EDITOR_VERSION || version === 'current') bases.push(join(root, type))
  for (const base of bases) {
    if (!existsSync(base)) continue
    const absBase = resolve(base)
    const fullPath = resolve(absBase, relPath)
    const rel = relative(absBase, fullPath)
    if (!rel || rel.startsWith('..') || rel.startsWith(sep)) continue
    try {
      if (statSync(fullPath).isFile())
        return { fullPath, immutable: relPath.startsWith('assets/') && relPath !== 'index.html' }
    } catch {}
  }
  return null
}

/** Verified CSP for open-artifact editors (docs/plan/产物容器-S0-spike.md §4). */
export function editorCsp(frameAncestors: string) {
  return [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' blob:",
    "connect-src 'self' data: blob:",
    "worker-src 'self' blob:",
    "frame-src 'self' blob: data:",
    "object-src 'none'",
    "base-uri 'self'",
    `frame-ancestors ${frameAncestors}`,
  ].join('; ')
}
