import type { ArtifactDto, ArtifactThreadDto, BotDto, UserDto } from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { useWorkbench } from '../src/app/workbench'
import { useWorkspace } from '../src/app/workspace'
import { ArtifactTab } from '../src/features/artifacts/ArtifactTab'
import { resetArtifacts } from '../src/features/artifacts/store'
import { realtime } from '../src/lib/realtime'
import { ORIGIN, versionAt } from './artifactFixtures'
import { mockApi } from './mockApi'

const at = '2026-11-23T02:00:00Z'
const version = versionAt(at)
const me = { id: 'u1', name: '李建国', role: 'member' } as UserDto
const bot = { id: 'b1', name: '前端助手', online: true, groupIds: ['g1'] } as unknown as BotDto

const siteArtifact = (o: Partial<ArtifactDto> = {}): ArtifactDto => ({
  id: 'site1',
  groupId: 'g1',
  title: '官网落地页',
  dir: 'design/site-ab12',
  pluginId: null,
  pluginVersionId: null,
  designSystemId: null,
  headVersionId: 'v2',
  head: { ...version(2), source: 'host' },
  manifest: null,
  createdAt: at,
  updatedAt: at,
  archivedAt: null,
  running: false,
  queued: false,
  queuedRunCount: 0,
  favorites: [],
  botId: 'b1',
  visibility: 'group',
  createdBy: 'u1',
  site: true,
  kind: 'site',
  access: 'edit',
  ...o,
})

class NoopSocket {
  close() {}
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('gg.locale', 'zh')
  resetArtifacts()
  vi.stubGlobal('WebSocket', NoopSocket)
  vi.spyOn(realtime, 'subscribe').mockImplementation(() => () => {})
  useSession.setState({ user: me, tenancy: null, status: 'ready' })
  useWorkspace.setState({
    groups: [{ id: 'g1', name: '设计群', kind: 'group', botIds: ['b1'], members: [] } as never],
    bots: [bot],
  })
  useWorkbench.setState({ groupId: 'g1', open: false, mode: 'split', previous: 'split', benches: {} })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('ArtifactShell for hosted sites', () => {
  it('places coordinate annotations on the site stage, sends them to a bot, and restores an older version', async () => {
    const madeThread: ArtifactThreadDto = {
      id: 'th-1',
      artifactId: 'site1',
      versionId: 'v2',
      anchor: { kind: 'site', path: '/', point: { x: 120, y: 80 } },
      label: '/ (120, 80)',
      detail: null,
      location: { path: '/', x: 120, y: 80 },
      status: 'open',
      resolvedBy: null,
      resolvedByName: null,
      sentMessageId: null,
      createdBy: 'u1',
      createdByName: '李建国',
      createdAt: at,
      messages: [
        {
          id: 'm1',
          authorKind: 'user',
          authorId: 'u1',
          authorName: '李建国',
          text: '主标题字体加大',
          to: [],
          reactions: [],
          at,
          editedAt: null,
        },
      ],
    }

    const calls = mockApi({
      'GET /artifacts/site1': siteArtifact(),
      'GET /artifacts/site1/versions': [
        { ...version(1), source: 'host' },
        { ...version(2), source: 'host' },
      ],
      'POST /artifacts/site1/preview': { previewId: 'pv1', origin: ORIGIN, url: '/api/previews/pv1/open' },
      'GET /artifacts/site1/threads': [],
      'GET /groups/g1/bots': [bot],
      'POST /artifacts/site1/threads': madeThread,
      'POST /artifacts/site1/threads/send': { id: 'msg-1', body: '@前端助手 按 1 条批注修改' },
      'POST /artifacts/site1/chat': { rootId: 'chat-root' },
      'POST /artifacts/site1/versions/v1/restore': siteArtifact({ headVersionId: 'v1' }),
    })

    render(
      <ArtifactTab
        tab={{ kind: 'artifact', artifactId: 'site1', title: '官网落地页' }}
        tabKey="artifact:site1"
        active
      />,
    )

    // Renders inside unified ArtifactShell (not Prototype Canvas)
    expect(await screen.findByTestId('artifact-shell')).toBeTruthy()
    expect(await screen.findByTestId('shell-site-stage')).toBeTruthy()

    // Toggle coordinate annotation mode and place a pin on the site overlay
    fireEvent.click(screen.getByTestId('shell-annotate-btn'))
    const overlay = screen.getByTestId('shell-site-overlay')
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 800,
      height: 600,
      right: 800,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => {},
    })
    fireEvent.click(overlay, { clientX: 120, clientY: 80 })
    const pop = screen.getByTestId('shell-site-pin-popover')
    fireEvent.change(within(pop).getByPlaceholderText('写下对这处页面的修改意见…'), {
      target: { value: '主标题字体加大' },
    })
    fireEvent.click(within(pop).getByRole('button', { name: '提交批注' }))

    // Thread created with site anchor + pin appears + sidebar shows it
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.path === '/artifacts/site1/threads')).toBe(true),
    )
    expect(
      calls.find((c) => c.method === 'POST' && c.path === '/artifacts/site1/threads')?.body,
    ).toMatchObject({
      versionId: 'v2',
      anchor: { kind: 'site', path: '/', point: { x: 120, y: 80 } },
      text: '主标题字体加大',
    })
    expect(await screen.findByTestId('shell-pin-1')).toBeTruthy()
    expect(await screen.findByTestId('shell-thread-1')).toBeTruthy()

    // Send thread to Bot
    fireEvent.click(screen.getByRole('button', { name: /发给 @前端助手/ }))
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.path === '/artifacts/site1/threads/send')).toBe(true),
    )

    // Open Version History sidebar and restore v1
    fireEvent.click(screen.getByTestId('shell-history-btn'))
    const v1Row = await screen.findByTestId('shell-version-v1')
    fireEvent.click(within(v1Row).getByRole('button', { name: '设为当前版本' }))
    await waitFor(() =>
      expect(
        calls.some((c) => c.method === 'POST' && c.path === '/artifacts/site1/versions/v1/restore'),
      ).toBe(true),
    )
  })

  it('hides write controls in read-only (access=view) mode', async () => {
    mockApi({
      'GET /artifacts/site1': siteArtifact({ access: 'view' }),
      'GET /artifacts/site1/versions': [{ ...version(2), source: 'host' }],
      'POST /artifacts/site1/preview': { previewId: 'pv1', origin: ORIGIN, url: '/api/previews/pv1/open' },
      'GET /artifacts/site1/threads': [],
      'GET /groups/g1/bots': [],
    })

    render(
      <ArtifactTab
        tab={{ kind: 'artifact', artifactId: 'site1', title: '官网落地页' }}
        tabKey="artifact:site1"
        active
      />,
    )

    expect(await screen.findByTestId('artifact-shell')).toBeTruthy()
    expect(screen.queryByTestId('shell-annotate-btn')).toBeNull()
    expect(screen.queryByTestId('shell-chat-btn')).toBeNull()
    expect(screen.queryByRole('button', { name: '分享' })).toBeNull()
  })

  it('keeps editor comments of earlier versions listed: every save makes a new version', async () => {
    const th = {
      id: 'th-s',
      artifactId: 'site1',
      versionId: 'v1',
      anchor: '{"slide":"s1"}',
      label: 'Slide 1',
      detail: null,
      location: {},
      status: 'open',
      resolvedBy: null,
      resolvedByName: null,
      sentMessageId: null,
      createdBy: 'u1',
      createdByName: '李建国',
      createdAt: at,
      messages: [
        {
          id: 'm1',
          authorKind: 'user',
          authorId: 'u1',
          authorName: '李建国',
          text: '标题再短些',
          to: [],
          reactions: [],
          at,
          editedAt: null,
        },
      ],
    } as ArtifactThreadDto
    mockApi({
      'GET /artifacts/site1': siteArtifact({ kind: 'slides', site: false, editorVersion: 'current' }),
      'GET /artifacts/site1/versions': [version(1), version(2)],
      'POST /artifacts/site1/preview': { previewId: 'pv1', origin: ORIGIN, url: '/api/previews/pv1/open' },
      'GET /artifacts/site1/threads': [th],
      'GET /groups/g1/bots': [bot],
    })
    render(
      <ArtifactTab
        tab={{ kind: 'artifact', artifactId: 'site1', title: '官网落地页' }}
        tabKey="artifact:site1"
        active
      />,
    )
    fireEvent.click(await screen.findByTestId('shell-threads-btn'))
    expect(await screen.findByText('标题再短些')).toBeTruthy()
  })

  it('stays on the head while the editor has unsaved edits', async () => {
    mockApi({
      'GET /artifacts/site1': siteArtifact({ kind: 'slides', site: false, editorVersion: 'current' }),
      'GET /artifacts/site1/versions': [version(1), version(2)],
      'POST /artifacts/site1/preview': { previewId: 'pv1', origin: ORIGIN, url: '/api/previews/pv1/open' },
      'GET /artifacts/site1/threads': [],
      'GET /groups/g1/bots': [bot],
    })
    render(
      <ArtifactTab
        tab={{ kind: 'artifact', artifactId: 'site1', title: '官网落地页' }}
        tabKey="artifact:site1"
        active
      />,
    )
    const frame = (await screen.findByTestId('shell-editor-stage')).querySelector('iframe')!
    const report = (leaveLosesWork: boolean) =>
      act(() => {
        window.dispatchEvent(
          new MessageEvent('message', {
            origin: ORIGIN,
            source: frame.contentWindow,
            data: {
              openArtifact: 'chrome_report',
              report: { saved: leaveLosesWork ? 'unsaved' : 'saved', leaveLosesWork },
            },
          }),
        )
      })
    report(true)
    fireEvent.click(screen.getByTestId('shell-history-btn'))
    const v1 = () => within(screen.getByTestId('shell-version-v1')).getAllByRole('button')[0]!
    await screen.findByTestId('shell-version-v1')
    fireEvent.click(v1())
    expect(screen.queryByTestId('shell-past-banner')).toBeNull()
    report(false)
    fireEvent.click(v1())
    expect(await screen.findByTestId('shell-past-banner')).toBeTruthy()
  })
})
