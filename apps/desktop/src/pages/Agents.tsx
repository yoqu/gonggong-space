import { type AgentKind, compareVersions } from '@gonggong/protocol'
import {
  Button,
  GroupBox,
  GroupRow,
  Icon,
  PopUpButton,
  SegmentedControl,
  Skeleton,
  Tag,
  toast,
} from '@web/ui'
import { useCallback, useEffect, useState } from 'react'
import { type AgentCard, type BotCard, ipc } from '../ipc'
import { AGENTS, effortLabel, modelName, VENDOR } from '../lib/labels'
import { PathValue } from '../lib/ui'
import { useDaemon } from '../store'
import type { PageProps } from '.'

const fail = (e: unknown) => toast({ type: 'error', message: String(e) })

export function AgentsPage(_: PageProps) {
  const [agents, setAgents] = useState<AgentCard[] | null>(null)
  const [bots, setBots] = useState<BotCard[]>([])
  const [checking, setChecking] = useState<AgentKind | null>(null)

  const load = useCallback(() => ipc.agents().then(setAgents, fail), [])
  useEffect(() => {
    load()
    ipc.bots().then(setBots, () => {})
  }, [load])

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

  const update = (kind: AgentKind, patch: Partial<AgentCard>) =>
    setAgents((list) => list?.map((a) => (a.kind === kind ? { ...a, ...patch } : a)) ?? null)

  const pickPath = async (kind: AgentKind) => {
    try {
      if (await ipc.pickAgentPath(kind)) await load()
    } catch (e) {
      fail(e)
    }
  }

  return (
    <>
      <p className="dk-note">
        <Icon name="info" size={14} />
        <span>
          Agent 是本机安装的 CLI 运行时，决定能用哪些模型；Bot 是团队里的身份，认领后调用这里的某个 agent
          执行。
        </span>
      </p>
      {agents ? null : <Skeleton variant="conversation" count={2} />}
      {agents?.map((a) => (
        <Agent
          key={a.kind}
          agent={a}
          users={bots.filter((b) => b.agentKind === a.kind).map((b) => b.name)}
          checking={checking === a.kind}
          onRecheck={() => recheck(a.kind)}
          onPickPath={() => pickPath(a.kind)}
          onResetPath={() => ipc.resetAgentPath(a.kind).then(load, fail)}
          onChange={(patch) => update(a.kind, patch)}
        />
      ))}
    </>
  )
}

function Agent({
  agent: a,
  users,
  checking,
  onRecheck,
  onPickPath,
  onResetPath,
  onChange,
}: {
  agent: AgentCard
  users: string[]
  checking: boolean
  onRecheck: () => void
  onPickPath: () => void
  onResetPath: () => void
  onChange: (patch: Partial<AgentCard>) => void
}) {
  const info = useDaemon((s) => s.info)
  const meta = AGENTS[a.kind]
  const adapter = info?.adapters.find((x) => x.kind === a.kind)
  const [copied, setCopied] = useState(false)
  const usedBy = users.length ? `被 ${users.join('、')} 使用` : '暂无 Bot 使用'
  const badge = checking
    ? { tone: 'blue' as const, t: '检测中' }
    : a.available
      ? { tone: 'green' as const, t: `已安装 ${a.version ?? ''}`.trim() }
      : { tone: 'orange' as const, t: '未安装' }
  const meets = !a.version || !a.minVersion || compareVersions(a.version, a.minVersion) >= 0

  const setModel = async (value: string) => {
    const model = value || null
    try {
      await ipc.setAgentModel(a.kind, model)
      onChange({ defaultModel: model })
      toast({ type: 'success', message: `${meta.name} 默认模型已设为 ${modelLabel(a, model)}` })
    } catch (e) {
      fail(e)
    }
  }
  const setEffort = async (value: string) => {
    const effort = value || null
    try {
      await ipc.setAgentEffort(a.kind, effort)
      onChange({ effort })
    } catch (e) {
      fail(e)
    }
  }
  const copy = async () => {
    await navigator.clipboard.writeText(meta.install)
    setCopied(true)
    toast({ type: 'success', message: '安装命令已复制' })
  }

  return (
    <div className="dk-agent">
      <GroupBox>
        <div className="dk-row">
          <span
            className="dk-tile"
            style={{ background: a.available ? 'var(--system-purple)' : 'var(--system-gray)' }}
          >
            <Icon name={a.kind === 'claude' ? 'terminal' : 'square-terminal'} size={16} />
          </span>
          <div className="dk-row__main">
            <span className="dk-row__title">
              <span className="dk-strong">{meta.name}</span>
              <Tag tone={badge.tone}>{badge.t}</Tag>
            </span>
            <span className="dk-sub">{VENDOR[a.kind]}</span>
          </div>
          <Button onClick={onRecheck} disabled={checking}>
            {checking ? '检测中…' : '重新检测'}
          </Button>
        </div>
        {a.available ? (
          <>
            <GroupRow label="路径">{a.path ? <PathValue path={a.path} leaf="terminal" /> : null}</GroupRow>
            <GroupRow
              label="版本"
              value={
                meets ? (
                  `${a.version} · 满足 ≥ ${a.minVersion}`
                ) : (
                  <span className="dk-danger">{`${a.version} · 低于要求的 ≥ ${a.minVersion}`}</span>
                )
              }
            />
            <GroupRow label="登录" value={a.login ?? '未知'} />
            <GroupRow label="ACP 适配器" value={adapter ? `${adapter.version} · 随 daemon` : '随 daemon'} />
            <GroupRow label="默认模型" description="Bot 未单独指定时使用">
              {a.catalog?.models.length ? (
                <PopUpButton
                  aria-label="默认模型"
                  options={modelOptions(a)}
                  value={a.defaultModel ?? ''}
                  onChange={setModel}
                />
              ) : (
                <span className="dk-sub">运行一次后显示可用模型</span>
              )}
            </GroupRow>
            <GroupRow label={a.kind === 'claude' ? '扩展思考' : '推理强度'}>
              {a.catalog?.efforts.length ? (
                <SegmentedControl
                  aria-label={a.kind === 'claude' ? '扩展思考' : '推理强度'}
                  items={effortItems(a)}
                  value={a.effort ?? ''}
                  onChange={setEffort}
                />
              ) : (
                <span className="dk-sub">运行一次后显示可用模型</span>
              )}
            </GroupRow>
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
                。
                {users.length
                  ? `${users.join('、')} 依赖它，安装前收到的消息会被拒绝，并在群里提示发起人「执行机器缺少 ${meta.name}」。`
                  : ''}
              </span>
            </div>
            <GroupRow label="安装命令">
              <span className="dk-install">
                <code className="dk-install__cmd">{meta.install}</code>
                <Button onClick={copy}>{copied ? '已复制' : '复制'}</Button>
              </span>
            </GroupRow>
            <div className="dk-row">
              <span className="dk-row__main dk-sub">{usedBy}</span>
              {a.customPath ? <Button onClick={onResetPath}>恢复自动检测</Button> : null}
              <Button onClick={onPickPath}>手动指定路径…</Button>
              <Button variant="primary" onClick={onRecheck} disabled={checking}>
                已安装，重新检测
              </Button>
            </div>
          </>
        )}
      </GroupBox>
    </div>
  )
}

function modelLabel(a: AgentCard, model: string | null) {
  return model ? modelName(a, model) : adapterDefault(a)
}

function adapterDefault(a: AgentCard) {
  const current = a.catalog?.current
  return current ? `适配器默认（${modelName(a, current)}）` : '适配器默认'
}

/** '' = no default of our own. The adapter's `default` entry is that same choice. */
function modelOptions(a: AgentCard) {
  const models = (a.catalog?.models ?? []).filter((m) => m.value !== 'default')
  const custom = a.defaultModel && !models.some((m) => m.value === a.defaultModel) ? [a.defaultModel] : []
  return [
    { value: '', label: adapterDefault(a) },
    ...models.map((m) => ({ value: m.value, label: m.name })),
    ...custom.map((value) => ({ value, label: value })),
  ]
}

function effortItems(a: AgentCard) {
  const levels = (a.catalog?.efforts ?? []).map((e) => e.value).filter((v) => v !== 'default')
  return [{ value: '', label: '默认' }, ...levels.map((value) => ({ value, label: effortLabel(value) }))]
}
