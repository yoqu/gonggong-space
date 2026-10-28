import { describe, expect, it } from 'vitest'
import { findUiBlocks, parseUiBlock, summarizeUiBlock } from '../src/index.js'

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
})
