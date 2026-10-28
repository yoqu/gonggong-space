import { describe, expect, it } from 'vitest'
import { findUiBlocks, parseUiBlock, summarizeUiBlock, unplacedHtmlPages } from '../src/index.js'

const page = (attachmentId: string, title: string) => ({ attachmentId, title, height: 300 })

describe('ui blocks', () => {
  it('parses valid blocks and leaves invalid ones as code', () => {
    expect(parseUiBlock('actions', '{"options":[{"label":"扩容"}]}')).toEqual({
      lang: 'actions',
      data: { id: 'actions', options: [{ label: '扩容' }] },
    })
    expect(parseUiBlock('actions', 'not json')).toBeNull()
    expect(parseUiBlock('mermaid', 'graph TD; A-->B')).toEqual({ lang: 'mermaid', source: 'graph TD; A-->B' })
    expect(parseUiBlock('ts', 'const a = 1')).toBeNull()
  })

  it('leaves the retired chart, metrics, timeline and widget fences as code', () => {
    expect(parseUiBlock('chart', '{"type":"line","x":["a"],"series":[{"name":"CPU","data":[1]}]}')).toBeNull()
    expect(parseUiBlock('metrics', '[{"label":"CPU","value":78}]')).toBeNull()
    expect(parseUiBlock('timeline', '[{"time":"10:00","title":"x"}]')).toBeNull()
    expect(parseUiBlock('widget', '<p>hi</p>')).toBeNull()
  })

  it('finds closed blocks in a reply and summarizes them', () => {
    const md =
      '结论如下\n\n```actions\n{"prompt":"怎么办","options":[{"label":"扩容"},{"label":"忽略"}]}\n```\n\n```ts\nx\n```\n\n```mermaid\ngraph TD'
    const found = findUiBlocks(md)
    expect(found).toHaveLength(1)
    expect(summarizeUiBlock(found[0]!.block)).toBe('怎么办：扩容 / 忽略')
    expect(md.slice(found[0]!.start, found[0]!.end)).toMatch(/^```actions[\s\S]*```$/)
  })

  it('places html_render pages by id, ignoring other ids, and lists the unplaced ones', () => {
    expect(parseUiBlock('html-page', '{"id":"p1"}')).toEqual({ lang: 'html-page', id: 'p1' })
    expect(parseUiBlock('html-page', '{}')).toBeNull()
    const pages = [page('p1', 'CPU 走势'), page('p2', '营收')]
    const md = '先看图\n\n```html-page\n{"id":"p2"}\n```\n\n```html-page\n{"id":"x"}\n```\n结论'
    const found = findUiBlocks(md)
    expect(found.map((b) => summarizeUiBlock(b.block, pages))).toEqual(['📄 营收', ''])
    expect(summarizeUiBlock(found[0]!.block)).toBe('')
    expect(unplacedHtmlPages(md, pages)).toEqual([pages[0]])
    expect(unplacedHtmlPages('', pages)).toEqual(pages)
  })
})
