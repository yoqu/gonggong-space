import { type ListingSource, PLUGIN_MAX_BYTES, PLUGIN_MAX_FILES, type SkillFile } from '@gonggong/protocol'
import { unzipSync } from 'fflate'
import { fail, HttpError } from '../../lib/errors.js'

type Opts = { fetch?: typeof fetch }

const TIMEOUT_MS = 20_000
const MAX_REDIRECTS = 3
const MAX_DOWNLOAD = 20 * 1024 * 1024
const HOSTS = new Set(['github.com', 'codeload.github.com', 'api.github.com'])
const JUNK = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db)(\/|$)/
const SHA = /^[0-9a-f]{40}$/
/** Refs containing `/` (e.g. `feature/x`) are ambiguous with the path and not supported. */
const LINK = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/tree\/([^/]+)((?:\/[^/]+)*))?\/?$/
const S_IFMT = 0o170000
const S_IFLNK = 0o120000

const validPath = (p: string) =>
  !p.includes('\\') && !p.includes('\0') && p.split('/').every((s) => s !== '' && s !== '.' && s !== '..')

function parseLink(url: string) {
  const m = LINK.exec(url.trim())
  if (!m)
    return fail('invalid', 'GitHub 链接格式不对，应为 https://github.com/<owner>/<repo>[/tree/<分支>/<目录>]')
  const [, owner, repo, rawRef, rawPath] = m as unknown as [string, string, string, string?, string?]
  let ref: string | null = null
  let path = ''
  let decoded = true
  try {
    ref = rawRef === undefined ? null : decodeURIComponent(rawRef)
    path = (rawPath ?? '').split('/').filter(Boolean).map(decodeURIComponent).join('/')
  } catch {
    decoded = false
  }
  if (
    !decoded ||
    !validPath(`${owner}/${repo}`) ||
    (path && !validPath(path)) ||
    ref === '' ||
    ref?.includes('/')
  )
    fail('invalid', 'GitHub 链接格式不对，应为 https://github.com/<owner>/<repo>[/tree/<分支>/<目录>]')
  return { owner, repo, ref, path }
}

/** Maps network failures (including the 20 s timeout) to a clear message. */
async function net<T>(p: Promise<T>): Promise<T> {
  try {
    return await p
  } catch (e) {
    if (e instanceof HttpError) throw e
    const name = (e as Error)?.name
    if (name === 'TimeoutError' || name === 'AbortError') return fail('invalid', '连接 GitHub 超时')
    return fail('invalid', '无法连接 GitHub')
  }
}

/** GET following at most 3 redirects, each only to a GitHub host. */
async function get(url: string, f: typeof fetch, signal: AbortSignal) {
  let target = url
  for (let hops = 0; ; hops++) {
    const res = await f(target, {
      redirect: 'manual',
      signal,
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'gonggong' },
    })
    const location = res.headers.get('location')
    if (res.status < 300 || res.status >= 400 || !location) return res
    if (hops >= MAX_REDIRECTS) fail('invalid', 'GitHub 重定向次数过多')
    const next = new URL(location, target)
    if (next.protocol !== 'https:' || !HOSTS.has(next.hostname))
      fail('invalid', 'GitHub 重定向到不允许的地址：{host}', { host: next.host })
    target = next.href
  }
}

function checkStatus(res: Response) {
  if (res.status === 404 || res.status === 422) fail('not_found', 'GitHub 仓库或分支不存在')
  if (!res.ok) fail('invalid', 'GitHub 请求失败（HTTP {status}）', { status: res.status })
}

async function commitOf(owner: string, repo: string, ref: string | null, f: typeof fetch) {
  const signal = AbortSignal.timeout(TIMEOUT_MS)
  const url = `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(ref ?? 'HEAD')}`
  return net(
    (async () => {
      const res = await get(url, f, signal)
      checkStatus(res)
      const sha = ((await res.json()) as { sha?: unknown }).sha
      if (typeof sha !== 'string' || !SHA.test(sha)) fail('invalid', 'GitHub 返回的提交无效')
      return sha as string
    })(),
  )
}

async function download(owner: string, repo: string, sha: string, f: typeof fetch) {
  const signal = AbortSignal.timeout(TIMEOUT_MS)
  return net(
    (async () => {
      const res = await get(`https://codeload.github.com/${owner}/${repo}/zip/${sha}`, f, signal)
      checkStatus(res)
      if (Number(res.headers.get('content-length')) > MAX_DOWNLOAD) fail('invalid', 'GitHub 压缩包超过 20 MB')
      const chunks: Uint8Array[] = []
      let total = 0
      const reader = res.body?.getReader()
      while (reader) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.length
        if (total > MAX_DOWNLOAD) {
          await reader.cancel()
          fail('invalid', 'GitHub 压缩包超过 20 MB')
        }
        chunks.push(value)
      }
      return Buffer.concat(chunks)
    })(),
  )
}

/**
 * Names of symbolic-link entries. fflate's filter does not expose external attributes, so the central
 * directory is read here: a Unix mode in the high 16 bits of the external attributes with S_IFLNK set.
 */
function symlinks(zip: Buffer) {
  const min = Math.max(0, zip.length - 65557)
  let e = zip.length - 22
  while (e >= min && zip.readUInt32LE(e) !== 0x06054b50) e--
  if (e < min) return fail('invalid', 'GitHub 压缩包无法解析')
  let count = zip.readUInt16LE(e + 10)
  let o = zip.readUInt32LE(e + 16)
  if (e >= 20 && zip.readUInt32LE(e - 20) === 0x07064b50) {
    const z = Number(zip.readBigUInt64LE(e - 12))
    if (zip.readUInt32LE(z) === 0x06064b50) {
      count = Number(zip.readBigUInt64LE(z + 32))
      o = Number(zip.readBigUInt64LE(z + 48))
    }
  }
  const links = new Set<string>()
  for (let i = 0; i < count; i++) {
    if (o + 46 > zip.length || zip.readUInt32LE(o) !== 0x02014b50)
      return fail('invalid', 'GitHub 压缩包无法解析')
    const utf8 = zip.readUInt16LE(o + 8) & 0x800
    const nameLen = zip.readUInt16LE(o + 28)
    const mode = zip.readUInt32LE(o + 38) >>> 16
    if ((mode & S_IFMT) === S_IFLNK)
      links.add(zip.toString(utf8 ? 'utf8' : 'latin1', o + 46, o + 46 + nameLen))
    o += 46 + nameLen + zip.readUInt16LE(o + 30) + zip.readUInt16LE(o + 32)
  }
  return links
}

const text = new TextDecoder('utf-8', { fatal: true })
const toFile = (path: string, bytes: Uint8Array): SkillFile => {
  try {
    return { path, content: text.decode(bytes), encoding: 'utf8' }
  } catch {
    return { path, content: Buffer.from(bytes).toString('base64'), encoding: 'base64' }
  }
}

/** Files under `path` of a GitHub zipball (top folder `<repo>-<sha>/` stripped), with size and count capped. */
function extract(zip: Buffer, path: string): SkillFile[] {
  const links = symlinks(zip)
  const prefix = path ? `${path}/` : ''
  let size = 0
  let count = 0
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(zip, {
      filter: ({ name, originalSize }) => {
        const file = name.endsWith('/') ? name.slice(0, -1) : name
        if (!validPath(file)) fail('invalid', '文件路径不合法：{path}', { path: name })
        const top = name.indexOf('/')
        const rel = name.slice(top + 1)
        if (top < 0 || name.endsWith('/') || !rel.startsWith(prefix) || JUNK.test(rel)) return false
        if (links.has(name))
          fail('invalid', 'GitHub 目录包含符号链接：{path}', { path: rel.slice(prefix.length) })
        if (++count > PLUGIN_MAX_FILES)
          fail('invalid', 'GitHub 目录的文件超过 {n} 个', { n: PLUGIN_MAX_FILES })
        size += originalSize
        if (size > PLUGIN_MAX_BYTES) fail('invalid', 'GitHub 目录内容超过 5 MB')
        return true
      },
    })
  } catch (e) {
    if (e instanceof HttpError) throw e
    return fail('invalid', 'GitHub 压缩包无法解析')
  }
  const files = Object.entries(entries)
    .map(([name, bytes]) => toFile(name.slice(name.indexOf('/') + 1 + prefix.length), bytes))
    .sort((a, b) => (a.path < b.path ? -1 : 1))
  if (!files.length) fail('invalid', 'GitHub 目录 {path} 不存在或为空', { path: path || '/' })
  if (!files.some((f) => f.path === 'SKILL.md' || f.path === 'gonggong-plugin.json'))
    fail('invalid', 'GitHub 目录缺少 SKILL.md 或 gonggong-plugin.json')
  return files
}

/** Imports a skill or plugin folder from a public GitHub link, pinned to the commit it was read at. */
export async function fetchGithubSkill(
  url: string,
  opts: Opts = {},
): Promise<{ files: SkillFile[]; source: ListingSource }> {
  const f = opts.fetch ?? fetch
  const { owner, repo, ref, path } = parseLink(url)
  const commit = await commitOf(owner, repo, ref, f)
  const files = extract(await download(owner, repo, commit, f), path)
  return { files, source: { url: url.trim(), ref, path, commit } }
}

/** The commit the source's ref points at now, to compare with `source.commit`. */
export async function upstreamCommit(source: ListingSource, opts: Opts = {}): Promise<string> {
  const { owner, repo } = parseLink(source.url)
  return commitOf(owner, repo, source.ref, opts.fetch ?? fetch)
}
