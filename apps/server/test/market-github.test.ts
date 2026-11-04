import { PLUGIN_MAX_FILES } from '@gonggong/protocol'
import { type Zippable, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { fetchGithubSkill, upstreamCommit } from '../src/modules/market/github.js'

const SHA = 'a'.repeat(40)
const SKILL = '---\nname: demo\ndescription: d\n---\nhi'
const enc = (s: string) => new TextEncoder().encode(s)
const SYMLINK = { os: 3, attrs: 0o120777 << 16 }

type Route = (url: URL, init: RequestInit) => Response | Promise<Response>

/** A fake fetch: the API answers with SHA for any ref, codeload with `zip`; `extra` overrides by URL. */
function fakeFetch(zip: Uint8Array, extra: Record<string, Route> = {}) {
  const calls: { url: string; init: RequestInit }[] = []
  const fn = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input))
    calls.push({ url: url.href, init })
    const route = extra[url.href]
    if (route) return route(url, init)
    if (url.host === 'api.github.com') return Response.json({ sha: SHA })
    if (url.href === `https://codeload.github.com/o/r/zip/${SHA}`)
      return new Response(zip as Uint8Array<ArrayBuffer>)
    return new Response('nope', { status: 404 })
  }) as typeof fetch
  return { fn, calls }
}

const repoZip = (files: Zippable) => zipSync({ [`r-${SHA}`]: files })
const redirect = (to: string) => () => new Response(null, { status: 302, headers: { location: to } })

describe('fetchGithubSkill', () => {
  it('imports the repository root at the default branch', async () => {
    const zip = repoZip({
      'SKILL.md': enc(SKILL),
      'b.bin': new Uint8Array([0xff, 0xfe, 0]),
      '.DS_Store': enc('x'),
    })
    const { fn, calls } = fakeFetch(zip)
    const res = await fetchGithubSkill('https://github.com/o/r', { fetch: fn })
    expect(res.source).toEqual({ url: 'https://github.com/o/r', ref: null, path: '', commit: SHA })
    expect(res.files).toEqual([
      { path: 'SKILL.md', content: SKILL, encoding: 'utf8' },
      { path: 'b.bin', content: Buffer.from([0xff, 0xfe, 0]).toString('base64'), encoding: 'base64' },
    ])
    expect(calls[0]?.url).toBe('https://api.github.com/repos/o/r/commits/HEAD')
    expect(calls[0]?.init.redirect).toBe('manual')
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal)
  })

  it('takes a sub-directory at a ref as the root', async () => {
    const zip = repoZip({
      'README.md': enc('root'),
      skills: {
        demo: { 'SKILL.md': enc(SKILL), ref: { 'a.md': enc('a') } },
        other: { 'SKILL.md': enc(SKILL) },
      },
      __MACOSX: { 'x.md': enc('x') },
    })
    const { fn, calls } = fakeFetch(zip)
    const res = await fetchGithubSkill('https://github.com/o/r/tree/v1.2/skills/demo', { fetch: fn })
    expect(calls[0]?.url).toBe('https://api.github.com/repos/o/r/commits/v1.2')
    expect(res.source).toEqual({
      url: 'https://github.com/o/r/tree/v1.2/skills/demo',
      ref: 'v1.2',
      path: 'skills/demo',
      commit: SHA,
    })
    expect(res.files.map((f) => f.path)).toEqual(['SKILL.md', 'ref/a.md'])
  })

  it('accepts a plugin folder without SKILL.md', async () => {
    const { fn } = fakeFetch(repoZip({ 'gonggong-plugin.json': enc('{}') }))
    const res = await fetchGithubSkill('https://github.com/o/r/', { fetch: fn })
    expect(res.files.map((f) => f.path)).toEqual(['gonggong-plugin.json'])
  })

  it.each([
    'http://github.com/o/r',
    'https://gitlab.com/o/r',
    'https://github.com/o',
    'https://github.com/o/r/blob/main/SKILL.md',
    'https://github.com/o/r/tree/main/../x',
    'https://github.com/o/r/tree/main/%E0%A4',
    'not a url',
  ])('rejects the link %s', async (url) => {
    const { fn, calls } = fakeFetch(repoZip({ 'SKILL.md': enc(SKILL) }))
    await expect(fetchGithubSkill(url, { fetch: fn })).rejects.toThrow('GitHub 链接格式不对')
    expect(calls).toHaveLength(0)
  })

  it('follows redirects within GitHub', async () => {
    const zip = repoZip({ 'SKILL.md': enc(SKILL) })
    const { fn } = fakeFetch(zip, {
      'https://api.github.com/repos/o/r/commits/HEAD': redirect(
        'https://api.github.com/repositories/1/commits/HEAD',
      ),
      'https://api.github.com/repositories/1/commits/HEAD': () => Response.json({ sha: SHA }),
    })
    const res = await fetchGithubSkill('https://github.com/o/r', { fetch: fn })
    expect(res.source.commit).toBe(SHA)
  })

  it('refuses a redirect off GitHub', async () => {
    const { fn, calls } = fakeFetch(repoZip({ 'SKILL.md': enc(SKILL) }), {
      [`https://codeload.github.com/o/r/zip/${SHA}`]: redirect('https://evil.example.com/x.zip'),
    })
    await expect(fetchGithubSkill('https://github.com/o/r', { fetch: fn })).rejects.toThrow(
      'evil.example.com',
    )
    expect(calls.some((c) => c.url.includes('evil'))).toBe(false)
  })

  it('stops after 3 redirects', async () => {
    const loop = 'https://api.github.com/repos/o/r/commits/HEAD'
    const { fn, calls } = fakeFetch(new Uint8Array(), { [loop]: redirect(loop) })
    await expect(fetchGithubSkill('https://github.com/o/r', { fetch: fn })).rejects.toThrow('重定向次数过多')
    expect(calls).toHaveLength(4)
  })

  it('reports a timeout', async () => {
    const { fn } = fakeFetch(new Uint8Array(), {
      'https://api.github.com/repos/o/r/commits/HEAD': () => {
        throw new DOMException('timed out', 'TimeoutError')
      },
    })
    await expect(fetchGithubSkill('https://github.com/o/r', { fetch: fn })).rejects.toThrow(
      '连接 GitHub 超时',
    )
  })

  it('reports a missing repository or branch', async () => {
    const { fn } = fakeFetch(new Uint8Array(), {
      'https://api.github.com/repos/o/r/commits/nope': () => new Response('{}', { status: 422 }),
    })
    await expect(fetchGithubSkill('https://github.com/o/r/tree/nope', { fetch: fn })).rejects.toThrow(
      '仓库或分支不存在',
    )
    await expect(
      fetchGithubSkill('https://github.com/x/y', {
        fetch: fakeFetch(new Uint8Array(), {
          'https://api.github.com/repos/x/y/commits/HEAD': () => new Response('', { status: 404 }),
        }).fn,
      }),
    ).rejects.toThrow('仓库或分支不存在')
  })

  it('aborts a download over 20 MB while streaming', async () => {
    let pulled = 0
    const chunk = new Uint8Array(1024 * 1024)
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled++
        c.enqueue(chunk)
      },
    })
    const { fn } = fakeFetch(new Uint8Array(), {
      [`https://codeload.github.com/o/r/zip/${SHA}`]: () => new Response(body),
    })
    await expect(fetchGithubSkill('https://github.com/o/r', { fetch: fn })).rejects.toThrow('超过 20 MB')
    expect(pulled).toBeLessThan(25)
  })

  it('rejects files over 5 MB in total', async () => {
    const big = new Uint8Array(3 * 1024 * 1024)
    const { fn } = fakeFetch(repoZip({ 'SKILL.md': enc(SKILL), 'a.bin': big, 'b.bin': big }))
    await expect(fetchGithubSkill('https://github.com/o/r', { fetch: fn })).rejects.toThrow('超过 5 MB')
  })

  it('rejects too many files', async () => {
    const files: Zippable = { 'SKILL.md': enc(SKILL) }
    for (let i = 0; i < PLUGIN_MAX_FILES; i++) files[`f${i}.md`] = enc('x')
    const { fn } = fakeFetch(repoZip(files))
    await expect(fetchGithubSkill('https://github.com/o/r', { fetch: fn })).rejects.toThrow(
      `超过 ${PLUGIN_MAX_FILES} 个`,
    )
  })

  it('rejects path traversal', async () => {
    const zip = zipSync({ [`r-${SHA}/SKILL.md`]: enc(SKILL), [`r-${SHA}/../evil.md`]: enc('x') })
    const { fn } = fakeFetch(zip)
    await expect(fetchGithubSkill('https://github.com/o/r', { fetch: fn })).rejects.toThrow('文件路径不合法')
  })

  it('rejects symbolic links', async () => {
    const zip = repoZip({ 'SKILL.md': enc(SKILL), 'link.md': [enc('/etc/passwd'), SYMLINK] })
    const { fn } = fakeFetch(zip)
    await expect(fetchGithubSkill('https://github.com/o/r', { fetch: fn })).rejects.toThrow(
      '符号链接：link.md',
    )
  })

  it('ignores symbolic links outside the imported folder', async () => {
    const zip = repoZip({ 'link.md': [enc('x'), SYMLINK], s: { 'SKILL.md': enc(SKILL) } })
    const res = await fetchGithubSkill('https://github.com/o/r/tree/main/s', { fetch: fakeFetch(zip).fn })
    expect(res.files.map((f) => f.path)).toEqual(['SKILL.md'])
  })

  it('needs SKILL.md or gonggong-plugin.json', async () => {
    const { fn } = fakeFetch(repoZip({ 'README.md': enc('x') }))
    await expect(fetchGithubSkill('https://github.com/o/r', { fetch: fn })).rejects.toThrow('缺少 SKILL.md')
  })

  it('reports an empty or missing folder', async () => {
    const { fn } = fakeFetch(repoZip({ 'SKILL.md': enc(SKILL) }))
    await expect(fetchGithubSkill('https://github.com/o/r/tree/main/none', { fetch: fn })).rejects.toThrow(
      '不存在或为空',
    )
  })
})

describe('upstreamCommit', () => {
  it('reads the latest commit of the source ref', async () => {
    const { fn, calls } = fakeFetch(new Uint8Array(), {
      'https://api.github.com/repos/o/r/commits/dev': () => Response.json({ sha: 'b'.repeat(40) }),
    })
    const source = { url: 'https://github.com/o/r/tree/dev/s', ref: 'dev', path: 's', commit: SHA }
    expect(await upstreamCommit(source, { fetch: fn })).toBe('b'.repeat(40))
    expect(
      await upstreamCommit({ ...source, url: 'https://github.com/o/r', ref: null, path: '' }, { fetch: fn }),
    ).toBe(SHA)
    expect(calls.map((c) => c.url)).toEqual([
      'https://api.github.com/repos/o/r/commits/dev',
      'https://api.github.com/repos/o/r/commits/HEAD',
    ])
  })
})
