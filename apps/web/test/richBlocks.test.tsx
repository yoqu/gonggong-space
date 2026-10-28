import type { MessageDto } from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Markdown } from '../src/features/chat/Markdown'
import { RichMessage } from '../src/features/rich/context'
import { useToasts } from '../src/ui'
import { apiError, mockApi } from './mockApi'

const mermaid = { initialize: vi.fn(), parse: vi.fn(), render: vi.fn() }
vi.mock('mermaid', () => ({ default: mermaid }))

const fence = (lang: string, body: unknown) =>
  `前文\n\n\`\`\`${lang}\n${typeof body === 'string' ? body : JSON.stringify(body)}\n\`\`\`\n\n后文`

const reply = (o: Partial<MessageDto> = {}): MessageDto => ({
  id: 'm1',
  seq: 1,
  groupId: 'g1',
  kind: 'bot',
  authorId: 'b1',
  authorName: '小助手',
  body: '',
  mentions: [],
  runId: null,
  createdAt: new Date().toISOString(),
  attachments: [],
  quote: null,
  ...o,
})

const inReply = (text: string, m: MessageDto = reply({ body: text })) =>
  render(
    <RichMessage.Provider value={m}>
      <Markdown text={text} botId="b1" />
    </RichMessage.Provider>,
  )

/** A plain code block (the fallback): its header names the language and its text is the source. */
const codeBlock = (lang: string) => screen.getByText(lang, { selector: '.pn-code__head span' })

beforeEach(() => {
  vi.clearAllMocks()
  useToasts.setState({ items: [] })
  document.documentElement.dataset.theme = 'light'
})
afterEach(() => vi.unstubAllGlobals())

describe('retired blocks', () => {
  it('chart, metrics, timeline and widget fences stay plain code (visuals come from html_render)', () => {
    for (const lang of ['chart', 'metrics', 'timeline', 'widget']) {
      const { unmount } = render(<Markdown text={fence(lang, lang === 'widget' ? '<p>x</p>' : '[]')} />)
      expect(codeBlock(lang)).toBeTruthy()
      unmount()
    }
  })
})

describe('mermaid', () => {
  it('renders strictly, themed after the app', async () => {
    document.documentElement.dataset.theme = 'dark'
    mermaid.parse.mockResolvedValue({})
    mermaid.render.mockResolvedValue({ svg: '<svg data-testid="diagram"></svg>' })
    render(<Markdown text={fence('mermaid', 'graph TD\nA-->B')} />)
    expect(await screen.findByTestId('diagram')).toBeTruthy()
    expect(mermaid.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ startOnLoad: false, securityLevel: 'strict', theme: 'dark' }),
    )
    expect(mermaid.render.mock.calls[0]?.[1]).toBe('graph TD\nA-->B')
  })

  it('shows the source with a hint when it cannot render', async () => {
    mermaid.parse.mockRejectedValue(new Error('Parse error'))
    render(<Markdown text={fence('mermaid', 'graph ??')} />)
    expect(await screen.findByText('图表渲染失败，已显示源码')).toBeTruthy()
    expect(codeBlock('mermaid')).toBeTruthy()
    expect(mermaid.render).not.toHaveBeenCalled()
  })
})

describe('actions', () => {
  const block = {
    id: 'pick',
    prompt: '选哪个方案？',
    options: [{ label: 'A' }, { label: 'B', style: 'primary' }, { label: '放弃', style: 'danger' }],
  }
  const text = fence('actions', block)

  it('a click answers the block as me and shows who chose what', async () => {
    const answered = reply({
      body: text,
      actions: { pick: { userId: 'u1', name: '王磊', labels: ['B'], at: new Date().toISOString() } },
    })
    const calls = mockApi({ 'POST /messages/m1/actions': answered })
    inReply(text)
    expect(screen.getByText('选哪个方案？')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'B' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toMatchObject({ method: 'POST', body: { blockId: 'pick', options: [1] } })
  })

  it('an answered block is read-only and says who chose', () => {
    const m = reply({
      body: text,
      actions: { pick: { userId: 'u2', name: '李建国', labels: ['A'], at: new Date().toISOString() } },
    })
    inReply(text, m)
    expect(screen.getByText('李建国 已选择 A')).toBeTruthy()
    for (const name of ['A', 'B', '放弃'])
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('409 says someone answered first', async () => {
    mockApi({ 'POST /messages/m1/actions': apiError(409, 'conflict', '已作答') })
    inReply(text)
    fireEvent.click(screen.getByRole('button', { name: 'A' }))
    await waitFor(() => expect(useToasts.getState().items.map((i) => i.message)).toContain('已有人作答'))
  })

  it('multiple: picks several, then 提交 sends them', async () => {
    const multi = fence('actions', { ...block, multiple: true })
    const calls = mockApi({ 'POST /messages/m1/actions': reply({ body: multi }) })
    inReply(multi)
    const submit = screen.getByRole('button', { name: '提交' }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'A' }))
    fireEvent.click(screen.getByRole('button', { name: '放弃' }))
    expect(screen.getByRole('button', { name: 'A' }).getAttribute('aria-pressed')).toBe('true')
    expect(calls).toHaveLength(0)
    fireEvent.click(submit)
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]?.body).toEqual({ blockId: 'pick', options: [0, 2] })
  })

  it('outside a bot reply the buttons are read-only', () => {
    render(<Markdown text={text} />)
    expect((screen.getByRole('button', { name: 'A' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('falls back to the code block when invalid', () => {
    render(<Markdown text={fence('actions', { options: [] })} />)
    expect(codeBlock('actions')).toBeTruthy()
  })
})
