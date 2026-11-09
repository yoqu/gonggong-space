const SCHEME = /^[a-z][a-z\d+.-]*:/i

/**
 * Where a link or image in a workspace document points, as GitHub reads a README: relative to the document's folder,
 * `/` from the workspace root. `undefined` when it is not a workspace path (a url, an in-page anchor); `null` when it
 * leaves the workspace. A folder keeps its trailing `/`.
 */
export function docPath(from: string, url: string): string | null | undefined {
  const bare = url.replace(/[?#].*$/, '')
  if (!bare || SCHEME.test(bare) || bare.startsWith('//')) return undefined
  let decoded: string
  try {
    decoded = decodeURIComponent(bare)
  } catch {
    return null
  }
  const parts = decoded.startsWith('/') ? [] : from.split('/').slice(0, -1)
  for (const part of decoded.split('/')) {
    if (part === '..') {
      if (!parts.length) return null
      parts.pop()
    } else if (part && part !== '.') parts.push(part)
  }
  if (!parts.length) return null
  const path = parts.join('/')
  return /(^|\/)\.{0,2}$/.test(decoded) ? `${path}/` : path
}
