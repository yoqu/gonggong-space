import {
  type AgentKind,
  type AgentState,
  agentMeta,
  compareVersions,
  type ProviderStoreView,
  type ToolKind,
} from '@gonggong/protocol'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { t } from '../../i18n'
import { errorText } from '../../lib/api'
import { copyWithToast } from '../../lib/clipboard'
import { AgentIcon, Alert, Button, GroupBox, Icon, Skeleton, Tag } from '../../ui'
import { type EditorState, ProvidersPanel } from '../machines/ProvidersPanel'
import { AgentDetail } from './AgentDetail'
import { type AgentStatus, agentStatus, missingAgent, runnableAgents } from './model'
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
export function AgentsPanel({ source, bots }: { source: AgentsSource; bots: AgentBotRef[] }) {
  const has = (f: string) => source.features.includes(f)
  const live = has('providers') || has('agentSettings')
  const tools = useAgentTools(source)
  const [view, setView] = useState<ProviderStoreView | null>(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<AgentKind | null>(null)
  const [editor, setEditorState] = useState<EditorState>(null)
  // Each opening of the editor starts fresh, though a closing one may still be on screen.
  const seq = useRef(0)
  const setEditor = (e: EditorState) => {
    seq.current += 1
    setEditorState(e && { ...e, seq: seq.current })
  }

  useEffect(() => {
    if (!live) return
    let on = true
    source.loadProviders().then(
      (v) => on && setView(v),
      (e) => on && setError(errorText(e)),
    )
    return () => {
      on = false
    }
  }, [source, live])

  const failed = [tools.error, error].filter(Boolean).join('\n')
  if (failed) return <Alert variant="error" description={failed} />
  if (!tools.state || (live && !view)) return <Skeleton count={4} />

  const state = tools.state
  const agents = runnableAgents(source.features, state.agents).map(
    (k) => state.agents.find((a) => a.kind === k) ?? missingAgent(k),
  )
  const installed = agents.filter((a) => a.available)
  const installable = agents.filter((a) => !a.available)
  const upgradable = installed.filter((a) => agentStatus(a) === 'update').map((a) => a.kind)
  const canRun = has('tools')
  const row = (a: AgentState) => (
    <AgentRow
      key={a.kind}
      agent={a}
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
          {canRun && upgradable.length ? (
            <Button
              size="small"
              variant="primary"
              disabled={tools.busy}
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
          <p className="mx-sub ag-empty">{t('这台机器上还没有可用的 Agent，从下面选一个安装')}</p>
        )}
      </section>
      {installable.length ? (
        <section className="mx-section" aria-label={t('可安装')}>
          <span className="mx-section__head mx-strong">{t('可安装')}</span>
          <GroupBox>{installable.map(row)}</GroupBox>
        </section>
      ) : null}
      {view && has('providers') ? (
        <ProvidersPanel source={source} view={view} onView={setView} editor={editor} onEditor={setEditor} />
      ) : null}
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

function AgentRow({
  agent: a,
  open,
  onToggle,
  op,
  busy,
  canRun,
  onRun,
  detail,
}: {
  agent: AgentState
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
  const tag = STATUS_TAG[status]
  const sub = [
    t.text({ key: meta.vendor }),
    a.available ? (a.version ?? t('已安装')) : '',
    meta.note ? t.text({ key: meta.note }) : '',
  ]
    .filter(Boolean)
    .join(' · ')
  const mine = op?.kind === a.kind ? op : null
  return (
    <div className="ag-agent" data-open={open}>
      <div className="mx-row ag-row">
        <button type="button" className="ag-row__open" aria-expanded={open} onClick={onToggle}>
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} className="ag-row__chev" />
          <AgentIcon kind={a.kind} />
          <span className="mx-row__main">
            <span className="mx-row__title">
              <span className="mx-strong">{meta.name}</span>
              {tag ? <Tag tone={tag.tone}>{tag.text}</Tag> : null}
              {belowMin(a) ? (
                <Tag tone="red">{t('低于最低要求 {version}', { version: a.minVersion ?? '' })}</Tag>
              ) : null}
            </span>
            <span className="mx-sub mx-ellipsis">{sub}</span>
          </span>
        </button>
        <MainAction agent={a} status={status} busy={busy} canRun={canRun} onRun={onRun} />
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
  canRun,
  onRun,
}: {
  agent: AgentState
  status: AgentStatus
  busy: boolean
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
      <Button size="small" variant="primary" disabled={busy} onClick={() => onRun(a.kind, 'install')}>
        {t('安装')}
      </Button>
    )
  if (status === 'update')
    return (
      <Button size="small" variant="primary" disabled={busy} onClick={() => onRun(a.kind, 'upgrade')}>
        {t('升级到 {version}', { version: a.latest ?? '' })}
      </Button>
    )
  return null
}
