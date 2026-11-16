import { fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Markdown, type MdDoc } from '../src/features/chat/Markdown'

const README = `<p align="center"><img src="docs/brand/logo.svg" width="96"></p>
<h1 align="center">共工</h1>
<p align="center">
  <a href="https://github.com/x/y/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-blue"></a>
  <br>
  <b>AI 团队工作区</b>
</p>

<details><summary>更多</summary>

隐藏的 **内容**

</details>
`

const makeDoc = () => ({
  path: 'README.md',
  raw: (p: string) => `/raw/${p}`,
  open: vi.fn<MdDoc['open']>(),
})

// Workspace files (doc mode) render GitHub README HTML, sanitized; chat replies never render raw HTML.
describe('Markdown raw HTML', () => {
  it('renders a README header in doc mode, relative images resolved like markdown ones', () => {
    const { container } = render(<Markdown text={README} doc={makeDoc()} />)
    expect(container.textContent).not.toContain('<p align')
    const logo = container.querySelector('p[align="center"] > img')
    expect(logo?.getAttribute('src')).toBe('/raw/docs/brand/logo.svg')
    expect(logo?.getAttribute('width')).toBe('96')
    expect(container.querySelector('h1[align="center"]')?.textContent).toBe('共工')
    const badge = container.querySelector('a > img[alt="License"]')
    expect(badge?.getAttribute('src')).toBe('https://img.shields.io/badge/license-MIT-blue')
    expect(badge?.parentElement?.getAttribute('href')).toBe('https://github.com/x/y/blob/main/LICENSE')
    expect(container.querySelector('b')?.textContent).toBe('AI 团队工作区')
    expect(container.querySelector('br')).not.toBeNull()
    expect(container.querySelector('details > summary')?.textContent).toBe('更多')
    expect(container.querySelector('details strong')?.textContent).toBe('内容')
  })

  it('never renders raw HTML in chat replies', () => {
    const { container } = render(<Markdown text={README} />)
    expect(container.querySelector('p[align]')).toBeNull()
    expect(container.querySelector('h1')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('details')).toBeNull()
  })

  it('strips scripts, styles, event handlers and javascript: links', () => {
    const text = `<script>window.pwned = 1</script>
<style>body { display: none }</style>
<img src="x.png" onerror="window.pwned = 1">
<a href="javascript:alert(1)" onclick="alert(1)">坏链接</a>
<iframe src="https://evil.example"></iframe>

[也坏](javascript:alert(1))
`
    const { container } = render(<Markdown text={text} doc={makeDoc()} />)
    expect(container.querySelector('script, style, iframe')).toBeNull()
    expect(container.innerHTML).not.toContain('pwned')
    expect(container.innerHTML).not.toMatch(/onerror|onclick|javascript:/i)
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/raw/x.png')
  })

  describe('anchors', () => {
    const scroll = vi.fn()
    beforeEach(() => {
      Element.prototype.scrollIntoView = scroll
    })
    afterEach(() => {
      scroll.mockReset()
    })

    it('keeps GitHub heading ids and in-page jumps', () => {
      const text = `# Hello World

<a name="top"></a>

## 快速开始

## Hello World

[跳到快速开始](#快速开始) [回到顶部](#top)
`
      const { container, getByText } = render(<Markdown text={text} doc={makeDoc()} />)
      expect([...container.querySelectorAll('h1, h2')].map((h) => h.id)).toEqual([
        'hello-world',
        '快速开始',
        'hello-world-1',
      ])
      fireEvent.click(getByText('跳到快速开始'))
      expect(scroll.mock.contexts[0]).toBe(container.querySelector('h2'))
      fireEvent.click(getByText('回到顶部'))
      expect(scroll.mock.contexts[1]).toBe(container.querySelector('a[name="user-content-top"]'))
    })

    it('jumps from a footnote reference to its note', () => {
      const { container } = render(<Markdown text={'正文[^1]\n\n[^1]: 注释'} doc={makeDoc()} />)
      const ref = container.querySelector<HTMLAnchorElement>('a[data-footnote-ref]')
      expect(ref).not.toBeNull()
      fireEvent.click(ref as HTMLAnchorElement)
      expect((scroll.mock.contexts[0] as Element | undefined)?.closest('li')?.textContent).toContain('注释')
    })
  })

  it('keeps code languages, tables and relative links in doc mode', () => {
    const doc = makeDoc()
    const text = '```ts\nconst a = 1\n```\n\n| a | b |\n|:-|-:|\n| 1 | 2 |\n\n[指南](docs/guide.md)\n'
    const { container, getByText } = render(<Markdown text={text} doc={doc} />)
    expect(container.textContent).toContain('const a = 1')
    expect(getByText('ts')).toBeTruthy()
    expect(
      container.querySelector('.md-table td[align="right"], .md-table td[style*="right"]'),
    ).not.toBeNull()
    fireEvent.click(getByText('指南'))
    expect(doc.open).toHaveBeenCalledWith('docs/guide.md')
  })
})
