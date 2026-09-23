import { describe, expect, it } from 'vitest'
import { parseMentions } from '../src/modules/messages/mentions.js'

const bots = [
  { id: 'b1', name: '小王的 Claude' },
  { id: 'b2', name: '小王' },
  { id: 'b3', name: 'codex' },
  { id: 'b4', name: 'codex-2' },
]

describe('parseMentions', () => {
  it('matches names containing spaces', () => {
    expect(parseMentions('@小王的 Claude 写个脚本', bots)).toEqual(['b1'])
  })

  it('prefers the longest name at each @', () => {
    expect(parseMentions('@小王 看下，@codex-2 跑测试', bots)).toEqual(['b2', 'b4'])
    expect(parseMentions('@codex跑一下', bots)).toEqual(['b3'])
  })

  it('keeps mention order and dedupes', () => {
    expect(parseMentions('@codex 和 @小王的 Claude，再次 @codex', bots)).toEqual(['b3', 'b1'])
  })

  it('ignores unknown names, bare @ and email-like text', () => {
    expect(parseMentions('@李娜 看看 @ 这个 a@codex.com', bots)).toEqual([])
  })
})
