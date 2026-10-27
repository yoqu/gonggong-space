import { describe, expect, it } from 'vitest'
import { placeCommand, trigger } from '../src/features/chat/ComposerCandidates'

const names = ['小王的 Claude', '李建国', '共字君', '共字君Codex']

describe('/ in the composer', () => {
  it('completes a command at the start, after leading mentions, or after a space mid-sentence', () => {
    expect(trigger('/rev', names)).toEqual({ char: '/', query: 'rev', mid: false })
    expect(trigger('@小王的 Claude /rev', names)).toEqual({ char: '/', query: 'rev', mid: false })
    expect(trigger('@小王的 Claude 帮我看下 /rev', names)).toEqual({ char: '/', query: 'rev', mid: true })
  })

  it('stays quiet inside paths, URLs and fractions, and once the message starts with a command', () => {
    for (const s of ['改 src/a', '打开 https://x', '占 1/2', '看 /usr/', '/review 然后 /dep'])
      expect(trigger(s, names)).toBeNull()
  })

  it('does not split a bot mention when another bot name is its prefix', () => {
    expect(trigger('@共字君Codex /new', names)).toEqual({ char: '/', query: 'new', mid: false })
    expect(placeCommand('@共字君Codex 请 /new', 16, '/new', names)).toEqual({
      next: '@共字君Codex /new 请 ',
      pos: '@共字君Codex /new 请 '.length,
    })
  })

  it('moves a picked mid-sentence command to the start, after leading mentions', () => {
    const draft = '@小王的 Claude 帮我看下 /rev 这个 PR'
    const caret = draft.indexOf(' 这个')
    expect(placeCommand(draft, caret, '/review', names)).toEqual({
      next: '@小王的 Claude /review 帮我看下 这个 PR',
      pos: '@小王的 Claude /review 帮我看下 '.length,
    })
    expect(placeCommand('帮我看下 /re', 8, '/review', names)).toEqual({ next: '/review 帮我看下 ', pos: 13 })
  })
})
