import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Composer, ConversationItem, listTime, Mention, Message, ReadReceipt } from '../src/ui'

const flagOf = (container: HTMLElement) => container.querySelector('.pn-conv__flag')?.textContent ?? null

describe('ConversationItem', () => {
  const base = { id: 'a', name: '产品设计组', preview: '稿子更新了' }

  it('prefixes 加急 over 有人@我 over 草稿', () => {
    const all = render(<ConversationItem item={{ ...base, urgent: true, mention: true, draft: '周报' }} />)
    expect(flagOf(all.container)).toBe('[加急] ')
    all.unmount()
    const mention = render(<ConversationItem item={{ ...base, mention: true, draft: '周报' }} />)
    expect(flagOf(mention.container)).toBe('[有人@我] ')
    mention.unmount()
    const draft = render(<ConversationItem item={{ ...base, draft: '周报' }} />)
    expect(flagOf(draft.container)).toBe('[草稿] ')
    expect(draft.container.querySelector('.pn-conv__preview')?.textContent).toBe('[草稿] 周报')
    draft.unmount()
    const plain = render(<ConversationItem item={base} />)
    expect(flagOf(plain.container)).toBeNull()
  })

  it('shows a muted badge and marks the selected row', () => {
    const { container } = render(<ConversationItem item={{ ...base, unread: 120, muted: true }} selected />)
    expect(container.querySelector('.pn-conv')?.getAttribute('aria-current')).toBe('true')
    const badge = container.querySelector('.ui-badge')
    expect(badge?.textContent).toBe('99+')
    expect(badge?.classList.contains('ui-badge--muted')).toBe(true)
    expect(screen.getByLabelText('免打扰')).toBeTruthy()
  })
})

describe('listTime', () => {
  it('writes 10:42 today, 昨天, 星期二 within a week and 9月20日 earlier', () => {
    const now = new Date(2026, 8, 25, 15, 0)
    const at = (d: number, h = 10, m = 42) => new Date(2026, 8, d, h, m).toISOString()
    expect(listTime(at(25), now)).toBe('10:42')
    expect(listTime(at(24, 23, 59), now)).toBe('昨天')
    expect(listTime(at(22), now)).toBe('星期二')
    expect(listTime(at(18), now)).toBe('9月18日')
    expect(listTime(new Date(2025, 8, 20).toISOString(), now)).toBe('2025年9月20日')
  })
})

describe('Message', () => {
  it('renders others on the left in bubble-in with avatar and name', () => {
    const { container } = render(
      <Message author={{ name: 'Mia Chen' }} time="10:20">
        你好
      </Message>,
    )
    const row = container.querySelector('.pn-msg') as HTMLElement
    expect(row.classList.contains('pn-msg--self')).toBe(false)
    expect(container.querySelector('.pn-bubble p')?.textContent).toBe('你好')
    expect(container.querySelector('.ui-avatar')).toBeTruthy()
    expect(container.querySelector('.pn-msg__meta b')?.textContent).toBe('Mia Chen')
  })

  it('right-aligns self messages without repeating the own name', () => {
    const { container } = render(
      <Message self author={{ name: 'Yoqu' }} time="10:31">
        收到
      </Message>,
    )
    expect(container.querySelector('.pn-msg')?.classList.contains('pn-msg--self')).toBe(true)
    expect(container.querySelector('.pn-msg__meta b')).toBeNull()
  })

  it('drops avatar and meta for continued messages', () => {
    const { container } = render(
      <Message continued author={{ name: 'Mia Chen' }} time="10:21">
        第二条
      </Message>,
    )
    expect(container.querySelector('.pn-msg--cont')).toBeTruthy()
    expect(container.querySelector('.ui-avatar')).toBeNull()
    expect(container.querySelector('.pn-msg__gutter')).toBeTruthy()
    expect(container.querySelector('.pn-msg__meta')).toBeNull()
  })

  it('renders bare content without a bubble', () => {
    const { container } = render(
      <Message bare author={{ name: '审批' }}>
        <div data-testid="card">卡片</div>
      </Message>,
    )
    expect(container.querySelector('.pn-bubble')).toBeNull()
    expect(container.querySelector('.pn-msg__bare [data-testid="card"]')).toBeTruthy()
  })

  it('tags bot authors with Bot and a square avatar', () => {
    const { container } = render(
      <Message author={{ name: 'Codex', bot: true }} time="10:28">
        完成
      </Message>,
    )
    const tag = container.querySelector('.pn-msg__meta .ui-tag')
    expect(tag?.textContent).toBe('Bot')
    expect(tag?.classList.contains('ui-tag--blue')).toBe(true)
    expect(container.querySelector('.ui-avatar--square')).toBeTruthy()
  })

  it('offers a retry when sending failed', () => {
    const onRetry = vi.fn()
    render(
      <Message self author={{ name: 'Yoqu' }} status="failed" onRetry={onRetry}>
        附上纪要
      </Message>,
    )
    fireEvent.click(screen.getByRole('button', { name: '发送失败，重新发送' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })
})

describe('Composer', () => {
  const setup = (props: Partial<Parameters<typeof Composer>[0]> = {}) => {
    const onSend = vi.fn()
    render(<Composer recipient="产品设计组" onSend={onSend} {...props} />)
    return { onSend, input: screen.getByPlaceholderText('发送给 产品设计组') as HTMLTextAreaElement }
  }

  it('sends on Enter and clears', () => {
    const { onSend, input } = setup()
    fireEvent.change(input, { target: { value: '收到 ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSend).toHaveBeenCalledWith('收到')
    expect(input.value).toBe('')
  })

  it('keeps Shift+Enter as a newline', () => {
    const { onSend, input } = setup()
    fireEvent.change(input, { target: { value: '第一行' } })
    const ev = fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(ev).toBe(true)
    expect(onSend).not.toHaveBeenCalled()
  })

  it('does not send while an IME is composing', () => {
    const { onSend, input } = setup()
    fireEvent.change(input, { target: { value: 'nihao' } })
    fireEvent.compositionStart(input)
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })
    expect(onSend).not.toHaveBeenCalled()
  })

  it('disables send while empty', () => {
    const { onSend, input } = setup()
    const send = screen.getByRole('button', { name: '发送' }) as HTMLButtonElement
    expect(send.disabled).toBe(true)
    fireEvent.change(input, { target: { value: '   ' } })
    expect(send.disabled).toBe(true)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSend).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: '好' } })
    expect(send.disabled).toBe(false)
    fireEvent.click(send)
    expect(onSend).toHaveBeenCalledWith('好')
  })

  it('lets canSend make an empty draft sendable', () => {
    setup({ canSend: true })
    expect((screen.getByRole('button', { name: '发送' }) as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('ReadReceipt', () => {
  const shape = (read: number, total?: number) => {
    const { container, unmount } = render(<ReadReceipt read={read} total={total} />)
    const el = container.querySelector('.pn-receipt') as HTMLElement
    const out = {
      cls: el.className,
      label: el.getAttribute('aria-label'),
      check: !!el.querySelector('svg'),
      el,
    }
    unmount()
    return out
  }

  it('is hollow when unread', () => {
    const s = shape(0, 5)
    expect(s.cls).toContain('pn-receipt--none')
    expect(s.label).toBe('5 人未读')
    expect(s.check).toBe(false)
  })

  it('is a pie when partially read', () => {
    const s = shape(2, 5)
    expect(s.cls).toContain('pn-receipt--partial')
    expect(s.label).toBe('3 人未读')
    expect(s.el.style.getPropertyValue('--pn-read')).toBe('144deg')
  })

  it('is a checkmark when everyone read', () => {
    expect(shape(5, 5)).toMatchObject({ label: '全部已读', check: true })
    expect(shape(1)).toMatchObject({ label: '已读', check: true })
    expect(shape(0)).toMatchObject({ label: '未读', check: false })
  })
})

describe('Mention', () => {
  it('fills the capsule only for me', () => {
    const { container } = render(
      <>
        <Mention name="张三" />
        <Mention name="Yoqu" me />
      </>,
    )
    const [other, me] = Array.from(container.querySelectorAll('.pn-mention')) as [Element, Element]
    expect(other.textContent).toBe('@张三')
    expect(other.classList.contains('pn-mention--me')).toBe(false)
    expect(me.classList.contains('pn-mention--me')).toBe(true)
  })
})
