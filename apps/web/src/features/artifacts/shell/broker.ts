import {
  type ArtifactAgentSendRes,
  type ArtifactAssetRes,
  type ArtifactHistoryDiffRes,
  type ArtifactHistoryListRes,
  type ArtifactPublishReq,
  type ArtifactPublishRes,
  type ArtifactRestoreFilesRes,
  type ArtifactThreadDto,
  type ArtifactVersionDetail,
  type CapError,
  CapToShell,
  type WebEvent,
} from '@gonggong/protocol'
import { ApiError, api } from '../../../lib/api'
import {
  type ChromeCommand,
  handleChromeMessage,
  type ShellChromeHandlers,
  sendChromeCommand,
  sendChromeHello,
} from './chrome'
import {
  createArtifactThread,
  deleteArtifactThread,
  deleteThreadMessage,
  editThreadMessage,
  listArtifactThreads,
  reactThreadMessage,
  replyArtifactThread,
  sendArtifactThreads,
  updateArtifactThread,
} from './threadsApi'

/** Open-artifact `Viewer` shape (`vendor/open-artifact/packages/runtime/src/capabilities.ts`). */
export interface BrokerViewer {
  id: string
  name: string
  role: 'owner' | 'editor' | 'commenter' | 'viewer'
  kind?: 'user' | 'guest' | 'agent' | 'anonymous'
}

export interface BrokerAgentStatus {
  available: boolean
  busy: boolean
  name: string
  waitingForPerson?: boolean
}

export interface BrokerOptions {
  artifactId: string
  getTitle: () => string
  /** Current version shown (`null` falls back to head on the server). */
  getVersionId: () => string | null
  /** Exact preview origin (`event.origin` must match). */
  getOrigin: () => string | null
  getFrameWindow: () => Window | null
  viewer: BrokerViewer
  /** True for guests, `access === 'view'`, or past versions: only grants `artifact` (read), `user`, `downloads`. */
  readOnly: boolean
  getAgentStatus: () => BrokerAgentStatus
  getBotId: () => string | null
  onStageAgent?: (req: { text: string; title?: string; context?: Record<string, unknown> }) => void
  onViewContext?: (viewContext: Record<string, unknown> | null) => void
  onChrome?: ShellChromeHandlers
  onDownload?: (file: { name: string; data: Blob }) => void
}

export interface ArtifactBroker {
  readonly clientId: string
  onMessage: (event: MessageEvent) => void
  sendHello: () => void
  sendCommand: (cmd: ChromeCommand) => void
  pushFiles: (ev: Extract<WebEvent, { t: 'artifact.files' }>) => void
  pushThreads: (threads: ArtifactThreadDto[]) => void
  pushAgentStatus: (status: BrokerAgentStatus) => void
  setReadOnly: (next: boolean) => void
}

class BrokerCapError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly paths?: unknown[],
  ) {
    super(message)
  }
}

const READONLY_CAPS = new Set(['user', 'artifact', 'downloads'])
const EDITABLE_CAPS = new Set([
  'user',
  'artifact',
  'assets',
  'agent',
  'room',
  'downloads',
  'comments',
  'history',
])

function toCapError(err: unknown): CapError {
  if (err instanceof BrokerCapError)
    return { code: err.code, message: err.message, ...(err.paths ? { paths: err.paths } : {}) }
  if (err instanceof ApiError) {
    const code =
      err.status === 409
        ? 'conflict'
        : err.status === 403 || err.status === 401
          ? 'not_writer'
          : err.status === 404
            ? 'not_found'
            : err.status === 400
              ? 'invalid'
              : 'unavailable'
    return { code, message: err.message, ...(err.paths ? { paths: err.paths } : {}) }
  }
  return { code: 'unavailable', message: err instanceof Error ? err.message : 'unavailable' }
}

/** Maps our `ArtifactThreadDto` to open-artifact's `CommentThread`. */
export function toOpenArtifactThread(th: ArtifactThreadDto) {
  return {
    id: th.id,
    anchor: typeof th.anchor === 'string' ? th.anchor : JSON.stringify(th.anchor),
    label: th.label,
    ...(th.detail !== null ? { detail: th.detail } : {}),
    location: th.location,
    status: th.status === 'resolved' ? ('resolved' as const) : ('open' as const),
    ...(th.status === 'resolved' && th.resolvedByName
      ? { resolvedBy: { kind: 'person' as const, name: th.resolvedByName } }
      : {}),
    ...(th.status === 'sent' ? { agent: { status: 'delivered' as const } } : {}),
    messages: th.messages.map((m) => ({
      id: m.id,
      author: { kind: m.authorKind === 'bot' ? ('agent' as const) : ('person' as const), name: m.authorName },
      text: m.text,
      at: m.at,
      ...(m.editedAt ? { editedAt: m.editedAt } : {}),
      ...(m.to.length ? { to: m.to } : {}),
      ...(m.reactions.length
        ? {
            reactions: m.reactions.map((r) => ({
              emoji: r.emoji,
              authors: (r.authors ?? r.userIds.map((id) => ({ id, name: id }))).map((u) => ({
                kind: 'person' as const,
                name: u.name,
              })),
            })),
          }
        : {}),
    })),
  }
}

function browserDownload(file: { name: string; data: Blob }) {
  const url = URL.createObjectURL(file.data)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Capability broker between an open-artifact editor iframe and Gonggong's server APIs.
 * Answers every `cap_want` immediately (`ok: false` for denied/unsupported caps) so the editor
 * never falls back to a local server after 1.5 s.
 */
export function createArtifactBroker(opts: BrokerOptions): ArtifactBroker {
  const clientId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `c-${Date.now()}-${Math.random().toString(16).slice(2)}`
  let gen = 0
  let readOnly = opts.readOnly
  const granted = new Set<string>()
  const presenceState: Record<string, unknown> = {}
  const versionIdByN = new Map<number, string>()

  const post = (msg: unknown) => {
    const origin = opts.getOrigin()
    const win = opts.getFrameWindow()
    if (origin && win) win.postMessage(msg, origin)
  }

  const activeCaps = () => (readOnly ? READONLY_CAPS : EDITABLE_CAPS)

  const effectiveViewer = (): BrokerViewer => (readOnly ? { ...opts.viewer, role: 'viewer' } : opts.viewer)

  const configFor = (cap: string): Record<string, unknown> => {
    if (cap === 'artifact') return { id: opts.artifactId }
    if (cap === 'user') return { me: effectiveViewer() }
    if (cap === 'downloads') return { browser: true }
    return {}
  }

  const versionQuery = (vid: string | null) => (vid ? `?version=${encodeURIComponent(vid)}` : '')

  const resolveVersionId = async (n: number): Promise<string> => {
    const cached = versionIdByN.get(n)
    if (cached) return cached
    const list = await api.get<ArtifactHistoryListRes>(`/artifacts/${opts.artifactId}/versions/history`)
    for (const v of list.versions) versionIdByN.set(v.n, v.id)
    const found = versionIdByN.get(n)
    if (!found) throw new BrokerCapError('not_found', `Version ${n} not found`)
    return found
  }

  const handlers: Record<string, Record<string, (...args: unknown[]) => Promise<unknown> | unknown>> = {
    user: {
      me: () => effectiveViewer(),
    },
    artifact: {
      title: () => opts.getTitle(),
      async list() {
        const vid = opts.getVersionId()
        if (!vid) return {}
        const detail = await api.get<ArtifactVersionDetail>(`/artifacts/${opts.artifactId}/versions/${vid}`)
        const out: Record<string, { sha256: string; size: number }> = {}
        for (const f of detail.files) out[f.path] = { sha256: f.hash, size: f.size }
        return out
      },
      async readText(path) {
        if (typeof path !== 'string' || !path) throw new BrokerCapError('invalid', 'Invalid path')
        return api.text(`/artifacts/${opts.artifactId}/files/${path}${versionQuery(opts.getVersionId())}`)
      },
      async readBytes(path) {
        if (typeof path !== 'string' || !path) throw new BrokerCapError('invalid', 'Invalid path')
        return api.bytes(`/artifacts/${opts.artifactId}/files/${path}${versionQuery(opts.getVersionId())}`)
      },
      async publish(batch) {
        if (readOnly) throw new BrokerCapError('not_writer', 'Read-only view')
        if (!batch || typeof batch !== 'object') throw new BrokerCapError('invalid', 'Invalid batch')
        const res = await api.post<ArtifactPublishRes>(`/artifacts/${opts.artifactId}/publish`, {
          batch: batch as ArtifactPublishReq['batch'],
          clientId,
        })
        versionIdByN.set(res.n, res.versionId)
        return { hashes: res.hashes }
      },
    },
    assets: {
      async upload(blob) {
        if (readOnly) throw new BrokerCapError('not_writer', 'Read-only view')
        if (!(blob instanceof Blob)) throw new BrokerCapError('invalid', 'Expected Blob')
        return api.post<ArtifactAssetRes>(`/artifacts/${opts.artifactId}/assets`, blob)
      },
    },
    agent: {
      status: () => opts.getAgentStatus(),
      async send(req, options) {
        if (readOnly) throw new BrokerCapError('not_writer', 'Read-only view')
        const body = (req ?? {}) as { text?: string; title?: string; context?: Record<string, unknown> }
        const deliver = (options as { deliver?: 'send' | 'stage' } | undefined)?.deliver ?? 'send'
        if (!body.text?.trim()) throw new BrokerCapError('invalid', 'Empty request')
        if (deliver === 'stage') {
          opts.onStageAgent?.({ text: body.text, title: body.title, context: body.context })
          return { status: 'staged' }
        }
        const botId = opts.getBotId()
        const mergedContext =
          presenceState.viewContext || body.context
            ? { ...(presenceState.viewContext ? { view: presenceState.viewContext } : {}), ...body.context }
            : undefined
        const res = await api.post<ArtifactAgentSendRes>(`/artifacts/${opts.artifactId}/agent-send`, {
          text: body.text,
          ...(body.title ? { title: body.title } : {}),
          ...(mergedContext ? { context: mergedContext } : {}),
          ...(botId ? { botId } : {}),
        })
        return { status: res.status, ...(res.reason ? { reason: res.reason } : {}) }
      },
    },
    room: {
      self: () => clientId,
      presence(patch) {
        if (patch && typeof patch === 'object') {
          for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
            if (v === null) delete presenceState[k]
            else presenceState[k] = v
          }
          if ('viewContext' in patch) {
            const vc = (patch as Record<string, unknown>).viewContext
            opts.onViewContext?.(vc && typeof vc === 'object' ? (vc as Record<string, unknown>) : null)
          }
        }
        return undefined
      },
      peers: () => [],
      emit: () => undefined,
    },
    downloads: {
      check: () => undefined,
      save(file) {
        const f = file as { name?: string; data?: Blob }
        if (!f?.name || !(f.data instanceof Blob)) throw new BrokerCapError('invalid', 'Invalid download')
        ;(opts.onDownload ?? browserDownload)({ name: f.name, data: f.data })
        return {}
      },
    },
    comments: {
      async list() {
        const rows = await listArtifactThreads(opts.artifactId)
        return rows.map(toOpenArtifactThread)
      },
      async create(input) {
        if (readOnly) throw new BrokerCapError('not_writer', 'Read-only view')
        const c = input as {
          anchor: string
          label?: string
          detail?: string
          location?: Record<string, unknown>
          text: string
          to?: string[]
        }
        const vid = opts.getVersionId()
        const th = await createArtifactThread(opts.artifactId, {
          ...(vid ? { versionId: vid } : {}),
          anchor: c.anchor,
          label: c.label ?? '',
          detail: c.detail ?? null,
          location: c.location ?? {},
          text: c.text,
          to: c.to ?? [],
        })
        return toOpenArtifactThread(th)
      },
      async reply(threadId, text, options) {
        if (readOnly) throw new BrokerCapError('not_writer', 'Read-only view')
        const th = await replyArtifactThread(String(threadId), {
          text: String(text),
          to: (options as { to?: string[] } | undefined)?.to ?? [],
        })
        return toOpenArtifactThread(th)
      },
      async edit(threadId, messageId, text, options) {
        if (readOnly) throw new BrokerCapError('not_writer', 'Read-only view')
        const th = await editThreadMessage(String(threadId), String(messageId), {
          text: String(text),
          ...((options as { to?: string[] } | undefined)?.to
            ? { to: (options as { to?: string[] }).to }
            : {}),
        })
        return toOpenArtifactThread(th)
      },
      async react(threadId, messageId, emoji, on) {
        if (readOnly) throw new BrokerCapError('not_writer', 'Read-only view')
        const th = await reactThreadMessage(String(threadId), String(messageId), {
          emoji: String(emoji),
          on: Boolean(on),
        })
        return toOpenArtifactThread(th)
      },
      async setResolved(threadId, resolved) {
        if (readOnly) throw new BrokerCapError('not_writer', 'Read-only view')
        const th = await updateArtifactThread(String(threadId), { status: resolved ? 'resolved' : 'open' })
        return toOpenArtifactThread(th)
      },
      async move(threadId, anchor, location) {
        if (readOnly) throw new BrokerCapError('not_writer', 'Read-only view')
        const th = await updateArtifactThread(String(threadId), {
          anchor: String(anchor),
          ...(location && typeof location === 'object'
            ? { location: location as Record<string, unknown> }
            : {}),
        })
        return toOpenArtifactThread(th)
      },
      async remove(threadId, messageId) {
        if (readOnly) throw new BrokerCapError('not_writer', 'Read-only view')
        if (messageId) await deleteThreadMessage(String(threadId), String(messageId))
        else await deleteArtifactThread(String(threadId))
        return undefined
      },
      async sendToAgent(threadId) {
        if (readOnly) throw new BrokerCapError('not_writer', 'Read-only view')
        const botId = opts.getBotId()
        if (!botId) throw new BrokerCapError('unavailable', 'No bot available in this group')
        await sendArtifactThreads(opts.artifactId, { threadIds: [String(threadId)], botId })
        const rows = await listArtifactThreads(opts.artifactId)
        const found = rows.find((x) => x.id === String(threadId))
        if (!found) throw new BrokerCapError('not_found', 'Thread not found')
        return toOpenArtifactThread(found)
      },
    },
    history: {
      async list() {
        const res = await api.get<ArtifactHistoryListRes>(`/artifacts/${opts.artifactId}/versions/history`)
        for (const v of res.versions) versionIdByN.set(v.n, v.id)
        return {
          versions: res.versions.map(({ id: _id, ...v }) => v),
          notices: res.notices,
          canRestore: !readOnly && res.canRestore,
        }
      },
      async files(n) {
        return api.get<Record<string, { sha256: string; size: number }>>(
          `/artifacts/${opts.artifactId}/versions/by-number/${Number(n)}/files`,
        )
      },
      async read(n, path) {
        const vid = await resolveVersionId(Number(n))
        return api.text(
          `/artifacts/${opts.artifactId}/files/${String(path)}?version=${encodeURIComponent(vid)}`,
        )
      },
      async readBytes(n, path) {
        const vid = await resolveVersionId(Number(n))
        return api.bytes(
          `/artifacts/${opts.artifactId}/files/${String(path)}?version=${encodeURIComponent(vid)}`,
        )
      },
      async diff(n, path) {
        const vid = await resolveVersionId(Number(n))
        return api.get<ArtifactHistoryDiffRes>(
          `/artifacts/${opts.artifactId}/versions/${vid}/diff?path=${encodeURIComponent(String(path))}`,
        )
      },
      async restore(n, paths) {
        if (readOnly) throw new BrokerCapError('not_writer', 'Read-only view')
        const vid = await resolveVersionId(Number(n))
        return api.post<ArtifactRestoreFilesRes>(
          `/artifacts/${opts.artifactId}/versions/${vid}/restore-files`,
          {
            ...(Array.isArray(paths) ? { paths } : {}),
            clientId,
          },
        )
      },
      dismissNotice: () => undefined,
    },
  }

  const onMessage = (event: MessageEvent) => {
    const origin = opts.getOrigin()
    const win = opts.getFrameWindow()
    if (!origin || !win || event.origin !== origin || event.source !== win) return
    const raw = event.data
    if (
      !raw ||
      typeof raw !== 'object' ||
      typeof (raw as { openArtifact?: unknown }).openArtifact !== 'string'
    )
      return
    const data = raw as Record<string, unknown>

    if (handleChromeMessage(data, win, origin, opts.onChrome)) return

    const parsed = CapToShell.safeParse(data)
    if (!parsed.success) return
    const msg = parsed.data

    if (msg.openArtifact === 'cap_want') {
      const ok = activeCaps().has(msg.cap)
      if (ok) granted.add(msg.cap)
      post({
        openArtifact: 'cap_grant',
        cap: msg.cap,
        ok,
        gen,
        ...(ok ? { config: configFor(msg.cap) } : {}),
      })
      return
    }

    if (msg.gen !== gen) {
      post({
        openArtifact: 'cap_r',
        id: msg.id,
        error: { code: 'invalid', message: 'not run: the artifact was updated' },
      })
      return
    }
    if (!activeCaps().has(msg.cap)) {
      post({
        openArtifact: 'cap_r',
        id: msg.id,
        error: { code: 'not_granted', message: `${msg.cap} is not granted` },
      })
      return
    }
    const fn = handlers[msg.cap]?.[msg.method]
    if (!fn) {
      post({
        openArtifact: 'cap_r',
        id: msg.id,
        error: { code: 'unavailable', message: `${msg.cap}.${msg.method} is not supported` },
      })
      return
    }
    void Promise.resolve()
      .then(() => fn(...msg.args))
      .then(
        (result) => post({ openArtifact: 'cap_r', id: msg.id, result }),
        (err) => post({ openArtifact: 'cap_r', id: msg.id, error: toCapError(err) }),
      )
  }

  return {
    clientId,
    onMessage,
    sendHello() {
      const origin = opts.getOrigin()
      if (origin) sendChromeHello(opts.getFrameWindow(), origin)
    },
    sendCommand(cmd) {
      const origin = opts.getOrigin()
      if (origin) sendChromeCommand(opts.getFrameWindow(), origin, cmd)
    },
    pushFiles(ev) {
      if (ev.clientId && ev.clientId === clientId) return
      versionIdByN.set(ev.n, ev.versionId)
      if (granted.has('artifact')) {
        post({
          openArtifact: 'cap_ev',
          cap: 'artifact',
          event: 'files',
          data: { changes: ev.changes, ...(ev.author ? { author: ev.author } : {}) },
        })
      }
      if (granted.has('history')) {
        post({ openArtifact: 'cap_ev', cap: 'history', event: 'change', data: { n: ev.n } })
      }
    },
    pushThreads(threads) {
      if (!granted.has('comments')) return
      post({
        openArtifact: 'cap_ev',
        cap: 'comments',
        event: 'threads',
        data: threads.map(toOpenArtifactThread),
      })
    },
    pushAgentStatus(status) {
      if (!granted.has('agent')) return
      post({ openArtifact: 'cap_ev', cap: 'agent', event: 'status', data: status })
    },
    setReadOnly(next) {
      if (next === readOnly) return
      readOnly = next
      gen += 1
      const caps = [...activeCaps()]
      for (const c of [...granted]) if (!activeCaps().has(c)) granted.delete(c)
      post({ openArtifact: 'cap_rewired', gen, caps })
    },
  }
}
