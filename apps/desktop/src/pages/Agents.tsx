import { type AgentKind, compareVersions } from '@gonggong/protocol'
import { Button, Disclosure, GroupBox, GroupRow, Icon, type IconName, Skeleton, Tag, toast } from '@web/ui'
import { type ReactNode, useCallback, useEffect, useState } from 'react'
import {
  type AgentCard,
  ipc,
  type MachineBot,
  onToolProgress,
  type Providers,
  type ToolKind,
  type ToolOp,
  type ToolStatus,
} from '../ipc'
import { AGENTS, VENDOR } from '../lib/labels'
import { fail, PathValue } from '../lib/ui'
import { ProviderBox } from '../providers/ProviderBox'
import { useProviderSwitch } from '../providers/switch'
import { useDaemon } from '../store'
import type { PageProps } from '.'

const MIN_NODE = 22
const TOOL_NAME: Record<ToolKind, string> = {
  node: 'Node.js',
  claude: AGENTS.claude.name,
  codex: AGENTS.codex.name,
}

/** The install / upgrade in progress or last run; one at a time per machine. */
interface Op {
  kind: ToolKind
  lines: string[]
  running: boolean
  failed: boolean
}

const hasUpdate = (t: ToolStatus | undefined) =>
  !!(t?.latest && t.version && compareVersions(t.latest, t.version) > 0)

export function AgentsPage(_: PageProps) {
  const [agents, setAgents] = useState<AgentCard[] | null>(null)
  const [tools, setTools] = useState<ToolStatus[] | null>(null)
  const [bots, setBots] = useState<MachineBot[]>([])
  const [providers, setProviders] = useState<Providers | null>(null)
  const [checking, setChecking] = useState<AgentKind | null>(null)
  const [op, setOp] = useState<Op | null>(null)

  const load = useCallback(() => ipc.agents().then(setAgents, fail), [])
  const loadTools = useCallback(() => ipc.tools().then(setTools, fail), [])
  const loadProviders = useCallback(() => ipc.providers().then(setProviders, fail), [])
  const switcher = useProviderSwitch(loadProviders)
  useEffect(() => {
    load()
    loadTools()
    loadProviders()
    ipc.bots().then(setBots, () => {})
  }, [load, loadTools, loadProviders])

  const recheck = async (kind: AgentKind) => {
    setChecking(kind)
    const list = await ipc.agents().catch((e) => {
      fail(e)
      return null
    })
    setChecking(null)
    if (!list) return
    setAgents(list)
    const a = list.find((x) => x.kind === kind)
    if (a?.available) toast({ type: 'success', message: `${AGENTS[kind].name} ${a.version ?? ''} 已检测到` })
  }

  const pickPath = async (kind: AgentKind) => {
    try {
      if (await ipc.pickAgentPath(kind)) await load()
    } catch (e) {
      fail(e)
    }
  }

  const runTool = async (kind: ToolKind, which: ToolOp) => {
    const opId = `${kind}-${Date.now()}`
    setOp({ kind, lines: [], running: true, failed: false })
    const unlisten = await onToolProgress(opId, (line) =>
      setOp((o) => o && { ...o, lines: [...o.lines, line] }),
    )
    try {
      const s = await ipc.runTool(which, kind, opId)
      setOp((o) => o && { ...o, running: false })
      toast({ type: 'success', message: `${TOOL_NAME[kind]} ${s.version ?? ''} 已安装` })
    } catch (e) {
      setOp((o) => o && { ...o, lines: [...o.lines, String(e)], running: false, failed: true })
      fail(e)
    } finally {
      unlisten()
      load()
      loadTools()
    }
  }

  const tool = (kind: ToolKind) => tools?.find((t) => t.kind === kind)
  const ops = (kind: ToolKind) => (
    <ToolActions tool={tool(kind)} busy={!!op?.running} onRun={(which) => runTool(kind, which)} />
  )
  const log = (kind: ToolKind) => (op?.kind === kind ? <ToolLog op={op} /> : null)

  return (
    <>
      <p className="dk-note">
        <Icon name="info" size={14} />
        <span>
          Agent 是本机安装的 CLI 运行时，决定能用哪些模型；Bot 是团队里的身份，认领后调用这里的某个 agent
          执行。
        </span>
      </p>
      <NodeCard tool={tool('node')} loaded={!!tools} actions={ops('node')} log={log('node')} />
      {agents ? null : <Skeleton variant="conversation" count={2} />}
      {agents?.map((a) => (
        <div key={a.kind} className="dk-agent">
          <Agent
            agent={a}
            tool={tool(a.kind)}
            loaded={!!tools}
            users={bots.filter((b) => b.agentKind === a.kind).map((b) => b.name)}
            checking={checking === a.kind}
            actions={ops(a.kind)}
            log={log(a.kind)}
            onRecheck={() => recheck(a.kind)}
            onPickPath={() => pickPath(a.kind)}
            onResetPath={() => ipc.resetAgentPath(a.kind).then(load, fail)}
          />
          {providers ? (
            <ProviderBox
              agent={a.kind}
              data={providers}
              onChange={loadProviders}
              onSwitch={switcher.request}
            />
          ) : null}
        </div>
      ))}
      {switcher.dialog}
    </>
  )
}

/** 安装 when missing, 升级 for a managed tool with an update, 安装共工托管版 next to the user's own install. */
function ToolActions({
  tool: t,
  busy,
  onRun,
}: {
  tool: ToolStatus | undefined
  busy: boolean
  onRun: (op: ToolOp) => void
}) {
  if (!t) return null
  const tooOld =
    t.kind === 'node' && t.installed && !!t.version && compareVersions(t.version, `${MIN_NODE}.0.0`) < 0
  if (!t.installed || tooOld) {
    return (
      <Button variant="primary" disabled={busy} onClick={() => onRun('install')}>
        安装
      </Button>
    )
  }
  if (t.managed) {
    return hasUpdate(t) ? (
      <Button variant="primary" disabled={busy} onClick={() => onRun('upgrade')}>
        升级到 {t.latest}
      </Button>
    ) : null
  }
  return (
    <Button disabled={busy} onClick={() => onRun('install')}>
      安装共工托管版
    </Button>
  )
}

function ToolLog({ op }: { op: Op }) {
  const [open, setOpen] = useState(true)
  const last = op.lines[op.lines.length - 1]
  const title = op.running ? '正在安装…' : op.failed ? '安装失败' : '安装完成'
  return (
    <div className="dk-row dk-toollog">
      <Disclosure title={title} summary={last} open={open} onToggle={setOpen}>
        <div className="dk-logpane" role="log" aria-label="安装日志">
          {op.lines.map((l, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: an append-only log
            <div key={i} className="dk-log">
              {l}
            </div>
          ))}
        </div>
      </Disclosure>
    </div>
  )
}

/** 版本 · 共工托管 / 自行安装 · 最新版本 rows of a detected tool. */
function toolRows(t: ToolStatus | undefined, loaded: boolean) {
  if (!loaded) return <GroupRow label="最新版本" wideValue value="检查中…" />
  if (!t?.installed) return null
  return (
    <>
      <GroupRow label="来源" wideValue value={t.managed ? '共工托管' : '自行安装'} />
      <GroupRow
        label="最新版本"
        wideValue
        value={
          <span className="dk-inline">
            {t.latest ?? '无法获取，请检查镜像源'}
            {hasUpdate(t) ? <Tag tone="orange">有更新</Tag> : null}
          </span>
        }
      />
    </>
  )
}

function Head({
  icon,
  active,
  title,
  badge,
  sub,
  children,
}: {
  icon: IconName
  active: boolean
  title: string
  badge: { tone: 'blue' | 'green' | 'orange' | 'red'; t: string }
  sub: string
  children?: ReactNode
}) {
  return (
    <div className="dk-row">
      <span
        className="dk-tile"
        style={{ background: active ? 'var(--system-purple)' : 'var(--system-gray)' }}
      >
        <Icon name={icon} size={16} />
      </span>
      <div className="dk-row__main">
        <span className="dk-row__title">
          <span className="dk-strong">{title}</span>
          <Tag tone={badge.tone}>{badge.t}</Tag>
        </span>
        <span className="dk-sub">{sub}</span>
      </div>
      {children}
    </div>
  )
}

function NodeCard({
  tool: t,
  loaded,
  actions,
  log,
}: {
  tool: ToolStatus | undefined
  loaded: boolean
  actions: ReactNode
  log: ReactNode
}) {
  const tooOld = !!t?.version && compareVersions(t.version, `${MIN_NODE}.0.0`) < 0
  const badge = !loaded
    ? { tone: 'blue' as const, t: '检测中' }
    : !t?.installed
      ? { tone: 'orange' as const, t: '未安装' }
      : tooOld
        ? { tone: 'red' as const, t: `版本过低 ${t.version}` }
        : { tone: 'green' as const, t: `已安装 ${t.version ?? ''}`.trim() }
  return (
    <GroupBox>
      <Head
        icon="bolt"
        active={!!t?.installed && !tooOld}
        title="Node.js"
        badge={badge}
        sub={`运行 ACP 适配器，托管安装 Claude Code / Codex 也用它（需 ≥ ${MIN_NODE}）`}
      >
        {actions}
      </Head>
      {t?.path ? (
        <GroupRow label="路径">
          <PathValue path={t.path} leaf="terminal" />
        </GroupRow>
      ) : null}
      {toolRows(t, loaded)}
      {loaded && (!t?.installed || tooOld) ? (
        <div className="dk-row dk-warn">
          <Icon name="warning" size={16} color="var(--system-orange)" />
          <span className="dk-row__main">
            {tooOld
              ? `系统的 Node.js ${t?.version} 低于 ${MIN_NODE}，ACP 适配器无法运行，请安装共工托管版（不影响系统的 Node.js）。`
              : `本机没有 Node.js ≥ ${MIN_NODE}。安装共工托管版到 ~/.gonggong/runtime，不影响系统环境。`}
          </span>
        </div>
      ) : null}
      {log}
    </GroupBox>
  )
}

function Agent({
  agent: a,
  tool,
  loaded,
  users,
  checking,
  actions,
  log,
  onRecheck,
  onPickPath,
  onResetPath,
}: {
  agent: AgentCard
  tool: ToolStatus | undefined
  loaded: boolean
  users: string[]
  checking: boolean
  actions: ReactNode
  log: ReactNode
  onRecheck: () => void
  onPickPath: () => void
  onResetPath: () => void
}) {
  const info = useDaemon((s) => s.info)
  const meta = AGENTS[a.kind]
  const adapter = info?.adapters.find((x) => x.kind === a.kind)
  const usedBy = users.length ? `被 ${users.join('、')} 使用` : '暂无 Bot 使用'
  const badge = checking
    ? { tone: 'blue' as const, t: '检测中' }
    : a.available
      ? { tone: 'green' as const, t: `已安装 ${a.version ?? ''}`.trim() }
      : { tone: 'orange' as const, t: '未安装' }
  const meets = !a.version || !a.minVersion || compareVersions(a.version, a.minVersion) >= 0

  return (
    <GroupBox>
      <Head
        icon={a.kind === 'claude' ? 'terminal' : 'square-terminal'}
        active={a.available}
        title={meta.name}
        badge={badge}
        sub={VENDOR[a.kind]}
      >
        {actions}
        <Button onClick={onRecheck} disabled={checking}>
          {checking ? '检测中…' : '重新检测'}
        </Button>
      </Head>
      {a.available ? (
        <>
          <GroupRow label="路径">{a.path ? <PathValue path={a.path} leaf="terminal" /> : null}</GroupRow>
          <GroupRow
            label="版本"
            wideValue
            value={
              meets ? (
                `${a.version} · 满足 ≥ ${a.minVersion}`
              ) : (
                <span className="dk-danger">{`${a.version} · 低于要求的 ≥ ${a.minVersion}`}</span>
              )
            }
          />
          {toolRows(tool, loaded)}
          <GroupRow label="登录" wideValue value={a.login ?? '未知'} />
          <GroupRow
            label="ACP 适配器"
            wideValue
            value={adapter ? `${adapter.version} · 随 daemon` : '随 daemon'}
          />
          <GroupRow
            label="可用模型"
            description="模型与推理强度在 Web 端为 Bot 设置"
            wideValue
            value={a.catalog ? a.catalog.models.map((m) => m.name).join('、') || '适配器未提供' : '检测中…'}
          />
          {log}
          <div className="dk-row">
            <span className="dk-row__main dk-sub">{usedBy}</span>
            {a.customPath ? <Button onClick={onResetPath}>恢复自动检测</Button> : null}
            <Button onClick={onPickPath}>更换路径…</Button>
          </div>
        </>
      ) : (
        <>
          <div className="dk-row dk-warn">
            <Icon name="warning" size={16} color="var(--system-orange)" />
            <span className="dk-row__main">
              本机未检测到 {meta.name}
              {a.path
                ? `（指定的路径 ${a.path} 不存在）`
                : '（已检查 PATH、~/.local/bin、/opt/homebrew/bin）'}
              。点「安装」从镜像源安装共工托管版，不需要管理员权限。
              {users.length
                ? `${users.join('、')} 依赖它，安装前收到的消息会被拒绝，并在群里提示发起人「执行机器缺少 ${meta.name}」。`
                : ''}
            </span>
          </div>
          {log}
          <div className="dk-row">
            <span className="dk-row__main dk-sub">{usedBy}</span>
            {a.customPath ? <Button onClick={onResetPath}>恢复自动检测</Button> : null}
            <Button onClick={onPickPath}>手动指定路径…</Button>
            <Button onClick={onRecheck} disabled={checking}>
              已安装，重新检测
            </Button>
          </div>
        </>
      )}
    </GroupBox>
  )
}
