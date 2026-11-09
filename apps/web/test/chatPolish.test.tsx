import { readFileSync } from 'node:fs'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { replyFiles } from '../src/features/chat/grouping'
import { Markdown, MentionNames } from '../src/features/chat/Markdown'
import { fmtUsage } from '../src/features/chat/TimelineItems'
import { plainText } from '../src/lib/plain'

describe('markdown autolinks', () => {
  it('stops a bare URL at full-width punctuation and CJK text', () => {
    const { container } = render(
      <Markdown text="打开本地页面（http://127.0.0.1:5173）。然后用 `cargo run` 启动，或访问 www.example.com，好" />,
    )
    const links = [...container.querySelectorAll('a')]
    expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['http://127.0.0.1:5173', 'http://127.0.0.1:5173'],
      ['www.example.com', 'http://www.example.com'],
    ])
    expect(container.textContent).toContain('http://127.0.0.1:5173）。然后用')
  })

  it('leaves written links alone', () => {
    render(<Markdown text="[文档](https://example.com/docs)" />)
    expect(screen.getByRole('link', { name: '文档' }).getAttribute('href')).toBe('https://example.com/docs')
  })

  it('keeps a written link whose url ends in its Chinese text', () => {
    render(<Markdown text="[快速开始](#快速开始) [文档](https://example.com/文档)" />)
    expect(screen.getByRole('link', { name: '快速开始' }).getAttribute('href')).toBe(
      '#%E5%BF%AB%E9%80%9F%E5%BC%80%E5%A7%8B',
    )
    expect(screen.getByRole('link', { name: '文档' })).toBeTruthy()
  })
})

describe('markdown mentions', () => {
  it('highlights members (me stronger) and greys bots as mention-only, skipping code and links', () => {
    const { container } = render(
      <MentionNames.Provider
        value={{ members: ['陈晨', '王磊'], bots: ['Codex', '陈晨的 Codex'], me: '王磊' }}
      >
        <Markdown
          text={
            '@陈晨 看下，@陈晨的 Codex 继续，`@陈晨` 不算，[@王磊](https://x.dev) 也不算\n\n**@王磊** 你确认'
          }
        />
      </MentionNames.Provider>,
    )
    const spans = [...container.querySelectorAll('.pn-mention')].map((e) => [e.textContent, e.className])
    expect(spans).toEqual([
      ['@陈晨', 'pn-mention'],
      ['@陈晨的 Codex', 'pn-mention pn-mention--bot'],
      ['@王磊', 'pn-mention pn-mention--me'],
    ])
    expect(screen.getByTitle('仅提及，不会让 Bot 开始工作')).toBeTruthy()
  })

  it('leaves @ alone outside a chat', () => {
    const { container } = render(<Markdown text="@陈晨 看下" />)
    expect(container.querySelector('.pn-mention')).toBeNull()
  })
})

describe('reply file chips', () => {
  it('skips technology names like Node.js that are not files', () => {
    expect(
      replyFiles('用 Node.js 和 Vue.js、Next.js 写的，改了 src/App.js、README.md 与 `index.js`'),
    ).toEqual(['src/App.js', 'README.md', 'index.js'])
  })
})

describe('plain text previews', () => {
  it('strips markdown syntax from a one-line preview', () => {
    expect(plainText('设计师大象：**快速开始**')).toBe('设计师大象：快速开始')
    expect(plainText('小王：## 结论 见 [文档](https://x.io) 和 `a.ts`，*注意* ~~旧~~ snake_case_name')).toBe(
      '小王：结论 见 文档 和 a.ts，注意 旧 snake_case_name',
    )
    expect(plainText('小王：- 第一项')).toBe('小王：第一项')
    expect(plainText('> 引用内容')).toBe('引用内容')
  })
})

describe('run token usage', () => {
  it('switches from k to M before printing a four-digit k', () => {
    expect(fmtUsage({ totalTokens: 232_700 })).toBe('232.7k tokens')
    expect(fmtUsage({ totalTokens: 999_949 })).toBe('999.9k tokens')
    expect(fmtUsage({ totalTokens: 1_234_500 })).toBe('1.2M tokens')
  })
})

describe('scroll containers do not show a horizontal bar', () => {
  // The hover action bar sits outside the message column and is only faded out, so it still
  // counts toward scroll width; overflow-x must be hidden or overflow-y: auto turns it into a scrollbar.
  const ruleOf = (css: string, selector: string) => {
    const start = css.indexOf(`${selector} {`)
    return css.slice(start, css.indexOf('}', start))
  }

  it('hides the horizontal overflow of the chat timeline', () => {
    const css = readFileSync('src/features/chat/timeline.css', 'utf8')
    expect(ruleOf(css, '.chat-scroll')).toContain('overflow-x: hidden')
  })

  it('hides the horizontal overflow of the thread panel scroll area', () => {
    const css = readFileSync('src/ui/im/panels.css', 'utf8')
    expect(ruleOf(css, '.pn-threadpanel__scroll')).toContain('overflow-x: hidden')
  })
})
