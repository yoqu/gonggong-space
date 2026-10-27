import { describe, expect, it, vi } from 'vitest'
import { createTerminalLinkProvider, parseTerminalLinks } from '../src/features/terminal/links'

describe('terminal link recognition', () => {
  it('recognizes http and https URLs without trailing punctuation', () => {
    expect(parseTerminalLinks('see https://example.com/a?x=1, then http://localhost:3000/test.')).toEqual([
      { kind: 'url', text: 'https://example.com/a?x=1', url: 'https://example.com/a?x=1' },
      { kind: 'url', text: 'http://localhost:3000/test', url: 'http://localhost:3000/test' },
    ])
  })

  it('parses workspace file paths and optional line and column suffixes', () => {
    expect(parseTerminalLinks('at src/app/main.ts:42:7 and ./README.md:9')).toEqual([
      { kind: 'file', text: 'src/app/main.ts:42:7', path: 'src/app/main.ts', line: 42, column: 7 },
      { kind: 'file', text: './README.md:9', path: 'README.md', line: 9, column: 1 },
    ])
  })

  it('rejects absolute paths, parent traversal and non-http schemes', () => {
    expect(parseTerminalLinks('/tmp/secret.ts:1 ../secret.ts:2 src/../../secret.ts:3')).toEqual([])
    expect(
      parseTerminalLinks('file:///etc/passwd javascript:alert(1) ftp://example.com/a ssh://host/a'),
    ).toEqual([])
    expect(parseTerminalLinks('file:///tmp/secret.ts:1 C:/Windows/system.ini:2')).toEqual([])
  })

  it('does not recognize plain prose or partial URLs', () => {
    expect(parseTerminalLinks('version 1.2.3, https//bad.example and example.com:80')).toEqual([])
  })
})

describe('terminal link activation', () => {
  it('opens web URLs in a separate safe browsing context', () => {
    const open = vi.fn()
    const resolve = vi.fn()
    const provider = createTerminalLinkProvider(terminal('https://example.com/docs'), {
      resolveFile: resolve,
      openUrl: open,
    })

    provider.provideLinks(1, (links) => links?.[0]?.activate({} as MouseEvent, 'https://example.com/docs'))

    expect(open).toHaveBeenCalledWith('https://example.com/docs')
    expect(resolve).not.toHaveBeenCalled()
  })

  it('delegates only workspace file links to the resolver', async () => {
    const open = vi.fn()
    const resolve = vi.fn().mockResolvedValue(undefined)
    const provider = createTerminalLinkProvider(terminal('src/app.ts:12'), {
      resolveFile: resolve,
      openUrl: open,
    })

    await new Promise<void>((done) => {
      provider.provideLinks(1, (links) => {
        expect(links?.map((link) => link.text)).toEqual(['src/app.ts:12'])
        links?.[0]?.activate({} as MouseEvent, 'src/app.ts:12')
        done()
      })
    })

    expect(resolve).toHaveBeenCalledWith('src/app.ts', 12, 1)
    expect(open).not.toHaveBeenCalled()
  })

  it('uses xterm cell offsets for Unicode before a link', async () => {
    const provider = createTerminalLinkProvider(terminal('中文 https://example.com'), {
      resolveFile: vi.fn(),
      openUrl: vi.fn(),
    })
    await new Promise<void>((done) => {
      provider.provideLinks(1, (links) => {
        expect(links?.[0]?.range).toEqual({ start: { x: 6, y: 1 }, end: { x: 24, y: 1 } })
        done()
      })
    })
  })
})

function terminal(text: string) {
  return {
    buffer: {
      active: {
        getLine: () => ({ translateToString: () => text }),
      },
    },
  } as never
}
