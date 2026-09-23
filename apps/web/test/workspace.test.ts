import type { GroupDto } from '@aiws/protocol'
import { beforeEach, expect, it } from 'vitest'
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
}

beforeEach(() => useWorkspace.setState({ groups: [], bots: [], machines: [] }))

it('upserts groups from realtime events', () => {
  const { applyEvent } = useWorkspace.getState()
  applyEvent({ t: 'group.updated', group: g })
  applyEvent({ t: 'group.updated', group: { ...g, name: 'B' } })
  applyEvent({ t: 'run.delta', runId: 'r', text: 'x' })
  expect(useWorkspace.getState().groups).toEqual([{ ...g, name: 'B' }])
})
