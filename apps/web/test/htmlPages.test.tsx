import type { HtmlRenderRef, MessageDto, RunDto } from '@gonggong/protocol'
import { render as renderBare, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { BotReply, RunCard } from '../src/features/chat/TimelineItems'

const render = (ui: ReactElement) => renderBare(<MemoryRouter>{ui}</MemoryRouter>)

const page = (attachmentId: string, title: string): HtmlRenderRef => ({ attachmentId, title, height: 300 })
const placed = (id: string) => `\`\`\`html-page\n{"id":"${id}"}\n\`\`\``

const reply = (o: Partial<MessageDto>): MessageDto => ({
  id: 'm1',
  seq: 1,
  groupId: 'g1',
  kind: 'bot',
  authorId: 'b1',
  authorName: '小助手',
  body: '',
  mentions: [],
  runId: null,
  createdAt: '2026-09-29T08:00:00Z',
  attachments: [],
  quote: null,
  reactions: [],
  ...o,
})

const run = (o: Partial<RunDto> = {}): RunDto => ({
  id: 'r1',
  groupId: 'g1',
  botId: 'b1',
  triggerMessageId: 'm0',
  triggerUserId: 'u1',
  hop: 1,
  status: 'running',
  step: '画图',
  filesChanged: 0,
  usage: null,
  newSessionReason: null,
  parentRunId: null,
  hopMax: 5,
  offlineWaitMin: 30,
  originUserId: 'u1',
  approvals: [],
  questions: [],
  interrupt: null,
  stoppedBy: null,
  delegation: { subagents: 0, subagentsRunning: 0, tasksRunning: 0 },
  model: null,
  effort: null,
  queuedAt: '2026-09-29T08:00:00Z',
  startedAt: '2026-09-29T08:00:00Z',
  endedAt: null,
  lastActivityAt: '2026-09-29T08:00:00Z',
  ...o,
})

const precedes = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

describe('html_render pages in the final reply', () => {
  it('shows a page where the reply places it and the unplaced ones after the text; other ids show nothing', () => {
    render(
      <BotReply
        m={reply({
          body: `先看乙\n\n${placed('p2')}\n\n${placed('other-run')}\n\n结论在此`,
          htmlRenders: [page('p1', '甲'), page('p2', '乙')],
        })}
      />,
    )
    const [first, second] = [screen.getByTitle('乙'), screen.getByTitle('甲')]
    const intro = screen.getByText('先看乙')
    const outro = screen.getByText('结论在此')
    expect(precedes(intro, first) && precedes(first, outro)).toBe(true)
    expect(precedes(outro, second)).toBe(true)
    expect(document.querySelectorAll('iframe')).toHaveLength(2)
    expect(screen.queryByText('html-page')).toBeNull()
  })

  it('shows pages of a reply that has no text', () => {
    render(<BotReply m={reply({ htmlRenders: [page('p1', '甲')] })} />)
    expect(screen.getByTitle('甲').tagName).toBe('IFRAME')
  })

  it('still shows a page posted as its own message', () => {
    render(<BotReply m={reply({ body: '甲', htmlRender: page('p1', '甲') })} />)
    expect(screen.getByTitle('甲').tagName).toBe('IFRAME')
  })

  it('shows the pages published so far on the card of a working run', () => {
    render(
      <RunCard
        run={run({ htmlRenders: [page('p1', '甲')] })}
        botName="小助手"
        agent="Claude"
        trigger="王磊"
      />,
    )
    expect(screen.getByTestId('run-card').querySelector('iframe')?.title).toBe('甲')
  })
})
