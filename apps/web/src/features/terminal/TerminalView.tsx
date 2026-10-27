import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { Terminal } from '@xterm/xterm'
import { useEffect, useRef, useState } from 'react'
import { useSession } from '../../app/session'
import { useWorkbench } from '../../app/workbench'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { ApiError, errorText } from '../../lib/api'
import { Button, Dialog, EmptyState, Presence, Spinner } from '../../ui'
import { openFileAt } from '../workbench/tabs/DiffTab'
import { createTerminal, endTerminal, resolveTerminalLink, terminalSocketUrl } from './api'
import { attachTerminalKeyboard } from './keyboard'
import { createTerminalLinkProvider } from './links'
import { TerminalOutputWriter } from './output'
import '@xterm/xterm/css/xterm.css'
import './terminal.css'
import type { TerminalViewProps } from './view'

type Phase = 'loading' | 'running' | 'exited' | 'error'
type Exit = { code: number | null; reason: string | null } | null
type Message = { type: 'head' | 'reset' | 'exit'; value: Record<string, unknown> }
const pendingCreates = new Map<string, Promise<string>>()

export type { TerminalViewProps } from './view'

function colors() {
  const css = getComputedStyle(document.documentElement)
  return {
    background: css.getPropertyValue('--content-bg').trim(),
    foreground: css.getPropertyValue('--label').trim(),
    cursor: css.getPropertyValue('--label').trim(),
    cursorAccent: css.getPropertyValue('--content-bg').trim(),
    selectionBackground: css.getPropertyValue('--selection-inactive').trim(),
  }
}

function control(e: MessageEvent): Message | null {
  if (typeof e.data !== 'string') return null
  const value = JSON.parse(e.data) as Record<string, unknown>
  const type = value.op === 'reset' ? 'reset' : value.op === 'exit' ? 'exit' : 'head'
  return { type, value }
}

function sessionFor(groupId: string, botId: string, size: { cols: number; rows: number }) {
  const key = `${groupId}:${botId}`
  let pending = pendingCreates.get(key)
  if (pending) return pending
  const request = createTerminal(groupId, botId, size).then((dto) => dto.sessionId)
  pending = request.finally(() => pendingCreates.delete(key))
  pendingCreates.set(key, pending)
  return pending
}

function bytes(data: unknown): Promise<Uint8Array> {
  if (data instanceof ArrayBuffer) return Promise.resolve(new Uint8Array(data))
  if (data instanceof Blob) return data.arrayBuffer().then((b) => new Uint8Array(b))
  return Promise.resolve(new Uint8Array(data as ArrayBufferLike))
}

function reasonText(reason: string | null) {
  switch (reason) {
    case 'idle_timeout':
      return t('终端因长时间闲置已结束')
    case 'revoked':
      return t('机器权限已撤销，终端已结束')
    case 'daemon_restart':
      return t('daemon 已重启，原终端无法恢复')
    case 'user':
      return t('终端已结束')
    default:
      return null
  }
}

/** A live xterm view. Detaching its socket never terminates the daemon-owned PTY. */
export function TerminalView({ sessionId, groupId, botId, active, onSession, onExit }: TerminalViewProps) {
  const host = useRef<HTMLDivElement>(null)
  const terminal = useRef<Terminal>(null)
  const fitter = useRef<FitAddon>(null)
  const connect = useRef<(() => void) | null>(null)
  const started = useRef(false)
  const socket = useRef<WebSocket>(null)
  const shown = useRef(active)
  const callbacks = useRef({ onSession, onExit })
  const [phase, setPhase] = useState<Phase>('loading')
  const [error, setError] = useState<string | null>(null)
  const [exit, setExit] = useState<Exit>(null)
  const [confirming, setConfirming] = useState(false)
  const [ending, setEnding] = useState(false)
  const [currentSession, setCurrentSession] = useState(sessionId)
  shown.current = active
  callbacks.current = { onSession, onExit }

  useEffect(() => {
    const el = host.current
    if (!el) return
    let disposed = false
    let attachedSession = sessionId
    let settled = false
    let attempts = 0
    let reconnect: ReturnType<typeof setTimeout> | undefined
    const term = new Terminal({
      allowProposedApi: true,
      fontFamily: 'var(--font-mono)',
      fontSize: 13,
      lineHeight: 1.4,
      letterSpacing: 0,
      cursorBlink: true,
      scrollback: 5000,
      theme: colors(),
    })
    const fit = new FitAddon()
    const search = new SearchAddon()
    const searchBar = document.createElement('input')
    searchBar.className = 'wt-terminal__search'
    searchBar.setAttribute('aria-label', t('搜索终端输出'))
    searchBar.hidden = true
    searchBar.addEventListener('input', () => search.findNext(searchBar.value, { incremental: true }))
    searchBar.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        searchBar.hidden = true
        search.clearDecorations()
        term.focus()
      }
    })
    el.append(searchBar)
    terminal.current = term
    fitter.current = fit
    term.loadAddon(fit)
    term.loadAddon(search)
    const output = new TerminalOutputWriter(term)
    let after = 0
    term.open(el)
    const keyboard = attachTerminalKeyboard(term, {
      host: el,
      active: () => shown.current,
      onSearch: () => {
        searchBar.hidden = !searchBar.hidden
        if (searchBar.hidden) search.clearDecorations()
        else searchBar.focus()
      },
      onError: () => setError(t('剪贴板不可用，请检查浏览器权限')),
    })
    term.registerLinkProvider(
      createTerminalLinkProvider(term, {
        openUrl: (url) => window.open(url, '_blank', 'noopener,noreferrer'),
        resolveFile: async (path, line) => {
          if (!groupId || !botId) return
          const target = await resolveTerminalLink(groupId, botId, path, line)
          if (target.exists) openFileAt(botId, target.path, target.line)
        },
      }),
    )

    const send = (data: string | Uint8Array) => {
      if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(data)
    }
    const encoder = new TextEncoder()
    const input = term.onData((data) => send(encoder.encode(data)))
    const binary = term.onBinary((data) => send(Uint8Array.from(data, (c) => c.charCodeAt(0))))
    const resize = term.onResize(({ cols, rows }) => {
      if (socket.current?.readyState === WebSocket.OPEN)
        send(JSON.stringify({ op: 'resize', sessionId: attachedSession, cols, rows }))
    })
    const finish = (code: number | null, reason: string | null) => {
      settled = true
      if (reconnect) clearTimeout(reconnect)
      setPhase('exited')
      setExit({ code, reason })
      callbacks.current.onExit?.(code, reason)
    }
    const fail = (message: string) => {
      settled = true
      if (reconnect) clearTimeout(reconnect)
      setPhase('error')
      setError(message)
    }
    const onMessage = (event: MessageEvent) => {
      if (disposed) return
      let message: Message | null
      try {
        message = control(event)
      } catch {
        fail(t('终端连接失败，请稍后重试'))
        return
      }
      if (message) {
        const value = message.value
        if (value.code === 'forbidden' || value.status === 403) {
          fail(t('没有权限使用此终端，仅机器主人可访问'))
        } else if (message.type === 'reset') {
          fail(typeof value.message === 'string' ? value.message : t('终端连接已断开'))
        } else if (message.type === 'exit' || (value.status && value.status !== 'running')) {
          finish(
            typeof value.exitCode === 'number' ? value.exitCode : null,
            typeof value.reason === 'string' ? value.reason : null,
          )
        } else setPhase('running')
        return
      }
      void bytes(event.data).then((data) => {
        if (disposed || data.byteLength < 4) return
        after = new DataView(data.buffer, data.byteOffset, 4).getUint32(0)
        output.write(data.subarray(4))
      })
    }
    const attach = (id: string) => {
      attachedSession = id
      const ws = new WebSocket(terminalSocketUrl(id, after))
      ws.binaryType = 'arraybuffer'
      socket.current = ws
      ws.onmessage = onMessage
      ws.onopen = () => {
        attempts = 0
        if (!disposed && shown.current) fit.fit()
      }
      const retry = () => {
        if (disposed || settled || reconnect) return
        setPhase('loading')
        reconnect = setTimeout(
          () => {
            reconnect = undefined
            if (!disposed && !settled) attach(id)
          },
          Math.min(5_000, 500 * 2 ** attempts++),
        )
      }
      ws.onerror = () => {
        retry()
      }
      ws.onclose = (event) => {
        if (!disposed && !settled && event.code !== 1000) retry()
      }
      return ws
    }
    connect.current = () => {
      if (started.current || disposed) return
      started.current = true
      fit.fit()
      if (sessionId) attach(sessionId)
      else if (groupId && botId) {
        sessionFor(groupId, botId, { cols: term.cols, rows: term.rows }).then(
          (id) => {
            if (disposed) return
            setCurrentSession(id)
            callbacks.current.onSession?.(id)
            attach(id)
          },
          (e: unknown) => {
            if (!disposed)
              fail(
                e instanceof ApiError && e.status === 403
                  ? t('没有权限使用此终端，仅机器主人可访问')
                  : errorText(e),
              )
          },
        )
      }
    }
    if (shown.current) connect.current()

    const observer = new ResizeObserver(() => {
      if (shown.current && el.clientWidth && el.clientHeight) fit.fit()
    })
    observer.observe(el)
    const theme = new MutationObserver(() => {
      term.options.theme = colors()
    })
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => {
      disposed = true
      if (reconnect) clearTimeout(reconnect)
      observer.disconnect()
      theme.disconnect()
      input.dispose()
      binary.dispose()
      resize.dispose()
      keyboard()
      output.dispose()
      search.dispose()
      searchBar.remove()
      socket.current?.close()
      socket.current = null
      term.dispose()
      terminal.current = null
      fitter.current = null
      connect.current = null
      started.current = false
    }
  }, [sessionId, groupId, botId])

  useEffect(() => {
    if (!active) return
    connect.current?.()
    fitter.current?.fit()
    terminal.current?.focus()
  }, [active])

  const end = async () => {
    if (!currentSession) return
    setEnding(true)
    try {
      await endTerminal(currentSession)
      setConfirming(false)
      setPhase('exited')
      setExit({ code: null, reason: 'user' })
      onExit?.(null, 'user')
      socket.current?.close()
    } catch (e) {
      setPhase('error')
      setError(errorText(e))
    } finally {
      setEnding(false)
    }
  }

  return (
    <section className="wt-terminal" aria-label={t('终端')} data-phase={phase}>
      <div className="wt-terminal__bar">
        <span className="wt-terminal__status" role="status">
          {phase === 'loading' ? <Spinner size={12} /> : <span className="wt-terminal__dot" />}
          {phase === 'loading'
            ? t('正在连接终端…')
            : phase === 'running'
              ? t('终端运行中')
              : phase === 'exited'
                ? t('终端已结束')
                : t('终端连接失败')}
        </span>
        <Button
          size="small"
          variant="plain"
          icon="stop"
          disabled={!currentSession || phase === 'exited' || ending}
          onClick={() => setConfirming(true)}
        >
          {t('结束终端…')}
        </Button>
      </div>
      <div className="wt-terminal__screen">
        <div ref={host} className="wt-terminal__host" />
        {phase === 'loading' ? (
          <div className="wt-terminal__notice" role="status">
            <Spinner />
          </div>
        ) : null}
        {phase === 'error' || phase === 'exited' ? (
          <div className="wt-terminal__notice">
            <EmptyState
              compact
              icon={phase === 'error' ? 'exclamation-circle' : 'terminal'}
              title={phase === 'error' ? t('无法使用终端') : t('终端已结束')}
              description={
                phase === 'error'
                  ? error
                  : (reasonText(exit?.reason ?? null) ??
                    (exit?.code !== null && exit?.code !== undefined
                      ? t('Shell 已退出，退出码 {code}', { code: exit.code })
                      : null))
              }
            />
          </div>
        ) : null}
      </div>
      <Presence>
        {confirming ? (
          <Dialog
            open
            role="alertdialog"
            title={t('结束终端？')}
            message={t('这会终止 Shell 及其中正在运行的进程。仅关闭标签页会保留终端。')}
            onClose={() => setConfirming(false)}
            actions={[
              { label: t('取消'), onClick: () => setConfirming(false), autoFocus: true },
              {
                label: ending ? t('正在结束…') : t('结束终端'),
                variant: 'destructive',
                disabled: ending,
                onClick: () => void end(),
              },
            ]}
          />
        ) : null}
      </Presence>
    </section>
  )
}

/** Opens a newly created session in its original group, even if the user switched chats meanwhile. */
export function patchTerminalSession(groupId: string, key: string, sessionId: string) {
  const state = useWorkbench.getState()
  const bench = state.benches[groupId]
  const tab = bench?.tabs.find((item) => item.kind === 'terminal' && item.botId === key)
  if (!bench || !tab || tab.kind !== 'terminal') return
  const next = { ...tab, sessionId }
  state.replace(`terminal:${tab.botId}`, next, groupId)
}

export function TerminalViewGuard(props: TerminalViewProps) {
  const me = useSession((s) => s.user)
  const bot = useWorkspace((s) => s.bots.find((b) => b.id === props.botId))
  if (bot && bot.ownerId !== me?.id)
    return (
      <EmptyState
        icon="shield-warning"
        title={t('没有权限使用此终端')}
        description={t('仅机器主人可访问终端')}
      />
    )
  return <TerminalView {...props} />
}
