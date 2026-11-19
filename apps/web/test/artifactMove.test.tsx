import type { ArtifactDto, GroupDto, UserDto } from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { useWorkbench } from '../src/app/workbench'
import { useWorkspace } from '../src/app/workspace'
import { ArtifactTab } from '../src/features/artifacts/ArtifactTab'
import { resetArtifacts } from '../src/features/artifacts/store'
import { realtime } from '../src/lib/realtime'
import { mockApi } from './mockApi'

const at = '2026-11-19T10:00:00Z'
const me = { id: 'u1', name: '王磊' } as UserDto
const group = (id: string, name: string, kind: GroupDto['kind'] = 'group') =>
  ({ id, name, kind, members: [], botIds: [] }) as unknown as GroupDto
const artifact = (o: Partial<ArtifactDto> = {}): ArtifactDto => ({
  id: 'a1',
  favorites: [],
  botId: null,
  groupId: 'g1',
  title: '读书会小程序',
  dir: 'design/app-ab12',
  pluginId: null,
  pluginVersionId: null,
  designSystemId: null,
  headVersionId: null,
  head: null,
  createdAt: at,
  updatedAt: at,
  archivedAt: null,
  running: false,
  queued: false,
  queuedRunCount: 0,
  visibility: 'group',
  createdBy: 'u1',
  ...o,
})

function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>
}

const renderTab = async () => {
  render(
    <MemoryRouter initialEntries={['/g/g1']}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <ArtifactTab
                tab={{ kind: 'artifact', artifactId: 'a1', title: '' }}
                tabKey="artifact:a1"
                active
              />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
  await screen.findByRole('heading', { name: '读书会小程序' })
}
const menu = () => {
  fireEvent.click(screen.getByRole('button', { name: '产物菜单' }))
  return screen.getByRole('menu')
}

class NoopSocket {
  close() {}
}
beforeEach(() => {
  localStorage.clear()
  resetArtifacts()
  vi.stubGlobal('WebSocket', NoopSocket)
  vi.spyOn(realtime, 'subscribe').mockImplementation(() => () => {})
  useSession.setState({ user: me, status: 'ready' })
  useWorkspace.setState({
    groups: [group('g1', '设计群'), group('g2', '产品群'), group('d1', '私聊', 'dm')],
    bots: [],
  })
  useWorkbench.setState({ groupId: 'g1', open: false, mode: 'split', previous: 'split', benches: {} })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('移动到群', () => {
  it('is offered to managers only', async () => {
    mockApi({ 'GET /artifacts/a1': artifact({ createdBy: 'u2' }), 'GET /artifacts/a1/versions': [] })
    await renderTab()
    expect(within(menu()).queryByRole('menuitem', { name: /移动到群/ })).toBeNull()
  })

  it('moves the artifact to a picked group of the caller, then goes there', async () => {
    const calls = mockApi({
      'GET /artifacts/a1': artifact(),
      'GET /artifacts/a1/versions': [],
      'POST /artifacts/a1/move': artifact({ groupId: 'g2' }),
    })
    useWorkbench.getState().show({ kind: 'artifact', artifactId: 'a1', title: '' })
    await renderTab()
    fireEvent.click(within(menu()).getByRole('menuitem', { name: /移动到群/ }))
    const dialog = await screen.findByRole('dialog', { name: '移动「读书会小程序」到群' })
    const move = within(dialog).getByRole('button', { name: '移动' }) as HTMLButtonElement
    expect(move.disabled).toBe(true)
    fireEvent.click(within(dialog).getByRole('button', { name: '目标群' }))
    // Neither the artifact's own group nor a DM.
    const picks = screen.getAllByRole('menuitemcheckbox').map((o) => o.textContent)
    expect(picks).toEqual(['产品群'])
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '产品群' }))
    fireEvent.click(move)
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/g/g2'))
    expect(calls.find((c) => c.path === '/artifacts/a1/move')?.body).toEqual({ groupId: 'g2' })
    expect(useWorkbench.getState().benches.g1?.tabs).toEqual([])
  })
})
