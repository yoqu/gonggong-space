import type { AgentKind, BotDto, BotOwnerDto, MachineDto, UserDto } from '@aiws/protocol'
import { CircleCheck, Clock, Info, TriangleAlert, UserCheck } from 'lucide-react'
import { type ReactNode, useEffect, useId, useState } from 'react'
import { useWorkspace } from '../../app/workspace'
import { api } from '../../lib/api'
import { cx } from '../../lib/cx'
import { Button, Dialog, Input, Spinner, Textarea, toast } from '../../ui'
import { AGENT_LABEL, AGENTS, BINDING_LABEL, botsApi, reportedAgent } from './model'

interface Props {
  me: UserDto
  onClose: () => void
  onCreated: (bot: BotDto) => void
}

interface Draft {
  ownerId: string
  machineId: string | null
  agent: AgentKind
  name: string
  touched: boolean
  prompt: string
}

const TONE = {
  pending: { icon: Clock, color: '#8E8E93' },
  warn: { icon: TriangleAlert, color: '#FF9F0A' },
  ok: { icon: CircleCheck, color: '#32D74B' },
  confirm: { icon: UserCheck, color: '#0A84FF' },
}

const autoName = (owner: BotOwnerDto, agent: AgentKind) => `${owner.name}的 ${AGENT_LABEL[agent]}`

function draftFor(owner: BotOwnerDto, machines: MachineDto[], prompt = ''): Draft {
  const m = machines[0]
  const agent = (m && AGENTS.find((k) => reportedAgent(m, k))) || 'claude'
  return {
    ownerId: owner.id,
    machineId: m?.id ?? null,
    agent,
    name: autoName(owner, agent),
    touched: false,
    prompt,
  }
}

function Shell({ onClose, cta, children }: { onClose: () => void; cta?: ReactNode; children: ReactNode }) {
  return (
    <Dialog
      open
      width={520}
      title="新建 bot"
      subtitle="创建时直接绑定到归属人的机器"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            关闭
          </Button>
          {cta ?? (
            <Button variant="primary" disabled>
              创建
            </Button>
          )}
        </>
      }
    >
      {children}
    </Dialog>
  )
}

/** 新建 bot (管理后台.dc.html): owner → machine → agent → name/prompt, previewing the resulting binding. */
export function NewBotDialog({ me, onClose, onCreated }: Props) {
  const [owners, setOwners] = useState<BotOwnerDto[] | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const live = useWorkspace((s) => s.machines)
  const nameId = useId()
  const promptId = useId()

  // Own machines come from the live store, so a daemon that just connected shows its agents right away.
  const machinesOf = (o: BotOwnerDto) => {
    const byId = new Map(o.machines.map((m) => [m.id, m]))
    for (const m of live) if (m.ownerId === o.id) byId.set(m.id, m)
    return [...byId.values()]
  }

  useEffect(() => {
    api
      .get<BotOwnerDto[]>('/bots/owners')
      .then((list) => {
        const sorted = [...list].sort((a, b) => Number(b.id === me.id) - Number(a.id === me.id))
        setOwners(sorted)
        if (sorted[0]) setDraft(draftFor(sorted[0], sorted[0].machines))
      })
      .catch((e: Error) => toast({ type: 'error', message: e.message }))
  }, [me.id])

  const owner = owners?.find((o) => o.id === draft?.ownerId)
  if (!owners || !draft || !owner)
    return (
      <Shell onClose={onClose}>
        <div className="newbot__loading">
          <Spinner />
        </div>
      </Shell>
    )

  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch })
  const named = (agent: AgentKind) => (draft.touched ? {} : { name: autoName(owner, agent) })
  const machines = machinesOf(owner)
  const m = machines.find((x) => x.id === draft.machineId)
  const self = owner.id === me.id
  const ver = m && reportedAgent(m, draft.agent)
  const agentName = AGENT_LABEL[draft.agent]
  const result = !m
    ? {
        tone: TONE.pending,
        title: '待绑定',
        desc: `${owner.name} 绑定第一台机器并上报 ${agentName} 后自动绑定，无需再操作；此前不能被触发。`,
      }
    : !ver
      ? {
          tone: TONE.warn,
          title: '绑定后暂不可用',
          desc: `${m.name} 未上报 ${agentName}。在该机器安装并重新检测后自动可用。`,
        }
      : self
        ? {
            tone: TONE.ok,
            title: '创建后立即可用',
            desc: `绑定到 ${m.name} · ${agentName} ${ver.version ?? ''}，可直接拉入群触发。${m.online ? '' : '机器当前离线，上线后开始执行。'}`,
          }
        : {
            tone: TONE.confirm,
            title: `等待 ${owner.name} 确认`,
            desc: `已绑定到 ${m.name}。机器上的操作由主人负责，${owner.name} 在 daemon 或 Web 通知中一键确认后即可触发。`,
          }
  const Icon = result.tone.icon
  const tinted = result.tone !== TONE.pending

  const create = async () => {
    setBusy(true)
    try {
      const bot = await botsApi.create({
        name: draft.name.trim(),
        ownerId: owner.id,
        agentKind: draft.agent,
        machineId: m?.id ?? null,
        systemPrompt: draft.prompt,
      })
      toast({ type: 'success', message: `${bot.name} 已创建 · ${BINDING_LABEL[bot.binding]}` })
      onCreated(bot)
      onClose()
    } catch (e) {
      toast({ type: 'error', message: (e as Error).message })
      setBusy(false)
    }
  }

  return (
    <Shell
      onClose={onClose}
      cta={
        <Button variant="primary" disabled={!draft.name.trim() || busy} onClick={() => void create()}>
          {!m ? '创建' : self ? '创建并绑定' : '创建并发送确认'}
        </Button>
      }
    >
      <div className="newbot">
        <section className="newbot__field">
          <span className="newbot__label">归属人</span>
          <div className="newbot__chips">
            {owners.map((o) => (
              <button
                key={o.id}
                type="button"
                className={cx('newbot__chip', o.id === owner.id && 'is-selected')}
                onClick={() => setDraft(draftFor(o, machinesOf(o), draft.prompt))}
              >
                {o.name}
                <span className="newbot__sub">{o.id === me.id ? '我' : `${machinesOf(o).length} 台`}</span>
              </button>
            ))}
          </div>
          <span className="newbot__hint">系统管理员可为任何人创建；成员本人只能为自己创建。</span>
        </section>

        <section className="newbot__field">
          <span className="newbot__label">执行机器</span>
          {machines.map((x) => (
            <button
              key={x.id}
              type="button"
              className={cx('newbot__card', x.id === m?.id && 'is-selected')}
              onClick={() => {
                const agent = reportedAgent(x, draft.agent)
                  ? draft.agent
                  : (AGENTS.find((k) => reportedAgent(x, k)) ?? draft.agent)
                set({ machineId: x.id, agent, ...named(agent) })
              }}
            >
              <span className="newbot__radio" />
              <span className="newbot__mono">{x.name}</span>
              <span className="newbot__muted">{x.os}</span>
              <span className="spacer" />
              <span className="newbot__status">
                <span className="dot dot--sm" style={{ background: x.online ? '#32D74B' : '#636366' }} />
                {x.online ? '在线' : '离线'}
              </span>
            </button>
          ))}
          {machines.length ? null : (
            <div className="newbot__note">
              <Info size={13} className="muted-icon" />
              <span>{owner.name} 还没有绑定机器。bot 会以「待绑定」创建，可先选 agent 种类。</span>
            </div>
          )}
        </section>

        <section className="newbot__field">
          <span className="newbot__label">Agent · 该机器上报</span>
          <div className="newbot__agents">
            {AGENTS.map((k) => {
              const v = m && reportedAgent(m, k)
              return (
                <button
                  key={k}
                  type="button"
                  disabled={!!m && !v}
                  className={cx('newbot__card', draft.agent === k && 'is-selected')}
                  onClick={() => set({ agent: k, ...named(k) })}
                >
                  <span className="newbot__radio" />
                  <span className="newbot__agent">{AGENT_LABEL[k]}</span>
                  <span className={cx('newbot__ver', m && !v && 'is-missing')}>
                    {!m ? '种类' : v ? (v.version ?? '已安装') : '未安装'}
                  </span>
                </button>
              )
            })}
          </div>
        </section>

        <section className="newbot__field">
          <label className="newbot__label" htmlFor={nameId}>
            名称
          </label>
          <Input
            id={nameId}
            value={draft.name}
            onChange={(e) => set({ name: e.target.value, touched: true })}
          />
        </section>

        <section className="newbot__field">
          <label className="newbot__label" htmlFor={promptId}>
            系统提示词 · 同时作为群内简介
          </label>
          <Textarea
            id={promptId}
            rows={3}
            value={draft.prompt}
            placeholder="后端接口开发，只改 server/ 目录"
            onChange={(e) => set({ prompt: e.target.value })}
          />
        </section>

        <div
          className="newbot__result"
          style={
            tinted
              ? { borderColor: `${result.tone.color}40`, background: `${result.tone.color}14` }
              : undefined
          }
        >
          <Icon size={13} color={result.tone.color} className="newbot__result-icon" />
          <div>
            <div className="newbot__result-title">{result.title}</div>
            <div className="newbot__result-desc">{result.desc}</div>
          </div>
        </div>
      </div>
    </Shell>
  )
}
