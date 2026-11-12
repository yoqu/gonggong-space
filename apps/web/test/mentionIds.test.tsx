import type { GroupDto, MessageDto } from '@gonggong/protocol'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { useWorkspace } from '../src/app/workspace'
import { MentionNames } from '../src/features/chat/Markdown'
import { BotReply, UserMessage } from '../src/features/chat/TimelineItems'

const m = (o: Partial<MessageDto>): MessageDto => ({
  id: 'm1',
  seq: 1,
  groupId: 'g1',
  kind: 'user',
  authorId: 'u9',
  authorName: '李建国',
  body: '',
  mentions: [],
  userMentions: [],
  runId: null,
  createdAt: '2026-09-24T08:00:00Z',
  attachments: [],
  quote: null,
  reactions: [],
  ...o,
})

const targets = [
  { id: 'b1', name: '小王的 Claude' },
  { id: 'u2', name: '共字' },
  { id: 'u3', name: '张三' },
]
const spans = () => [...document.querySelectorAll('.pn-mention')].map((e) => [e.textContent, e.className])

afterEach(() => useWorkspace.setState({ groups: [] }))

describe('user message mentions by target id', () => {
  it('does not highlight a deleted bot as the member whose name is its prefix', () => {
    render(
      <MemoryRouter>
        <UserMessage m={m({ body: '@共字君 看下', mentions: ['b-gone'] })} targets={targets} />
      </MemoryRouter>,
    )
    expect(spans()).toEqual([])
    expect(document.body.textContent).toContain('@共字君 看下')
  })

  it('highlights only the targets the message @-ed, and me by id', () => {
    render(
      <MemoryRouter>
        <UserMessage
          m={m({ body: '@小王的 Claude @共字 看下，@张三 不算', mentions: ['b1'], userMentions: ['u2'] })}
          targets={targets}
          meId="u2"
        />
      </MemoryRouter>,
    )
    expect(spans()).toEqual([
      ['@小王的 Claude', 'pn-mention'],
      ['@共字', 'pn-mention pn-mention--me'],
    ])
  })
})

describe('bot reply mentions by target id', () => {
  it('highlights only members the reply @-ed', () => {
    useWorkspace.setState({
      groups: [
        {
          id: 'g1',
          botIds: [],
          members: [
            { userId: 'u2', name: '共字', avatar: null, isAdmin: false },
            { userId: 'u3', name: '张三', avatar: null, isAdmin: false },
          ],
        } as unknown as GroupDto,
      ],
    })
    render(
      <MemoryRouter>
        <MentionNames.Provider value={{ members: ['共字', '张三'], bots: [], me: '张三' }}>
          <BotReply
            m={m({
              kind: 'bot',
              authorId: 'b1',
              authorName: '小王的 Claude',
              body: '@共字君 @张三 好了',
              userMentions: ['u3'],
            })}
          />
        </MentionNames.Provider>
      </MemoryRouter>,
    )
    expect(spans()).toEqual([['@张三', 'pn-mention pn-mention--me']])
  })
})
