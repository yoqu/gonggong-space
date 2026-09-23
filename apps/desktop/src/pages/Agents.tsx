import { type AgentKind, compareVersions } from '@aiws/protocol'
import { Badge, Button, Select, Tabs, toast } from '@web/ui'
import { Info, SquareTerminal, Terminal, TriangleAlert } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useState } from 'react'
import { type AgentCard, type BotCard, ipc } from '../ipc'
import { AGENTS, effortLabel, modelName, tildify, VENDOR } from '../lib/labels'
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
      <div className="dk-note">
        <Info size={13} />
        <span>
          Agent 是本机安装的 CLI 运行时，决定能用哪些模型；Bot 是团队里的身份，认领后调用这里的某个 agent
          执行。
        </span>
      </div>
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
  const Icon = a.kind === 'claude' ? Terminal : SquareTerminal
  const usedBy = users.length ? `被 ${users.join('、')} 使用` : '暂无 bot 使用'
  const badge = checking
    ? { v: 'info' as const, t: '检测中' }
    : a.available
      ? { v: 'success' as const, t: `已安装 ${a.version ?? ''}`.trim() }
      : { v: 'warning' as const, t: '未安装' }
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
    <div className={`dk-agent${a.available ? '' : ' dk-agent--missing'}`}>
      <div className="dk-agent__head">
        <div className="dk-agent__icon">
          <Icon size={15} />
        </div>
        <div className="dk-row__main dk-agent__title">
          <span className="dk-agent__name">{meta.name}</span>
          <span className="dk-sub">{VENDOR[a.kind]}</span>
        </div>
        <Badge variant={badge.v}>{badge.t}</Badge>
        <span className="dk-flex" />
        <Button variant="ghost" size="sm" onClick={onRecheck} disabled={checking}>
          {checking ? '检测中…' : '重新检测'}
        </Button>
      </div>
      {a.available ? (
        <>
          <div className="dk-agent__section dk-grid4">
            <Meta k="路径" mono>
              {tildify(a.path ?? '')}
            </Meta>
            <Meta k="版本">
              {meets
                ? `${a.version} · 满足 ≥ ${a.minVersion}`
                : `${a.version} · 低于要求的 ≥ ${a.minVersion}`}
            </Meta>
            <Meta k="登录">{a.login ?? '未知'}</Meta>
            <Meta k="ACP 适配器">{adapter ? `${adapter.version} · 随 daemon` : '随 daemon'}</Meta>
          </div>
          <div className="dk-agent__section dk-split">
            <div className="dk-field">
              <span className="dk-field__label">默认模型 · bot 未单独指定时使用</span>
              {a.catalog?.models.length ? (
                <Select
                  label="默认模型"
                  options={modelOptions(a)}
                  value={a.defaultModel ?? ''}
                  onChange={setModel}
                />
              ) : (
                <span className="dk-hint">运行一次后显示可用模型</span>
              )}
            </div>
            <div className="dk-field">
              <span className="dk-field__label">{a.kind === 'claude' ? '扩展思考' : '推理强度'}</span>
              {a.catalog?.efforts.length ? (
                <Tabs size="sm" items={effortItems(a)} value={a.effort ?? ''} onChange={setEffort} />
              ) : (
                <span className="dk-hint">运行一次后显示可用模型</span>
              )}
            </div>
          </div>
          <div className="dk-agent__foot">
            <span className="dk-flex">{usedBy}</span>
            {a.customPath ? (
              <Button variant="ghost" size="xs" onClick={onResetPath}>
                恢复自动检测
              </Button>
            ) : null}
            <Button variant="ghost" size="xs" onClick={onPickPath}>
              更换路径
            </Button>
          </div>
        </>
      ) : (
        <div className="dk-agent__section dk-stack">
          <div className="dk-warn">
            <TriangleAlert size={13} />
            <span>
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
          <div className="dk-field">
            <span className="dk-field__label">安装命令</span>
            <div className="dk-install">
              <span className="dk-install__cmd">{meta.install}</span>
              <Button variant="ghost" size="xs" onClick={copy}>
                {copied ? '已复制' : '复制'}
              </Button>
            </div>
          </div>
          <div className="dk-inline">
            <Button variant="primary" size="sm" onClick={onRecheck} disabled={checking}>
              已安装，重新检测
            </Button>
            <Button variant="outline" size="sm" onClick={onPickPath}>
              手动指定路径
            </Button>
            {a.customPath ? (
              <Button variant="ghost" size="sm" onClick={onResetPath}>
                恢复自动检测
              </Button>
            ) : null}
            <span className="dk-flex" />
            <span className="dk-sub">{usedBy}</span>
          </div>
        </div>
      )}
    </div>
  )
}

function Meta({ k, mono, children }: { k: string; mono?: boolean; children: ReactNode }) {
  return (
    <div className="dk-meta">
      <span className="dk-meta__k">{k}</span>
      <span className={mono ? 'dk-meta__v dk-mono' : 'dk-meta__v'}>{children}</span>
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
