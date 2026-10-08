import type { GroupDto, MessageDto, RunDto } from '@gonggong/protocol'
import { beforeEach, expect, it } from 'vitest'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'

const g: GroupDto = {
  id: 'g1',
  teamId: 't1',
  name: 'A',
  kind: 'group',
  mode: 'partition',
  notice: '',
  noticeHidden: false,
  repo: null,
  members: [],
  botIds: [],
  unread: 0,
  lastSeq: 0,
  last: '',
  pinned: false,
  muted: false,
  foldRuns: false,
  liveRunIds: [],
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
      gitProtocol: 'auto',
      email: null,
      avatar: null,
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
    message: msg({ seq: 7, kind: 'event', authorId: null, body: '某 Bot 加入' }),
  })
  applyEvent({ t: 'message.new', message: msg({ seq: 8, groupId: 'g2' }) })
  const [g1, g2] = useWorkspace.getState().groups
  expect(g1).toMatchObject({ unread: 1, lastSeq: 7, last: '某 Bot 加入' })
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

it('keeps each group live runs in step with run updates', () => {
  useWorkspace.setState({
    groups: [
      { ...g, liveRunIds: ['r0'] },
      { ...g, id: 'g2' },
    ],
  })
  const { applyEvent } = useWorkspace.getState()
  const run = (id: string, status: RunDto['status']) => ({ id, groupId: 'g1', status }) as RunDto
  const live = () => useWorkspace.getState().groups.map((x) => x.liveRunIds)

  applyEvent({ t: 'run.updated', run: run('r1', 'queued') })
  expect(live()).toEqual([['r0'], []])
  applyEvent({ t: 'run.updated', run: run('r1', 'running') })
  applyEvent({ t: 'run.updated', run: run('r1', 'awaiting_approval') })
  expect(live()).toEqual([['r0', 'r1'], []])
  applyEvent({ t: 'run.updated', run: run('r0', 'completed') })
  applyEvent({ t: 'run.updated', run: run('r1', 'interrupted') })
  expect(live()).toEqual([[], []])
})

it("keeps another team's groups, bots and notifications out of the open team", () => {
  localStorage.setItem('gg.team', 't1')
  const apply = useWorkspace.getState().applyEvent
  apply({ t: 'group.updated', group: { ...g, id: 'g9', teamId: 't2' } })
  apply({
    t: 'notification.new',
    notification: {
      id: 'n1',
      teamId: 't2',
      type: 'chain_done',
      payload: {},
      readAt: null,
      resolvedAt: null,
      createdAt: '',
    },
  })
  apply({ t: 'group.updated', group: { ...g, id: 'g2' } })
  expect(useWorkspace.getState().groups.map((x) => x.id)).toEqual(['g2'])
  expect(useWorkspace.getState().notifCount).toBe(0)
  localStorage.removeItem('gg.team')
})
