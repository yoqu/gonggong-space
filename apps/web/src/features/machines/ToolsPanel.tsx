import {
  compareVersions,
  type MachineDto,
  type Mirror,
  type ToolKind,
  type ToolOpDto,
  type ToolStatus,
  type ToolsStateDto,
} from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { t } from '../../i18n'
import { api, errorText } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { realtime } from '../../lib/realtime'
import {
  Alert,
  Button,
  Disclosure,
  GroupBox,
  GroupRow,
  PopUpButton,
  Skeleton,
  Tag,
  TextField,
  toast,
} from '../../ui'
import { hasUpdate, selfUpgradeCommand } from './tools'

const MIN_NODE = 22
const TOOLS: { kind: ToolKind; name: string; sub: string }[] = [
  {
    kind: 'node',
    name: 'Node.js',
    sub: t('运行 ACP 适配器，托管安装 Claude Code / Codex 也用它（需 ≥ {min}）', { min: MIN_NODE }),
  },
  { kind: 'claude', name: 'Claude Code', sub: 'Anthropic' },
  { kind: 'codex', name: 'Codex', sub: 'OpenAI' },
]
const MIRRORS: { value: Mirror['kind']; label: string }[] = [
  { value: 'npmmirror', label: t('淘宝镜像（npmmirror）') },
  { value: 'official', label: t('官方源') },
  { value: 'custom', label: t('自定义') },
]

const tooOld = (t: ToolStatus) =>
  t.kind === 'node' && t.installed && !!t.version && compareVersions(t.version, `${MIN_NODE}.0.0`) < 0

/** The install / upgrade in progress or last run; the daemon runs one at a time per machine. */
interface Op {
  kind: ToolKind
  /** null until the server answers; lines of this machine arriving before that are ours. */
  opId: string | null
  lines: string[]
  running: boolean
  failed: boolean
}

/** Agent 工具 of a machine (design §4.1): versions, install / upgrade with a live log, and the mirror. */
export function ToolsPanel({ machine }: { machine: MachineDto }) {
  const [state, setState] = useState<ToolsStateDto | null>(null)
  const [error, setError] = useState('')
  const [op, setOp] = useState<Op | null>(null)
  const base = `/machines/${machine.id}/tools`

  useEffect(() => {
    api.get<ToolsStateDto>(base).then(setState, (e) => setError(errorText(e)))
  }, [base])

  useEffect(
    () =>
      realtime.subscribe((e) => {
        if (e.t !== 'machine.tools.progress' && e.t !== 'machine.tools.result') return
        if (e.machineId !== machine.id) return
        setOp((o) => {
          if (!o?.running || (o.opId !== null && o.opId !== e.opId)) return o
          if (e.t === 'machine.tools.progress') return { ...o, lines: [...o.lines, e.line] }
          return { ...o, running: false, failed: !e.ok, lines: e.error ? [...o.lines, e.error] : o.lines }
        })
        if (e.t === 'machine.tools.result' && e.state) setState(e.state)
      }),
    [machine.id],
  )

  const run = async (kind: ToolKind, which: 'install' | 'upgrade') => {
    setOp({ kind, opId: null, lines: [], running: true, failed: false })
    try {
      const { opId } = await api.post<ToolOpDto>(`${base}/${kind}/${which}`, {})
      setOp((o) => o && { ...o, opId })
    } catch (e) {
      setOp((o) => o && { ...o, running: false, failed: true, lines: [...o.lines, errorText(e)] })
    }
  }

  const saveMirror = async (mirror: Mirror) => {
    try {
      setState(await api.put<ToolsStateDto>(`${base}/settings`, { mirror }))
      toast({ type: 'success', message: t('镜像源已保存') })
    } catch (e) {
      toastError(e)
    }
  }

  if (error) return <Alert variant="error" description={error} />
  if (!state) return <Skeleton count={3} />
  return (
    <div className="mx">
      {TOOLS.map(({ kind, name, sub }) => {
        const tool = state.tools.find((x) => x.kind === kind)
        return (
          <section key={kind} aria-label={name}>
            <GroupBox>
              <div className="mx-row">
                <span className="mx-row__main">
                  <span className="mx-row__title">
                    <span className="mx-strong">{name}</span>
                    <Badge tool={tool} />
                  </span>
                  <span className="mx-sub">{sub}</span>
                </span>
                {tool ? (
                  <ToolAction tool={tool} busy={!!op?.running} onRun={(w) => void run(kind, w)} />
                ) : null}
              </div>
              {tool?.installed ? (
                <>
                  <GroupRow
                    label={t('来源')}
                    wideValue
                    value={tool.managed ? t('共工空间托管') : t('自行安装')}
                  />
                  <GroupRow
                    label={t('最新版本')}
                    wideValue
                    value={
                      <span className="mx-inline">
                        {tool.latest ?? t('无法获取，请检查镜像源')}
                        {hasUpdate(tool) ? <Tag tone="orange">{t('有更新')}</Tag> : null}
                      </span>
                    }
                  />
                  <SelfUpgradeRow tool={tool} />
                </>
              ) : null}
              {op?.kind === kind ? <ToolLog op={op} /> : null}
            </GroupBox>
          </section>
        )
      })}
      <GroupBox>
        <MirrorRows
          key={JSON.stringify(state.settings.mirror)}
          mirror={state.settings.mirror}
          onSave={saveMirror}
        />
      </GroupBox>
    </div>
  )
}

function Badge({ tool }: { tool: ToolStatus | undefined }) {
  if (!tool?.installed) return <Tag tone="orange">{t('未安装')}</Tag>
  if (tooOld(tool)) return <Tag tone="red">{t('版本过低 {version}', { version: tool.version ?? '' })}</Tag>
  return <Tag tone="green">{t('已安装 {version}', { version: tool.version ?? '' }).trim()}</Tag>
}

/** 安装 when missing, 升级到 X for a managed tool with an update; the user's own install is theirs to upgrade. */
function ToolAction({
  tool,
  busy,
  onRun,
}: {
  tool: ToolStatus
  busy: boolean
  onRun: (which: 'install' | 'upgrade') => void
}) {
  if (!tool.installed || tooOld(tool))
    return (
      <Button variant="primary" disabled={busy} onClick={() => onRun('install')}>
        {t('安装')}
      </Button>
    )
  return tool.managed && hasUpdate(tool) ? (
    <Button variant="primary" disabled={busy} onClick={() => onRun('upgrade')}>
      {t('升级到 {version}', { version: tool.latest ?? '' })}
    </Button>
  ) : null
}

function SelfUpgradeRow({ tool }: { tool: ToolStatus }) {
  const command = !tool.managed && hasUpdate(tool) ? selfUpgradeCommand(tool.kind, tool.path) : null
  if (!command) return null
  return (
    <GroupRow
      label={t('升级命令')}
      description={t('自行安装的版本由你在本机终端升级')}
      wideValue
      value={<span className="mx-mono">{command}</span>}
    />
  )
}

function ToolLog({ op }: { op: Op }) {
  const [open, setOpen] = useState(true)
  const title = op.running ? t('正在安装…') : op.failed ? t('安装失败') : t('安装完成')
  return (
    <div className="mx-row mx-toollog">
      <Disclosure title={title} summary={op.lines.at(-1)} open={open} onToggle={setOpen}>
        <div className="mx-logpane" role="log" aria-label={t('安装日志')}>
          {op.lines.length ? null : <div className="mx-log mx-sub">{t('等待机器输出…')}</div>}
          {op.lines.map((l, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: an append-only log
            <div key={i} className="mx-log">
              {l}
            </div>
          ))}
        </div>
      </Disclosure>
    </div>
  )
}

/** 镜像源 of Node.js and the agent CLIs; a custom one takes both addresses before it is saved. */
function MirrorRows({ mirror, onSave }: { mirror: Mirror; onSave: (m: Mirror) => Promise<void> }) {
  const [kind, setKind] = useState(mirror.kind)
  const [registry, setRegistry] = useState(mirror.kind === 'custom' ? mirror.registry : '')
  const [node, setNode] = useState(mirror.kind === 'custom' ? mirror.node : '')
  const changed = mirror.kind !== 'custom' || mirror.registry !== registry || mirror.node !== node
  return (
    <>
      <GroupRow label={t('镜像源')} description={t('安装、升级 Node.js、Claude Code 与 Codex 时从这里下载')}>
        <PopUpButton
          aria-label={t('镜像源')}
          options={MIRRORS}
          value={kind}
          onChange={(k) => {
            setKind(k)
            if (k !== 'custom') void onSave({ kind: k })
          }}
        />
      </GroupRow>
      {kind === 'custom' ? (
        <>
          <GroupRow label="npm registry">
            <TextField
              aria-label="npm registry"
              className="mx-mirror-field"
              placeholder="https://registry.example.com"
              value={registry}
              onChange={(e) => setRegistry(e.target.value)}
            />
          </GroupRow>
          <GroupRow label={t('Node.js 下载地址')} description={t('index.json 所在的目录')}>
            <TextField
              aria-label={t('Node.js 下载地址')}
              className="mx-mirror-field"
              placeholder="https://example.com/mirrors/node"
              value={node}
              onChange={(e) => setNode(e.target.value)}
            />
          </GroupRow>
          <div className="mx-row mx-row--end">
            <Button
              variant="primary"
              disabled={!registry.trim() || !node.trim() || !changed}
              onClick={() => void onSave({ kind: 'custom', registry: registry.trim(), node: node.trim() })}
            >
              {t('保存')}
            </Button>
          </div>
        </>
      ) : null}
    </>
  )
}
