import {
  type AgentKind,
  type AgentState,
  agentMeta,
  compareVersions,
  type ProviderStoreView,
  type ToolKind,
} from '@gonggong/protocol'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { t } from '../../i18n'
import { errorText } from '../../lib/api'
import { copyWithToast } from '../../lib/clipboard'
import { AgentIcon, Alert, Button, GroupBox, Icon, Presence, Skeleton, Tag } from '../../ui'
import { type EditorState, ProvidersPanel } from '../machines/ProvidersPanel'
import { AgentDetail } from './AgentDetail'
import {
  type AgentStatus,
  agentStatus,
  missingAgent,
  needsOfficialLogin,
  nodeStatus,
  runnableAgents,
} from './model'
import { NodeBar } from './NodeBar'
import type { AgentBotRef, AgentsSource, ToolOpKind } from './source'
import { ToolLog } from './ToolLog'
import { type ToolOp, useAgentTools } from './useAgentTools'
import '../machines/machines.css'
import './agents.css'

/**
 * The Agent page of a machine, shared by the web and the desktop app (only `source` differs): Node.js as a status
 * line, one row per installed agent with one main action, those not installed under 可安装, 全部升级, each opening
 * into its details; then the machine's providers.
 */
export function AgentsPanel({
  source,
  bots,
  initialOpen,
  initialLogin,
  onInitialLoginHandled,
}: {
  source: AgentsSource
  bots: AgentBotRef[]
  initialOpen?: AgentKind | null
  initialLogin?: AgentKind | null
  onInitialLoginHandled?: () => void
}) {
  const has = (f: string) => source.features.includes(f)
  const live = has('providers') || has('agentSettings')
  const tools = useAgentTools(source)
  const [view, setView] = useState<ProviderStoreView | null>(null)
  const [error, setError] = useState('')
  const [providersLoading, setProvidersLoading] = useState(live)
  const [providersTick, setProvidersTick] = useState(0)
  const [open, setOpen] = useState<AgentKind | null>(initialOpen ?? initialLogin ?? null)
  const [loginKind, setLoginKind] = useState<AgentKind | null>(null)
  const [localRefreshTick, setLocalRefreshTick] = useState(0)
  const [editor, setEditorState] = useState<EditorState>(null)
  // Each opening of the editor starts fresh, though a closing one may still be on screen.
  const seq = useRef(0)
  const setEditor = (e: EditorState) => {
    seq.current += 1
    setEditorState(e && { ...e, seq: seq.current })
  }

  // Deep link / URL query intent: expand the target agent and open its login dialog once agents are loaded.
  useEffect(() => {
    if (!tools.state) return
    if (!initialOpen && !initialLogin) return
    const target = initialLogin ?? initialOpen
    if (target) setOpen(target)
    if (initialLogin && source.renderLogin) setLoginKind(initialLogin)
    onInitialLoginHandled?.()
  }, [tools.state, initialOpen, initialLogin, source.renderLogin, onInitialLoginHandled])

  const refreshLoginState = useCallback(() => {
    setLocalRefreshTick((n) => n + 1)
    void tools.reload().catch(() => {})
  }, [tools.reload])

  // Refresh login status when the window regains focus while the login dialog is open.
  useEffect(() => {
    if (!loginKind) return
    const onFocus = () => refreshLoginState()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [loginKind, refreshLoginState])

  // biome-ignore lint/correctness/useExhaustiveDependencies: `providersTick` triggers a reload
  useEffect(() => {
    if (!live) {
      setProvidersLoading(false)
      return
    }
    let on = true
    setProvidersLoading(true)
    source.loadProviders().then(
      (v) => {
        if (!on) return
        setView(v)
        setError('')
        setProvidersLoading(false)
      },
      (e) => {
        if (!on) return
        setError(errorText(e))
        setProvidersLoading(false)
      },
    )
    return () => {
      on = false
    }
  }, [source, live, providersTick])

  const retryAll = () => {
    tools.retry()
    if (live) setProvidersTick((n) => n + 1)
  }

  const failed = [tools.error, error].filter(Boolean).join('\n')
  if (failed)
    return (
      <Alert
        variant="error"
        description={failed}
        retrying={tools.loading || providersLoading}
        onRetry={retryAll}
      />
    )
  if (!tools.state || (live && !view)) return <Skeleton count={4} />

  const state = tools.state
  const agents = runnableAgents(source.features, state.agents).map(
    (k) => state.agents.find((a) => a.kind === k) ?? missingAgent(k),
  )
  const installed = agents.filter((a) => a.available)
  const installable = agents.filter((a) => !a.available)
  const upgradable = installed.filter((a) => agentStatus(a) === 'update').map((a) => a.kind)
  const canRun = has('tools')
  const nodeNeedsInstall = canRun && !!state.node && nodeStatus(state.node) !== 'ok'
  const showUpgradeAll = canRun && upgradable.length > 0
  const loginAgent = loginKind ? (agents.find((a) => a.kind === loginKind) ?? missingAgent(loginKind)) : null
  const row = (a: AgentState) => (
    <AgentRow
      key={a.kind}
      agent={a}
      needsLogin={needsOfficialLogin(a, view)}
      onLogin={source.renderLogin ? () => setLoginKind(a.kind) : undefined}
      nodeVersion={state.node?.version ?? null}
      open={open === a.kind}
      onToggle={() => setOpen(open === a.kind ? null : a.kind)}
      op={tools.op}
      busy={tools.busy}
      canRun={canRun}
      onRun={(kind, which) => void tools.run(kind, which)}
      detail={
        <AgentDetail
          source={source}
          agent={a}
          view={view}
          onView={setView}
          onAddProvider={() => setEditor({ editing: null })}
          onOpenLogin={source.renderLogin ? () => setLoginKind(a.kind) : undefined}
          onAgents={tools.reload}
          refreshTick={localRefreshTick}
          bots={bots}
        />
      }
    />
  )

  return (
    <div className="mx">
      {state.node ? (
        <NodeBar node={state.node} op={tools.op} busy={tools.busy} canRun={canRun} onRun={tools.run} />
      ) : null}
      <section className="mx-section" aria-label="Agent">
        <div className="mx-section__head">
          <span className="mx-row__main mx-strong">Agent</span>
          {showUpgradeAll ? (
            <Button
              size="small"
              variant={nodeNeedsInstall ? 'default' : 'primary'}
              disabled={tools.busy}
              loading={!!tools.batch}
              onClick={() => void tools.upgradeAll(upgradable)}
            >
              {tools.batch
                ? t('正在升级 {done}/{total}…', { done: tools.batch.done + 1, total: tools.batch.total })
                : t('全部升级（{n}）', { n: upgradable.length })}
            </Button>
          ) : null}
        </div>
        {installed.length ? (
          <GroupBox>{installed.map(row)}</GroupBox>
        ) : (
          <p className="mx-sub ag-empty">{t('这台电脑上还没有可用的 Agent，从下面选一个安装')}</p>
        )}
      </section>
      {view && has('providers') ? (
        <ProvidersPanel
          source={source}
          view={view}
          onView={setView}
          editor={editor}
          onEditor={setEditor}
          primaryAdd={!showUpgradeAll && !nodeNeedsInstall}
        />
      ) : null}
      {installable.length ? (
        <section className="mx-section" aria-label={t('可安装')}>
          <span className="mx-section__head mx-strong">{t('可安装')}</span>
          <GroupBox>{installable.map(row)}</GroupBox>
        </section>
      ) : null}
      <Presence>
        {loginAgent
          ? source.renderLogin?.({
              agent: loginAgent.kind,
              agentState: loginAgent,
              onClose: () => {
                setLoginKind(null)
                refreshLoginState()
              },
              onAddProvider: () => setEditor({ editing: null }),
              onLoggedIn: refreshLoginState,
            })
          : null}
      </Presence>
    </div>
  )
}

const STATUS_TAG: Record<AgentStatus, { tone: 'green' | 'orange' | 'gray'; text: string } | null> = {
  missing: null,
  command: { tone: 'gray', text: t('需自行安装') },
  update: { tone: 'orange', text: t('有更新') },
  stale: { tone: 'orange', text: t('有更新') },
  current: null,
}

const belowMin = (a: AgentState) =>
  !!a.version && !!a.minVersion && compareVersions(a.version, a.minVersion) < 0

const nodeNoteMissing = (note: string | undefined, nodeVersion: string | null) => {
  if (!note) return false
  const m = /Node\.js\s*≥\s*([\d.]+)/.exec(note)
  if (!m) return false
  return !nodeVersion || compareVersions(nodeVersion, m[1]!) < 0
}

function AgentRow({
  agent: a,
  needsLogin,
  onLogin,
  nodeVersion,
  open,
  onToggle,
  op,
  busy,
  canRun,
  onRun,
  detail,
}: {
  agent: AgentState
  needsLogin: boolean
  onLogin?: () => void
  nodeVersion: string | null
  open: boolean
  onToggle: () => void
  op: ToolOp | null
  busy: boolean
  canRun: boolean
  onRun: (kind: ToolKind, which: ToolOpKind) => void
  detail: ReactNode
}) {
  const meta = agentMeta(a.kind)
  const status = agentStatus(a)
  // Hide the redundant 有更新 tag when the row already carries an 升级到 button.
  const tag = canRun && status === 'update' ? null : STATUS_TAG[status]
  const isNodeNote = !!meta.note && /Node\.js\s*≥\s*[\d.]+/.test(meta.note)
  const warnNode = isNodeNote && nodeNoteMissing(meta.note, nodeVersion)
  const subParts = [
    t.text({ key: meta.vendor }),
    a.available ? (a.version ?? t('已安装')) : '',
    meta.note && !isNodeNote ? t.text({ key: meta.note }) : '',
  ].filter(Boolean)
  const mine = op?.kind === a.kind ? op : null
  return (
    <div className="ag-agent" data-open={open}>
      <div className="mx-row ag-row">
        <button type="button" className="ag-row__open" aria-expanded={open} onClick={onToggle}>
          <Icon name="chevron-right" size={12} className="ag-row__chev" />
          <AgentIcon kind={a.kind} />
          <span className="mx-row__main">
            <span className="mx-row__title">
              <span className="mx-strong">{meta.name}</span>
              {needsLogin ? <Tag tone="orange">{t('未登录')}</Tag> : null}
              {tag ? <Tag tone={tag.tone}>{tag.text}</Tag> : null}
              {belowMin(a) ? (
                <Tag tone="red">{t('低于最低要求 {version}', { version: a.minVersion ?? '' })}</Tag>
              ) : null}
            </span>
            <span className="mx-sub mx-ellipsis">
              {subParts.join(' · ')}
              {warnNode && meta.note ? (
                <>
                  {subParts.length ? ' · ' : ''}
                  <span className="mx-warn">{t.text({ key: meta.note })}</span>
                </>
              ) : null}
            </span>
          </span>
        </button>
        <span className="ag-row__actions">
          {needsLogin && onLogin ? (
            <Button size="small" variant="primary" onClick={onLogin}>
              {t('登录')}
            </Button>
          ) : null}
          <MainAction
            agent={a}
            status={status}
            busy={busy}
            loading={Boolean(mine?.running)}
            canRun={canRun}
            onRun={onRun}
          />
        </span>
      </div>
      {mine ? <ToolLog op={mine} /> : null}
      {mine?.failed && mine.which === 'upgrade' && !a.managed && canRun ? (
        <div className="mx-row mx-row--end">
          <Button size="small" disabled={busy} onClick={() => onRun(a.kind, 'install')}>
            {t('改用共工空间托管安装')}
          </Button>
        </div>
      ) : null}
      {open ? detail : null}
    </div>
  )
}

/** 安装 / 升级到 x / 复制安装命令, or nothing when current. */
function MainAction({
  agent: a,
  status,
  busy,
  loading,
  canRun,
  onRun,
}: {
  agent: AgentState
  status: AgentStatus
  busy: boolean
  loading: boolean
  canRun: boolean
  onRun: (kind: ToolKind, which: ToolOpKind) => void
}) {
  if (status === 'command' && a.installCommand) {
    const command = a.installCommand
    return (
      <Button size="small" onClick={() => void copyWithToast(command, t('已复制安装命令'))}>
        {t('复制安装命令')}
      </Button>
    )
  }
  if (!canRun) return null
  if (status === 'missing')
    return (
      <Button size="small" disabled={busy} loading={loading} onClick={() => onRun(a.kind, 'install')}>
        {t('安装')}
      </Button>
    )
  if (status === 'update')
    return (
      <Button size="small" disabled={busy} loading={loading} onClick={() => onRun(a.kind, 'upgrade')}>
        {t('升级到 {version}', { version: a.latest ?? '' })}
      </Button>
    )
  return null
}
