export const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, '\\$&')}%`

/** One line around the first match, so long messages still show why they matched. */
export function snippet(body: string, q: string) {
  const line = body.replace(/\s+/g, ' ').trim()
  const at = line.toLowerCase().indexOf(q.toLowerCase())
  return at > 40 ? `…${line.slice(at - 20, at + 100)}` : line.slice(0, 120)
}

export const patchPaths = (patch: string) =>
  [...patch.matchAll(/^diff --git a\/.+? b\/(?<path>.+)$/gm)].map((m) => m.groups?.path ?? '')
