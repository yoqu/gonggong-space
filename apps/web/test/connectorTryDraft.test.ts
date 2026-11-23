import { describe, expect, it } from 'vitest'
import { tryDraft } from '../src/features/connectors/tryDraft'

const bots = [
  { id: 'b1', name: '设计助手' },
  { id: 'b2', name: 'Claude' },
]
const c = {
  bots: [
    { botId: 'b1', blocker: 'agent' as const },
    { botId: 'b2', blocker: 'secret' as const },
  ],
}

describe('tryDraft', () => {
  it('@s a bot that can use the connector when nothing @s one yet', () => {
    expect(tryDraft('', '列出我有权限的数据源', c, bots, true)).toBe('@Claude 列出我有权限的数据源')
    expect(tryDraft('先看看', '列出数据源', c, bots, true)).toBe('@Claude 先看看\n列出数据源')
  })

  it('leaves the mention alone where none is needed or none can be made', () => {
    expect(tryDraft('@设计助手 ', '列出数据源', c, bots, false)).toBe('@设计助手\n列出数据源')
    expect(tryDraft('', '列出数据源', c, [], true)).toBe('列出数据源')
    expect(tryDraft('', '列出数据源', { bots: [] }, bots, true)).toBe('@设计助手 列出数据源')
  })
})
