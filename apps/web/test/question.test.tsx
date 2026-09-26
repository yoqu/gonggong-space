import type { BotDto, GroupDto, MessageDto, QuestionSetDto, RunDto, UserDto } from '@gonggong/protocol'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { uploadFile } from '../src/features/attachments/api'
import { MessageComposer } from '../src/features/chat/MessageComposer'
import { useAppend } from '../src/features/runs/append'
import { QuestionBlock } from '../src/features/runs/QuestionBlock'
import { RunActions } from '../src/features/runs/RunActions'
import { apiError, mockApi } from './mockApi'

vi.mock('../src/features/attachments/api', async (orig) => ({
  ...(await orig<typeof import('../src/features/attachments/api')>()),
  uploadFile: vi.fn(),
}))

const NOW = new Date(2026, 8, 23, 10, 21, 0)

const set = (o: Partial<QuestionSetDto> = {}): QuestionSetDto => ({
  id: 'qs1',
  runId: 'r1',
  questions: [
    { id: 'q1', type: 'single', title: '用哪种语言？', options: ['Python', 'Go'], recommended: 0 },
    {
      id: 'q2',
      type: 'multi',
      title: '覆盖哪些渠道？',
      options: ['微信', '支付宝', '银联'],
      recommended: null,
    },
    { id: 'q3', type: 'yesno', title: '允许改 fixture 吗？', options: ['是', '否'], recommended: 0 },
    { id: 'q4', type: 'text', title: '还有什么要注意？', options: [], recommended: null },
  ],
  status: 'pending',
  answers: null,
  attachments: [],
  answeredBy: null,
  answeredByName: null,
  answeredAt: null,
  expiresAt: new Date(NOW.getTime() + 27 * 60_000 + 2_000).toISOString(),
  createdAt: NOW.toISOString(),
  ...o,
})

const run = (o: Partial<RunDto> = {}): RunDto => ({
  id: 'r1',
  groupId: 'g1',
  botId: 'b1',
  triggerMessageId: 'm1',
  triggerUserId: 'u-wang',
  hop: 1,
  status: 'awaiting_answer',
  step: '',
  filesChanged: 0,
  usage: null,
  newSessionReason: null,
  queuedAt: NOW.toISOString(),
  startedAt: NOW.toISOString(),
  endedAt: null,
  parentRunId: null,
  hopMax: 3,
  offlineWaitMin: 30,
  originUserId: 'u-wang',
  approvals: [],
  questions: [set()],
  interrupt: null,
  stoppedBy: null,
  delegation: { subagents: 0, subagentsRunning: 0, tasksRunning: 0 },
  model: null,
  effort: null,
  ...o,
})

const group = {
  id: 'g1',
  name: '退款',
  botIds: ['b1'],
  members: [
    { userId: 'u-wang', name: '王磊', isAdmin: true },
    { userId: 'u-li', name: '李建国', isAdmin: false },
    { userId: 'u-zhao', name: '赵敏', isAdmin: false },
  ],
} as GroupDto

const me = (id: string) => useSession.setState({ user: { id, name: id } as UserDto, status: 'ready' })
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(NOW)
  useWorkspace.setState({
    bots: [{ id: 'b1', name: '小王的 Claude', ownerId: 'u-li', ownerName: '李建国' } as BotDto],
    groups: [group],
  })
  useAppend.setState({ target: null })
  me('u-wang')
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('QuestionBlock', () => {
  it('renders nothing without questions', () => {
    const { container } = render(<QuestionBlock run={run({ questions: [] })} />)
    expect(container.textContent).toBe('')
  })

  it('shows the card like the prototype, with who may answer and a live countdown', () => {
    render(<QuestionBlock run={run()} />)
    expect(screen.getByText('向群成员提问 · 4 个问题')).toBeTruthy()
    expect(screen.getByText('· 触发人 王磊 或 Bot 主人 李建国 可回答')).toBeTruthy()
    for (const label of ['单选 ·', '多选 ·', '是/否 ·', '自由文本 ·'])
      expect(screen.getByText(label)).toBeTruthy()
    expect(button('Python推荐')).toBeTruthy()
    expect(button('是推荐')).toBeTruthy()
    expect(button('Go')).toBeTruthy()
    // 「其他，我来补充」 only for single / multi choice; free text for text questions.
    expect(screen.getAllByPlaceholderText('其他，我来补充')).toHaveLength(2)
    expect(screen.getByPlaceholderText('自由作答')).toBeTruthy()
    expect(screen.getByText('27:02 后超时，agent 按推荐项继续并在最终回复列出假设')).toBeTruthy()
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.getByText('27:01 后超时，agent 按推荐项继续并在最终回复列出假设')).toBeTruthy()
    expect(button('附图片或附件…')).toBeTruthy()
  })

  it('lets the trigger user answer every type and submit once all are answered', async () => {
    const calls = mockApi({ 'POST /runs/r1/questions/qs1/answers': set({ status: 'answered' }) })
    render(<QuestionBlock run={run()} />)
    expect(button('提交回答').disabled).toBe(true)
    fireEvent.click(button('Python推荐'))
    // Single choice: 「其他」 replaces the chosen option and vice versa.
    const [single, multi] = screen.getAllByPlaceholderText('其他，我来补充') as HTMLInputElement[]
    fireEvent.change(single!, { target: { value: 'Rust' } })
    expect(button('Python推荐').getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(button('Go'))
    expect(single!.value).toBe('')
    fireEvent.click(button('微信'))
    fireEvent.click(button('银联'))
    fireEvent.click(button('微信'))
    fireEvent.change(multi!, { target: { value: '云闪付' } })
    fireEvent.click(button('否'))
    expect(button('提交回答').disabled).toBe(true)
    fireEvent.change(screen.getByPlaceholderText('自由作答'), { target: { value: '注意幂等' } })
    fireEvent.click(button('提交回答'))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toEqual({
      method: 'POST',
      path: '/runs/r1/questions/qs1/answers',
      body: {
        answers: [
          { questionId: 'q1', choices: [1], text: null },
          { questionId: 'q2', choices: [2], text: '云闪付' },
          { questionId: 'q3', choices: [1], text: null },
          { questionId: 'q4', choices: [], text: '注意幂等' },
        ],
        attachmentIds: [],
      },
    })
  })

  it('uploads attachments for the answer', async () => {
    vi.mocked(uploadFile).mockImplementation((_g, f) => ({
      done: Promise.resolve({ id: 'att1', name: f.name, size: f.size, mime: f.type }),
      abort: vi.fn(),
    }))
    const calls = mockApi({ 'POST /runs/r1/questions/qs1/answers': set({ status: 'answered' }) })
    const one = run({ questions: [set({ questions: [set().questions[3]!] })] })
    const { container } = render(<QuestionBlock run={one} />)
    const input = container.querySelector('input[type=file]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['png'], 'shot.png', { type: 'image/png' })] } })
    await screen.findByText('shot.png')
    fireEvent.change(screen.getByPlaceholderText('自由作答'), { target: { value: '见截图' } })
    await waitFor(() => expect(button('提交回答').disabled).toBe(false))
    fireEvent.click(button('提交回答'))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]?.body).toMatchObject({ attachmentIds: ['att1'] })
  })

  it('lets the bot owner answer too, and reports a failed submit', async () => {
    me('u-li')
    const calls = mockApi({
      'POST /runs/r1/questions/qs1/answers': apiError(409, 'conflict', '该提问已处理'),
    })
    const one = run({ questions: [set({ questions: [set().questions[2]!] })] })
    render(<QuestionBlock run={one} />)
    fireEvent.click(button('是推荐'))
    fireEvent.click(button('提交回答'))
    await waitFor(() => expect(calls).toHaveLength(1))
  })

  it('is read-only for everyone else', () => {
    me('u-zhao')
    render(<QuestionBlock run={run()} />)
    expect(button('Go').disabled).toBe(true)
    expect(button('提交回答').disabled).toBe(true)
    expect(button('附图片或附件…').disabled).toBe(true)
    expect((screen.getByPlaceholderText('自由作答') as HTMLTextAreaElement).disabled).toBe(true)
  })

  it('names the chain initiator as the answerer of a relay hop', () => {
    render(<QuestionBlock run={run({ triggerUserId: null, hop: 2 })} />)
    expect(screen.getByText('· 触发人 王磊 或 Bot 主人 李建国 可回答')).toBeTruthy()
  })

  it.each([
    [
      set({
        status: 'answered',
        answeredByName: '王磊',
        answeredAt: new Date(2026, 8, 23, 10, 26).toISOString(),
        answers: [
          { questionId: 'q1', choices: [1], text: null },
          { questionId: 'q2', choices: [0], text: null },
          { questionId: 'q3', choices: [0], text: null },
          { questionId: 'q4', choices: [], text: '注意幂等' },
        ],
      }),
      '王磊 已回答 · 10:26 · 已写入审计记录',
    ],
    [set({ status: 'expired' }), '无人回答，agent 已按推荐项继续 · 10:48'],
    [set({ status: 'void' }), '已打断并追加，提问作废'],
  ])('shows the outcome %#', (q, text) => {
    render(<QuestionBlock run={run({ status: 'running', questions: [q] })} />)
    expect(screen.getByText(text)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '提交回答' })).toBeNull()
    expect(screen.queryByText(/后超时/)).toBeNull()
    if (q.status === 'void') {
      cleanup()
      render(<QuestionBlock run={run({ status: 'completed', questions: [q] })} />)
      expect(screen.getByText('运行已结束，提问作废')).toBeTruthy()
    }
    if (q.status === 'answered') {
      expect(button('Go').getAttribute('aria-pressed')).toBe('true')
      expect(button('Go').disabled).toBe(true)
      expect((screen.getByPlaceholderText('自由作答') as HTMLTextAreaElement).value).toBe('注意幂等')
    }
  })
})

describe('interrupt and append', () => {
  it('offers 打断并追加 on live runs to the trigger user and the bot owner only', () => {
    const { rerender } = render(<RunActions run={run({ status: 'running' })} />)
    fireEvent.click(button('打断并追加'))
    expect(useAppend.getState().target).toEqual({ runId: 'r1', groupId: 'g1', botName: '小王的 Claude' })
    act(() => me('u-zhao'))
    rerender(<RunActions run={run({ status: 'running' })} />)
    expect(screen.queryByRole('button', { name: '打断并追加' })).toBeNull()
    act(() => me('u-li'))
    rerender(<RunActions run={run({ status: 'awaiting_approval' })} />)
    expect(button('打断并追加')).toBeTruthy()
    rerender(<RunActions run={run({ status: 'queued' })} />)
    expect(screen.queryByRole('button', { name: '打断并追加' })).toBeNull()
  })

  it('the composer shows the banner and sends the next message into the run', async () => {
    const sent = { id: 'm2', body: '直接回复 appended' } as MessageDto
    const calls = mockApi({ 'POST /groups/g1/messages': sent })
    render(<MessageComposer group={group} onSent={() => {}} />)
    expect(screen.queryByText(/打断并追加到/)).toBeNull()
    act(() => useAppend.getState().start({ runId: 'r1', groupId: 'g1', botName: '小王的 Claude' }))
    expect(screen.getByText('打断并追加到 小王的 Claude · 已改内容保留，仍算同一轮')).toBeTruthy()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '直接回复 appended' } })
    fireEvent.click(button('发送'))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]?.body).toMatchObject({ body: '直接回复 appended', appendTo: 'r1' })
    await waitFor(() => expect(screen.queryByText(/打断并追加到/)).toBeNull())

    // 关闭 drops the target: the next message is an ordinary one.
    act(() => useAppend.getState().start({ runId: 'r1', groupId: 'g1', botName: '小王的 Claude' }))
    fireEvent.click(button('关闭'))
    expect(useAppend.getState().target).toBeNull()
    // Another group's target is not shown here.
    act(() => useAppend.getState().start({ runId: 'r9', groupId: 'g9', botName: 'x' }))
    expect(screen.queryByText(/打断并追加到/)).toBeNull()
  })
})
