import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ChatInfoPanel,
  ChatNotice,
  CodeBlock,
  Composer,
  ConversationList,
  EmojiPicker,
  EventCard,
  LinkPreview,
  MeetingCard,
  MentionPicker,
  Message,
  MessageList,
  messageMenuItems,
  ProfileCard,
  Reactions,
  ThreadPanel,
  TypingIndicator,
  VoiceMessage,
} from '../src/ui'

const MEMBERS = [
  { name: '张三', pinyin: 'zhangsan', subtitle: '前端', status: 'online' as const },
  { name: '李思远', pinyin: 'lisiyuan', subtitle: '产品' },
  { name: 'Mia Chen', subtitle: '设计' },
]

describe('ConversationList keyboard', () => {
  const items = [
    { id: 'a', name: '产品设计组' },
    { id: 'b', name: '张三' },
    { id: 'c', name: '审批' },
  ]

  it('is a single tab stop on the selected row', () => {
    render(<ConversationList items={items} defaultSelected="b" />)
    const rows = screen.getAllByRole('listitem')
    expect(rows.map((r) => r.tabIndex)).toEqual([-1, 0, -1])
    expect(screen.getByRole('list', { name: '会话' })).toBeTruthy()
  })

  it('falls back to the first row when nothing is selected', () => {
    render(<ConversationList items={items} />)
    expect(screen.getAllByRole('listitem').map((r) => r.tabIndex)).toEqual([0, -1, -1])
  })

  it('moves and selects with arrows, Home and End', () => {
    const onSelect = vi.fn()
    render(<ConversationList items={items} defaultSelected="a" onSelect={onSelect} />)
    const [a, b, c] = screen.getAllByRole('listitem') as [HTMLElement, HTMLElement, HTMLElement]
    a.focus()
    fireEvent.keyDown(a, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(b)
    expect(onSelect).toHaveBeenLastCalledWith('b')
    expect(b.getAttribute('aria-current')).toBe('true')
    fireEvent.keyDown(b, { key: 'End' })
    expect(document.activeElement).toBe(c)
    expect(onSelect).toHaveBeenLastCalledWith('c')
    fireEvent.keyDown(c, { key: 'Home' })
    expect(document.activeElement).toBe(a)
    fireEvent.keyDown(a, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(a)
  })
})

describe('ChatNotice recalled', () => {
  it('defaults the text and offers 重新编辑', () => {
    const onClick = vi.fn()
    render(<ChatNotice kind="recalled" action={{ label: '重新编辑', onClick }} />)
    expect(screen.getByText('你撤回了一条消息')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重新编辑' }))
    expect(onClick).toHaveBeenCalledOnce()
  })
})

describe('Reactions addable', () => {
  it('opens an EmojiPicker from + and toggles the pick', () => {
    const onToggle = vi.fn()
    render(<Reactions items={[{ emoji: '👍', users: ['张三'] }]} addable onToggle={onToggle} />)
    const add = screen.getByRole('button', { name: '添加表情回复' })
    expect(add.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(add)
    expect(add.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(
      within(screen.getByRole('dialog', { name: '选择表情' })).getByRole('option', { name: '完成' }),
    )
    expect(onToggle).toHaveBeenCalledWith('✅')
    expect(screen.queryByRole('dialog', { name: '选择表情' })).toBeNull()
  })

  it('closes on Escape and returns focus to +', () => {
    render(<Reactions items={[]} addable />)
    const add = screen.getByRole('button', { name: '添加表情回复' })
    fireEvent.click(add)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '选择表情' })).toBeNull()
    expect(document.activeElement).toBe(add)
  })
})

describe('Composer mentions and emoji', () => {
  const setup = (props: Partial<Parameters<typeof Composer>[0]> = {}) => {
    const onMention = vi.fn()
    const onSend = vi.fn()
    render(
      <Composer recipient="产品设计组" mentions={MEMBERS} onMention={onMention} onSend={onSend} {...props} />,
    )
    const input = screen.getByPlaceholderText('发送给 产品设计组') as HTMLTextAreaElement
    const type = (value: string) =>
      fireEvent.change(input, { target: { value, selectionStart: value.length } })
    return { input, type, onMention, onSend }
  }

  it('opens the picker on @ with 所有人 first and filters by pinyin', () => {
    const { input, type } = setup()
    type('你好 @')
    const list = screen.getByRole('listbox', { name: '选择要提及的人' })
    expect(within(list).getAllByRole('option')[0]?.textContent).toContain('所有人')
    expect(input.getAttribute('aria-expanded')).toBe('true')
    type('你好 @li')
    const opts = within(screen.getByRole('listbox')).getAllByRole('option')
    expect(opts).toHaveLength(1)
    expect(opts[0]?.textContent).toContain('李思远')
  })

  it('moves with arrows and inserts「@名字 」on Enter without sending', () => {
    const { input, type, onMention, onSend } = setup({ mentionAll: false })
    type('@')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    const opts = screen.getAllByRole('option')
    expect(opts[1]?.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(input.value).toBe('@李思远 ')
    expect(onMention).toHaveBeenCalledWith(MEMBERS[1])
    expect(onSend).not.toHaveBeenCalled()
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('closes the picker on Escape', () => {
    const { input, type } = setup()
    type('@')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('toggles the emoji picker and inserts at the caret', () => {
    const { input } = setup()
    const btn = screen.getByRole('button', { name: '表情' })
    fireEvent.click(btn)
    expect(btn.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(
      within(screen.getByRole('dialog', { name: '选择表情' })).getByRole('option', { name: '赞' }),
    )
    expect(input.value).toBe('👍')
    expect(screen.queryByRole('dialog', { name: '选择表情' })).toBeNull()
    expect(btn.getAttribute('aria-pressed')).toBe('false')
  })

  it('renders an accessory beside the send button', () => {
    setup({ accessory: <span data-testid="acc">同时发送到群聊</span> })
    expect(screen.getByTestId('acc').closest('.pn-composer__accessory')).toBeTruthy()
  })

  it('leaves the app’s own @ tool alone when no mentions are given', () => {
    const onClick = vi.fn()
    render(<Composer recipient="x" tools={[{ icon: 'at', label: '@ 提及', onClick }]} />)
    fireEvent.click(screen.getByRole('button', { name: '@ 提及' }))
    expect(onClick).toHaveBeenCalledOnce()
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})

describe('MentionPicker', () => {
  it('bolds the match and caps at 8 rows', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ name: `成员${i}` }))
    const { container, unmount } = render(<MentionPicker members={many} query="成员" />)
    expect(screen.getAllByRole('option')).toHaveLength(8)
    expect(container.querySelector('.pn-mentionpicker__name b')?.textContent).toBe('成员')
    unmount()
    render(<MentionPicker members={MEMBERS} query="xyz" includeAll={false} />)
    expect(screen.getByText('没有匹配的成员')).toBeTruthy()
  })
})

describe('EmojiPicker', () => {
  it('searches by Chinese keyword', () => {
    const onSelect = vi.fn()
    render(<EmojiPicker onSelect={onSelect} />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '上线' } })
    fireEvent.click(screen.getByRole('option', { name: '火箭' }))
    expect(onSelect).toHaveBeenCalledWith('🚀')
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '不存在' } })
    expect(screen.getByText('没有找到相关表情')).toBeTruthy()
  })

  it('moves by 8 per row with arrows', () => {
    render(<EmojiPicker defaultCategory="smile" />)
    const cells = screen.getAllByRole('option')
    cells[0]?.focus()
    fireEvent.keyDown(cells[0] as HTMLElement, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(cells[8])
    fireEvent.keyDown(cells[8] as HTMLElement, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(cells[9])
  })
})

describe('CodeBlock', () => {
  afterEach(() => vi.useRealTimers())

  it('copies the code and announces 已拷贝', async () => {
    vi.useFakeTimers()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    render(<CodeBlock code={'pnpm test\n'} language="bash" />)
    expect(screen.getByText('bash')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '拷贝' }))
    expect(writeText).toHaveBeenCalledWith('pnpm test\n')
    expect(screen.getByRole('status').textContent).toBe('已拷贝')
    await act(() => vi.advanceTimersByTimeAsync(1600))
    expect(screen.getByRole('status').textContent).toBe('')
  })
})

describe('TypingIndicator', () => {
  it('names up to two people, then 等 N 人', () => {
    const { rerender } = render(<TypingIndicator name="张三" />)
    expect(screen.getByRole('status').textContent).toBe('张三 正在输入…')
    rerender(<TypingIndicator name={['张三', '李四', '王五']} bubble={false} />)
    expect(screen.getByRole('status').textContent).toBe('张三、李四 等 3 人 正在输入…')
  })
})

describe('messageMenuItems', () => {
  const values = (self: boolean) =>
    messageMenuItems({ self }).map((i) => ('value' in i ? i.value : 'separator' in i ? '-' : '?'))

  it('offers edit and recall on own messages, delete on others', () => {
    expect(values(true)).toEqual([
      'reply',
      'thread',
      'forward',
      '-',
      'copy',
      'pin',
      'todo',
      'select',
      '-',
      'edit',
      'recall',
    ])
    expect(values(false).slice(-2)).toEqual(['-', 'delete'])
  })
})

describe('ThreadPanel', () => {
  it('shows root, reply count and a thread composer with 同时发送到群聊', () => {
    const onClose = vi.fn()
    render(
      <ThreadPanel subtitle="产品设计组" onClose={onClose} root={<p>原消息</p>}>
        <Message author={{ name: '张三' }}>一</Message>
        <Message author={{ name: '李四' }}>二</Message>
      </ThreadPanel>,
    )
    expect(screen.getByRole('complementary', { name: '话题' })).toBeTruthy()
    expect(screen.getByText('2 条回复')).toBeTruthy()
    expect(screen.getByPlaceholderText('回复话题')).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: '同时发送到群聊' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '关闭话题' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})

describe('ChatInfoPanel', () => {
  it('lists members, settings and a danger row', () => {
    const onAdd = vi.fn()
    const onRow = vi.fn()
    const onDanger = vi.fn()
    render(
      <ChatInfoPanel
        name="产品设计组"
        members={[{ name: '张三' }, { name: '李四' }]}
        memberCount={28}
        onAddMember={onAdd}
        settings={[{ label: '群公告', value: '每周四评审', onClick: onRow }]}
        danger={{ label: '退出群聊', onClick: onDanger }}
      />,
    )
    expect(screen.getByRole('complementary', { name: '群设置' })).toBeTruthy()
    expect(screen.getByText('28')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    fireEvent.click(screen.getByRole('button', { name: /群公告/ }))
    fireEvent.click(screen.getByRole('button', { name: '退出群聊' }))
    expect([onAdd, onRow, onDanger].map((f) => f.mock.calls.length)).toEqual([1, 1, 1])
  })
})

describe('ProfileCard', () => {
  it('makes the first action primary and icon-only ones labelled', () => {
    const { container } = render(
      <ProfileCard
        name="张三"
        statusText="会议中 · 至 11:00"
        fields={[{ label: '邮箱', value: 'z@x.com' }]}
        actions={[
          { label: '发消息', icon: 'bubble' },
          { label: '语音通话', icon: 'phone', text: false },
        ]}
      />,
    )
    const [first, second] = screen.getAllByRole('button')
    expect(first?.className).toContain('primary')
    expect(second?.getAttribute('aria-label')).toBe('语音通话')
    expect(second?.textContent).toBe('')
    expect(container.querySelector('dt')?.textContent).toBe('邮箱')
  })
})

describe('MeetingCard', () => {
  it('joins while live and replays when ended', () => {
    const onJoin = vi.fn()
    const { rerender } = render(<MeetingCard title="评审" status="live" onJoin={onJoin} />)
    expect(screen.getByText('进行中')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '加入会议' }))
    expect(onJoin).toHaveBeenCalledOnce()
    rerender(<MeetingCard title="评审" status="ended" duration="42 分钟" onReplay={() => {}} />)
    expect(screen.getByText('已结束')).toBeTruthy()
    expect(screen.getByText('42 分钟')).toBeTruthy()
    expect(screen.getByRole('button', { name: '查看回放' })).toBeTruthy()
  })
})

describe('EventCard', () => {
  it('answers the invitation in place', () => {
    const onRsvp = vi.fn()
    render(
      <EventCard title="评审" month="9月" day={26} weekday="周五" time="15:00 – 16:00" onRsvp={onRsvp} />,
    )
    expect(screen.getByText('是否参加？')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: '接受' }))
    expect(onRsvp).toHaveBeenCalledWith('accepted')
    expect(screen.getByText('你已接受')).toBeTruthy()
  })
})

describe('VoiceMessage', () => {
  it('toggles play and clears the unread dot', () => {
    const onPlay = vi.fn()
    const { container } = render(<VoiceMessage duration={9} seed="x" onPlay={onPlay} />)
    expect(container.querySelector('.pn-voice__dur')?.textContent).toBe('0:09')
    expect(screen.getByLabelText('未听')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '播放语音' }))
    expect(onPlay).toHaveBeenCalledWith(true)
    expect(screen.getByRole('button', { name: '暂停' })).toBeTruthy()
    expect(screen.queryByLabelText('未听')).toBeNull()
  })
})

describe('LinkPreview', () => {
  it('defaults the site to the domain and opens in a new tab', () => {
    render(<LinkPreview url="https://developer.apple.com/design/" title="HIG" />)
    const link = screen.getByRole('link')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.textContent).toContain('developer.apple.com')
  })
})

describe('MessageList stickToBottom', () => {
  it('scrolls the nearest scroller to the bottom as messages arrive', () => {
    const sc = document.createElement('div')
    sc.style.overflowY = 'auto'
    Object.defineProperty(sc, 'scrollHeight', { value: 500 })
    Object.defineProperty(sc, 'clientHeight', { value: 100 })
    document.body.append(sc)
    render(
      <MessageList stickToBottom>
        <p>一</p>
      </MessageList>,
      { container: sc },
    )
    expect(sc.scrollTop).toBe(500)
    sc.remove()
  })
})
