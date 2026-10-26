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
  adminOnlyInvite: false,
  protectBase: false,
  notice: '',
  noticeHidden: false,
  avatar: null,
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
  liveRuns: [],
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
  applyEvent({ t: 'run.delta', runId: 'r', text: 'x', lastActivityAt: new Date().toISOString() })
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

it('flags a group whose unread message @s me', () => {
  useWorkspace.setState({ groups: [g, { ...g, id: 'g2' }], activeGroupId: 'g2' })
  const { applyEvent } = useWorkspace.getState()
  applyEvent({ t: 'message.new', message: msg({ seq: 2, userMentions: ['u3'] }) })
  expect(useWorkspace.getState().groups[0]?.mentioned).toBeFalsy()
  applyEvent({ t: 'message.new', message: msg({ seq: 3, userMentions: ['u1'] }) })
  applyEvent({ t: 'message.new', message: msg({ seq: 4, groupId: 'g2', userMentions: ['u1'] }) })
  const [g1, g2] = useWorkspace.getState().groups
  expect(g1?.mentioned).toBe(true)
  expect(g2?.mentioned).toBeFalsy()
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
  useSession.setState({ user: { id: 'me' } as never })
  useWorkspace.setState({
    bots: [
      { id: 'mine', ownerId: 'me' },
      { id: 'theirs', ownerId: 'u2' },
    ] as never,
    groups: [
      {
        ...g,
        liveRunIds: ['r0'],
        liveRuns: [{ id: 'r0', botId: 'mine', status: 'running', needsMe: false }],
      },
      { ...g, id: 'g2' },
    ],
  })
  const { applyEvent } = useWorkspace.getState()
  const run = (id: string, status: RunDto['status'], o: Partial<RunDto> = {}) =>
    ({
      id,
      groupId: 'g1',
      botId: 'mine',
      status,
      originUserId: 'u2',
      approvals: [],
      questions: [],
      ...o,
    }) as RunDto
  const live = () => useWorkspace.getState().groups.map((x) => x.liveRunIds)
  const runs = () =>
    useWorkspace.getState().groups.map((x) => x.liveRuns.map((r) => [r.id, r.status, r.needsMe]))

  applyEvent({ t: 'run.updated', run: run('r1', 'queued') })
  expect(live()).toEqual([['r0'], []])
  expect(runs()).toEqual([
    [
      ['r0', 'running', false],
      ['r1', 'queued', false],
    ],
    [],
  ])
  applyEvent({ t: 'run.updated', run: run('r1', 'running') })
  const pending = {
    status: 'pending',
    title: '执行命令',
    detail: 'rm -rf build',
  } as RunDto['approvals'][number]
  applyEvent({ t: 'run.updated', run: run('r1', 'awaiting_approval', { approvals: [pending] }) })
  expect(live()).toEqual([['r0', 'r1'], []])
  expect(useWorkspace.getState().groups[0]!.liveRuns[1]).toEqual({
    id: 'r1',
    botId: 'mine',
    status: 'awaiting_approval',
    needsMe: true,
    title: 'rm -rf build',
  })
  applyEvent({
    t: 'run.updated',
    run: run('r2', 'awaiting_approval', { botId: 'theirs', approvals: [pending] }),
  })
  expect(useWorkspace.getState().groups[0]!.liveRuns[2]?.needsMe).toBe(false)
  applyEvent({ t: 'run.updated', run: run('r0', 'completed') })
  applyEvent({ t: 'run.updated', run: run('r1', 'interrupted') })
  applyEvent({ t: 'run.updated', run: run('r2', 'completed', { botId: 'theirs' }) })
  expect(live()).toEqual([[], []])
  expect(runs()).toEqual([[], []])
})

it('keeps the same groups array when an event changes nothing the list shows', () => {
  useSession.setState({ user: { id: 'me' } as never })
  useWorkspace.setState({
    bots: [{ id: 'mine', ownerId: 'me' }] as never,
    groups: [
      {
        ...g,
        lastSeq: 5,
        liveRunIds: ['r1'],
        liveRuns: [{ id: 'r1', botId: 'mine', status: 'running', needsMe: false }],
      },
      { ...g, id: 'd1', kind: 'dm', botIds: ['mine'], workspacePath: '/w' },
    ],
  })
  const before = useWorkspace.getState().groups
  const { applyEvent } = useWorkspace.getState()
  const run = {
    id: 'r1',
    groupId: 'g1',
    botId: 'mine',
    status: 'running',
    step: '读取 a.ts',
    usage: { totalTokens: 10 },
    originUserId: 'u2',
    approvals: [],
    questions: [],
  } as unknown as RunDto
  const botState = (groupId: string, path: string) =>
    ({ t: 'group.botState', groupId, state: { botId: 'mine', path } }) as never

  applyEvent({ t: 'run.updated', run: { ...run, step: '编辑 a.ts', usage: { totalTokens: 900 } } })
  applyEvent({ t: 'run.updated', run: { ...run, id: 'r9', groupId: 'g9' } })
  applyEvent({ t: 'run.updated', run: { ...run, id: 'r8', status: 'completed' } })
  applyEvent({ t: 'message.new', message: msg({ seq: 5 }) })
  applyEvent({ t: 'message.new', message: msg({ seq: 1, groupId: 'g9' }) })
  applyEvent(botState('d1', '/w'))
  applyEvent(botState('g1', '/elsewhere'))
  expect(useWorkspace.getState().groups).toBe(before)

  applyEvent({
    t: 'run.updated',
    run: {
      ...run,
      status: 'awaiting_answer',
      questions: [{ status: 'pending', questions: [{ title: '用哪个分支？' }] }],
    } as unknown as RunDto,
  })
  const after = useWorkspace.getState().groups
  expect(after).not.toBe(before)
  expect(after[0]!.liveRuns[0]).toMatchObject({ status: 'awaiting_answer', title: '用哪个分支？' })
  expect(after[1]).toBe(before[1])
  applyEvent(botState('d1', '/v'))
  expect(useWorkspace.getState().groups[1]!.workspacePath).toBe('/v')
  expect(useWorkspace.getState().groups[0]).toBe(after[0])
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
