import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { replyFiles } from '../src/features/chat/grouping'
import { Markdown } from '../src/features/chat/Markdown'
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
