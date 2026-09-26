import { describe, expect, it } from 'vitest'
import { parseCommand } from '../src/modules/commands/parse.js'

const bots = [
  { id: 'b1', name: '小王的 Claude' },
  { id: 'b2', name: '小王' },
  { id: 'b3', name: 'codex' },
]

describe('parseCommand', () => {
  it('splits name, mentions and the remaining args (paths with spaces)', () => {
    expect(parseCommand('/cd @小王的 Claude /Users/x/code/a b', bots)).toEqual({
      name: 'cd',
      mentions: ['b1'],
      args: '/Users/x/code/a b',
    })
    expect(parseCommand('/cd @codex --reset', bots)).toEqual({
      name: 'cd',
      mentions: ['b3'],
      args: '--reset',
    })
  })

  it('handles commands without mentions or args and leading whitespace', () => {
    expect(parseCommand('/new', bots)).toEqual({ name: 'new', mentions: [], args: '' })
    expect(parseCommand('  /new @小王 @codex\n', bots)).toEqual({
      name: 'new',
      mentions: ['b2', 'b3'],
      args: '',
    })
  })

  it('accepts mentions typed before the slash', () => {
    expect(parseCommand('@codex /new', bots)).toEqual({ name: 'new', mentions: ['b3'], args: '' })
    expect(parseCommand(' @小王的 Claude @codex /stop 理由', bots)).toEqual({
      name: 'stop',
      mentions: ['b1', 'b3'],
      args: '理由',
    })
    expect(parseCommand('@codex 你好 /new', bots)).toBeNull()
  })

  it('keeps names case-sensitive and ignores non-commands', () => {
    expect(parseCommand('/New @codex', bots)?.name).toBe('New')
    expect(parseCommand('hi /new @codex', bots)).toBeNull()
    expect(parseCommand('/ new', bots)).toBeNull()
    expect(parseCommand('/new@codex', bots)?.name).toBe('new@codex')
  })
})
