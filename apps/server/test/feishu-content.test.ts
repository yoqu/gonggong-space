import { describe, expect, it } from 'vitest'
import { parseContent } from '../src/modules/feishu/inbound.js'

describe('parseContent', () => {
  it('names @ placeholders and collapses the spaces Feishu leaves around them', () => {
    const mentions = [{ key: '@_user_1', name: 'codex测试' }]
    expect(parseContent('text', JSON.stringify({ text: '@_user_1  你好' }), mentions).body).toBe(
      '@codex测试 你好',
    )
    expect(parseContent('text', JSON.stringify({ text: '看下 @_user_1   这个' }), mentions).body).toBe(
      '看下 @codex测试 这个',
    )
  })
})
