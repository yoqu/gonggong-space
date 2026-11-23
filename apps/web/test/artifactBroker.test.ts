import type { ArtifactThreadDto } from '@gonggong/protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type BrokerOptions, createArtifactBroker } from '../src/features/artifacts/shell/broker'
import { mockApi } from './mockApi'

const ORIGIN = 'https://a1.preview.test'

function makeFakeFrame() {
  const sent: { msg: unknown; origin: string }[] = []
  const win = {
    postMessage: (msg: unknown, origin: string) => sent.push({ msg, origin }),
  } as unknown as Window
  return { win, sent }
}

function dispatch(
  broker: ReturnType<typeof createArtifactBroker>,
  source: Window,
  origin: string,
  data: unknown,
) {
  broker.onMessage({ origin, source, data } as unknown as MessageEvent)
}

function makeBroker(overrides: Partial<BrokerOptions> = {}) {
  const frame = makeFakeFrame()
  const onStageAgent = vi.fn()
  const onViewContext = vi.fn()
  const onReport = vi.fn()
  const onDownload = vi.fn()
  const broker = createArtifactBroker({
    artifactId: 'a1',
    getTitle: () => 'S0 演示文稿',
    getVersionId: () => 'v1',
    getOrigin: () => ORIGIN,
    getFrameWindow: () => frame.win,
    viewer: { id: 'u1', name: '李建国', role: 'editor', kind: 'user' },
    readOnly: false,
    getAgentStatus: () => ({ available: true, busy: false, name: '小王的 Claude' }),
    getBotId: () => 'b1',
    onStageAgent,
    onViewContext,
    onChrome: { onReport },
    onDownload,
    ...overrides,
  })
  return { broker, frame, onStageAgent, onViewContext, onReport, onDownload }
}

async function flush() {
  await new Promise((r) => setTimeout(r, 0))
  await new Promise((r) => setTimeout(r, 0))
}

afterEach(() => vi.unstubAllGlobals())

describe('artifact capability broker', () => {
  it('ignores messages from wrong origin or wrong window, and answers every cap_want with cap_grant', () => {
    const { broker, frame } = makeBroker()
    const otherWin = {} as Window
    dispatch(broker, frame.win, 'https://evil.test', {
      openArtifact: 'cap_want',
      cap: 'artifact',
      protocol: 1,
      base: ORIGIN,
    })
    dispatch(broker, otherWin, ORIGIN, {
      openArtifact: 'cap_want',
      cap: 'artifact',
      protocol: 1,
      base: ORIGIN,
    })
    expect(frame.sent).toEqual([])

    for (const cap of [
      'user',
      'artifact',
      'assets',
      'agent',
      'room',
      'downloads',
      'comments',
      'history',
      'db',
      'mcp',
    ]) {
      dispatch(broker, frame.win, ORIGIN, { openArtifact: 'cap_want', cap, protocol: 1, base: ORIGIN })
    }
    const grants = frame.sent.map(
      (x) => x.msg as { openArtifact: string; cap: string; ok: boolean; config?: unknown },
    )
    expect(grants.filter((g) => g.ok).map((g) => g.cap)).toEqual([
      'user',
      'artifact',
      'assets',
      'agent',
      'room',
      'downloads',
      'comments',
      'history',
    ])
    expect(grants.filter((g) => !g.ok).map((g) => g.cap)).toEqual(['db', 'mcp'])
    expect(grants.find((g) => g.cap === 'downloads')?.config).toEqual({ browser: true })
    expect(grants.find((g) => g.cap === 'artifact')?.config).toEqual({ id: 'a1' })
    expect(grants.find((g) => g.cap === 'user')?.config).toMatchObject({ me: { id: 'u1', role: 'editor' } })
  })

  it('grants only read-only artifact, viewer user and downloads in readOnly/guest mode and refuses writes', async () => {
    const { broker, frame } = makeBroker({
      readOnly: true,
      viewer: { id: 'guest', name: 'Guest', role: 'viewer', kind: 'guest' },
    })
    for (const cap of ['user', 'artifact', 'assets', 'agent', 'room', 'downloads', 'comments', 'history']) {
      dispatch(broker, frame.win, ORIGIN, { openArtifact: 'cap_want', cap, protocol: 1, base: ORIGIN })
    }
    const grants = frame.sent.map((x) => x.msg as { cap: string; ok: boolean; config?: unknown })
    expect(grants.filter((g) => g.ok).map((g) => g.cap)).toEqual(['user', 'artifact', 'downloads'])
    expect(grants.filter((g) => !g.ok).map((g) => g.cap)).toEqual([
      'assets',
      'agent',
      'room',
      'comments',
      'history',
    ])

    frame.sent.length = 0
    dispatch(broker, frame.win, ORIGIN, {
      openArtifact: 'cap',
      id: 'c1',
      cap: 'artifact',
      method: 'publish',
      args: [{ 'project/deck.json': { content: '{}' } }],
      gen: 0,
    })
    dispatch(broker, frame.win, ORIGIN, {
      openArtifact: 'cap',
      id: 'c2',
      cap: 'assets',
      method: 'upload',
      args: [new Blob(['x'], { type: 'image/png' })],
      gen: 0,
    })
    await flush()
    expect(frame.sent.map((x) => x.msg)).toEqual(
      expect.arrayContaining([
        { openArtifact: 'cap_r', id: 'c1', error: { code: 'not_writer', message: 'Read-only view' } },
        { openArtifact: 'cap_r', id: 'c2', error: { code: 'not_granted', message: 'assets is not granted' } },
      ]),
    )
  })

  it('proxies artifact list/readText/publish (including 409 conflict paths), comments, history, agent, room, downloads and suppresses self-echo', async () => {
    const rawThread: ArtifactThreadDto = {
      id: 'th1',
      artifactId: 'a1',
      versionId: 'v1',
      anchor: '{"slide":"s1"}',
      label: 'Slide 1',
      detail: 'Title',
      location: { slide: 's1' },
      status: 'open',
      resolvedBy: null,
      resolvedByName: null,
      sentMessageId: null,
      createdBy: 'u1',
      createdByName: '李建国',
      createdAt: '2026-11-23T00:00:00.000Z',
      messages: [
        {
          id: 'm1',
          authorKind: 'user',
          authorId: 'u1',
          authorName: '李建国',
          text: '放大标题',
          to: [],
          reactions: [],
          at: '2026-11-23T00:00:00.000Z',
          editedAt: null,
        },
      ],
    }

    const calls = mockApi({
      'GET /artifacts/a1/versions/v1': {
        id: 'v1',
        artifactId: 'a1',
        n: 1,
        files: [{ path: 'project/deck.json', hash: 'a'.repeat(64), size: 12 }],
      },
      'GET /artifacts/a1/files/project/deck.json': '{"slides":[]}',
      'POST /artifacts/a1/publish': () =>
        new Response(
          JSON.stringify({
            error: 'conflict',
            message: '文件已被其他人修改',
            paths: [{ path: 'project/deck.json', expected: 'old', actual: 'new' }],
          }),
          { status: 409 },
        ),
      'GET /artifacts/a1/threads': [rawThread],
      'POST /artifacts/a1/agent-send': { status: 'delivered', messageId: 'msg1' },
      'GET /artifacts/a1/versions/history': {
        versions: [
          {
            id: 'v1',
            n: 1,
            first: '2026-11-23T00:00:00.000Z',
            at: '2026-11-23T00:00:00.000Z',
            author: { kind: 'person', id: 'u1', name: '李建国' },
            files: [{ path: 'project/deck.json', op: 'added' }],
            current: true,
          },
        ],
        notices: [],
        canRestore: true,
      },
      'POST /artifacts/a1/versions/v1/restore-files': { version: 2, changed: ['project/deck.json'] },
    })

    const { broker, frame, onStageAgent, onViewContext, onReport, onDownload } = makeBroker()
    for (const cap of ['artifact', 'comments', 'history', 'agent', 'room', 'downloads']) {
      dispatch(broker, frame.win, ORIGIN, { openArtifact: 'cap_want', cap, protocol: 1, base: ORIGIN })
    }
    frame.sent.length = 0

    // artifact.list, publish conflict, comments.list, room.presence, agent.send (stage + send), history.list/restore, downloads.save
    dispatch(broker, frame.win, ORIGIN, {
      openArtifact: 'cap',
      id: '1',
      cap: 'artifact',
      method: 'list',
      args: [],
      gen: 0,
    })
    dispatch(broker, frame.win, ORIGIN, {
      openArtifact: 'cap',
      id: '2',
      cap: 'artifact',
      method: 'publish',
      args: [{ 'project/deck.json': { content: '{}', ifMatch: 'old' } }],
      gen: 0,
    })
    dispatch(broker, frame.win, ORIGIN, {
      openArtifact: 'cap',
      id: '3',
      cap: 'comments',
      method: 'list',
      args: [],
      gen: 0,
    })
    dispatch(broker, frame.win, ORIGIN, {
      openArtifact: 'cap',
      id: '4',
      cap: 'room',
      method: 'presence',
      args: [{ viewContext: { slideId: 's1' } }],
      gen: 0,
    })
    dispatch(broker, frame.win, ORIGIN, {
      openArtifact: 'cap',
      id: '5',
      cap: 'agent',
      method: 'send',
      args: [{ text: '改标题' }, { deliver: 'stage' }],
      gen: 0,
    })
    dispatch(broker, frame.win, ORIGIN, {
      openArtifact: 'cap',
      id: '6',
      cap: 'agent',
      method: 'send',
      args: [{ text: '直接改标题' }, { deliver: 'send' }],
      gen: 0,
    })
    dispatch(broker, frame.win, ORIGIN, {
      openArtifact: 'cap',
      id: '7',
      cap: 'history',
      method: 'list',
      args: [],
      gen: 0,
    })
    dispatch(broker, frame.win, ORIGIN, {
      openArtifact: 'cap',
      id: '8',
      cap: 'downloads',
      method: 'save',
      args: [{ name: 'deck.pptx', data: new Blob(['pptx']) }],
      gen: 0,
    })
    await flush()
    dispatch(broker, frame.win, ORIGIN, {
      openArtifact: 'cap',
      id: '9',
      cap: 'history',
      method: 'restore',
      args: [1, ['project/deck.json']],
      gen: 0,
    })
    await flush()

    const byId = new Map(
      frame.sent.map((x) => {
        const m = x.msg as { id: string; result?: unknown; error?: unknown }
        return [m.id, m]
      }),
    )
    expect(byId.get('1')?.result).toEqual({ 'project/deck.json': { sha256: 'a'.repeat(64), size: 12 } })
    expect(byId.get('2')?.error).toMatchObject({
      code: 'conflict',
      paths: [{ path: 'project/deck.json', expected: 'old', actual: 'new' }],
    })
    expect(byId.get('3')?.result).toEqual([
      expect.objectContaining({ id: 'th1', anchor: '{"slide":"s1"}', label: 'Slide 1', status: 'open' }),
    ])
    expect(onViewContext).toHaveBeenCalledWith({ slideId: 's1' })
    expect(byId.get('5')?.result).toEqual({ status: 'staged' })
    expect(onStageAgent).toHaveBeenCalledWith({ text: '改标题', title: undefined, context: undefined })
    expect(byId.get('6')?.result).toEqual({ status: 'delivered' })
    expect(calls.find((c) => c.path === '/artifacts/a1/agent-send')?.body).toMatchObject({
      text: '直接改标题',
      context: { view: { slideId: 's1' } },
      botId: 'b1',
    })
    expect(byId.get('7')?.result).toMatchObject({ canRestore: true, versions: [{ n: 1, current: true }] })
    expect(onDownload).toHaveBeenCalledWith({ name: 'deck.pptx', data: expect.any(Blob) })
    expect(byId.get('9')?.result).toEqual({ version: 2, changed: ['project/deck.json'] })

    // Suppress self-echo, forward external file changes and chrome reports
    frame.sent.length = 0
    broker.pushFiles({
      t: 'artifact.files',
      artifactId: 'a1',
      versionId: 'v2',
      n: 2,
      changes: { 'project/deck.json': 'b'.repeat(64) },
      clientId: broker.clientId,
    })
    expect(frame.sent).toEqual([])
    broker.pushFiles({
      t: 'artifact.files',
      artifactId: 'a1',
      versionId: 'v3',
      n: 3,
      changes: { 'project/deck.json': 'c'.repeat(64) },
      author: 'agent',
    })
    expect(frame.sent.map((x) => x.msg)).toEqual([
      {
        openArtifact: 'cap_ev',
        cap: 'artifact',
        event: 'files',
        data: { changes: { 'project/deck.json': 'c'.repeat(64) }, author: 'agent' },
      },
      { openArtifact: 'cap_ev', cap: 'history', event: 'change', data: { n: 3 } },
    ])

    // chrome_report handled
    dispatch(broker, frame.win, ORIGIN, {
      openArtifact: 'chrome_report',
      protocol: 1,
      report: { saved: 'saved' },
    })
    expect(onReport).toHaveBeenCalledWith({ saved: 'saved' })
  })
})
