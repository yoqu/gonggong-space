import type { GroupDto, MessageDto } from '@aiws/protocol'
import { beforeEach, expect, it } from 'vitest'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'

const g: GroupDto = {
  id: 'g1',
  name: 'A',
  kind: 'group',
  mode: 'partition',
  notice: '',
  repo: null,
  members: [],
  botIds: [],
  unread: 0,
  lastSeq: 0,
  last: '',
}

const msg = (o: Partial<MessageDto>): MessageDto => ({
  id: `m${o.seq}`,
  seq: 1,
  groupId: 'g1',
  kind: 'user',
  authorId: 'u2',
  authorName: '李建国',
  body: 'hi',
  mentions: [],
  runId: null,
  createdAt: new Date().toISOString(),
  attachments: [],
  quote: null,
  ...o,
})

beforeEach(() => {
  useWorkspace.setState({ groups: [], bots: [], machines: [], activeGroupId: null })
  useSession.setState({
    user: {
      id: 'u1',
      account: 'wl',
      name: '王磊',
      role: 'member',
      mustChangePassword: false,
      disabled: false,
    },
    status: 'ready',
  })
})

it('upserts groups from realtime events', () => {
  const { applyEvent } = useWorkspace.getState()
  applyEvent({ t: 'group.updated', group: g })
  applyEvent({ t: 'group.updated', group: { ...g, name: 'B' } })
  applyEvent({ t: 'run.delta', runId: 'r', text: 'x' })
  expect(useWorkspace.getState().groups).toEqual([{ ...g, name: 'B' }])
})

it('tracks unread and the last line from new messages', () => {
  useWorkspace.setState({ groups: [g, { ...g, id: 'g2' }] })
  const { applyEvent } = useWorkspace.getState()
  applyEvent({ t: 'message.new', message: msg({ seq: 5, body: '第一行\n第二行' }) })
  applyEvent({ t: 'message.new', message: msg({ seq: 6, authorId: 'u1', authorName: '王磊', body: '我的' }) })
  applyEvent({
    t: 'message.new',
    message: msg({ seq: 7, kind: 'event', authorId: null, body: '某 bot 加入' }),
  })
  applyEvent({ t: 'message.new', message: msg({ seq: 8, groupId: 'g2' }) })
  const [g1, g2] = useWorkspace.getState().groups
  expect(g1).toMatchObject({ unread: 1, lastSeq: 7, last: '某 bot 加入' })
  expect(g2).toMatchObject({ unread: 1, last: '李建国：hi' })

  useWorkspace.getState().setActiveGroup('g2')
  applyEvent({ t: 'message.new', message: msg({ seq: 9, groupId: 'g2', body: '看着呢' }) })
  expect(useWorkspace.getState().groups[1]).toMatchObject({ unread: 1, lastSeq: 9, last: '李建国：看着呢' })
})

it('ignores a replayed message and drops removed groups', () => {
  useWorkspace.setState({ groups: [{ ...g, lastSeq: 5 }] })
  const { applyEvent } = useWorkspace.getState()
  applyEvent({ t: 'message.new', message: msg({ seq: 5 }) })
  expect(useWorkspace.getState().groups[0]!.unread).toBe(0)
  applyEvent({ t: 'group.removed', groupId: 'g1' })
  expect(useWorkspace.getState().groups).toEqual([])
})
