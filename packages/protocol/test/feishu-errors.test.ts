import { describe, expect, it } from 'vitest'
import { createTranslator, feishuErrorHint, protocolEn } from '../src/index.js'

describe('feishuErrorHint', () => {
  it('says what happened and what to do; a bot out of the chat can be pulled in', () => {
    expect(feishuErrorHint(230002)).toMatchObject({ what: '机器人不在飞书群里。', pullIn: true })
    expect(feishuErrorHint(20010).what).toBe('飞书应用还没发布，或相关成员不在它的可用范围内。')
    expect(feishuErrorHint(232024)).toEqual(feishuErrorHint(20010))
    expect(feishuErrorHint(99991672).what).toContain('权限')
    expect(feishuErrorHint(99991663).what).toBe('飞书应用的凭证已失效。')
    expect(feishuErrorHint(99991668).what).toBe('你的飞书授权已过期。')
    expect(feishuErrorHint(20010).pullIn).toBeUndefined()
    expect(feishuErrorHint(123).what).toBe('飞书返回了错误。')
  })

  it('renders an event in either language', () => {
    const h = feishuErrorHint(230002)
    const text = {
      key: '{bot} 的回复没有同步到飞书群：{what}{todo}',
      params: { bot: 'codex', what: { key: h.what }, todo: { key: h.todo } },
    }
    expect(createTranslator('zh', protocolEn).text(text)).toBe(
      'codex 的回复没有同步到飞书群：机器人不在飞书群里。请群管理员把它拉入飞书群，或在飞书群设置里添加该机器人。',
    )
    expect(createTranslator('en', protocolEn).text(text)).toBe(
      "codex's reply did not reach the Feishu chat: The bot is not in the Feishu chat. A group admin can add it to the chat, or add the bot in the Feishu chat settings.",
    )
  })
})
