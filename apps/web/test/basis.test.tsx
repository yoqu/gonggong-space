import type { MessageDto } from '@gonggong/protocol'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { BotReply } from '../src/features/chat/TimelineItems'

const reply = (body: string): MessageDto => ({
  id: 'm1',
  seq: 1,
  groupId: 'g1',
  kind: 'bot',
  authorId: 'b1',
  authorName: '小助手',
  body,
  mentions: [],
  runId: null,
  createdAt: '2026-11-07T08:00:00Z',
  attachments: [],
  quote: null,
  reactions: [],
})

const show = (body: string) =>
  render(
    <MemoryRouter>
      <BotReply m={reply(body)} />
    </MemoryRouter>,
  )

describe('依据 in a bot reply', () => {
  it('folds the last 依据 section into a closed details, the conclusion staying in view', () => {
    show(
      '**依据**\n\n早先的依据\n\n上月会员营业额 120 万，环比涨 8%。\n\n**依据**\n\n查了 `member_order` 表\n\n- 口径：已支付',
    )
    const details = document.querySelector('details')
    expect(details?.open).toBe(false)
    expect(details?.querySelector('summary')?.textContent).toBe('依据')
    expect(details?.textContent).toContain('member_order')
    expect(details?.textContent).toContain('口径：已支付')
    expect(details?.textContent).not.toContain('早先的依据')
    expect(screen.getByText('上月会员营业额 120 万，环比涨 8%。').closest('details')).toBeNull()
  })

  it('takes ## 依据 and English Basis headings, and text on the heading line', () => {
    const a = show('Revenue is up.\n\n## Basis\n\nFrom the orders table.')
    expect(document.querySelector('details')?.textContent).toContain('From the orders table.')
    a.unmount()
    show('营业额涨了。\n\n**依据**：查了订单表')
    expect(document.querySelector('details')?.textContent).toContain('查了订单表')
  })

  it('leaves a reply alone when nothing follows the heading or it sits in code', () => {
    const a = show('结论。\n\n**依据**')
    expect(document.querySelector('details')).toBeNull()
    a.unmount()
    show('结论。\n\n```md\n**依据**\n\n内容\n```')
    expect(document.querySelector('details')).toBeNull()
  })
})
