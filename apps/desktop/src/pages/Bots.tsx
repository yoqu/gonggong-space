import type { AgentKind } from '@gonggong/protocol'
import { Badge, type BadgeVariant, Button, Dialog, EmptyState, Input, Tabs, toast } from '@web/ui'
import { Bot, TriangleAlert, X } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useState } from 'react'
import { type AgentCard, type Approval, type BotCard, ipc } from '../ipc'
import { AGENTS, APPROVAL, agentDefault, modelName } from '../lib/labels'
import type { PageProps } from '.'

const fail = (e: unknown) => toast({ type: 'error', message: String(e) })
const KINDS: AgentKind[] = ['claude', 'codex']
const CONCURRENCY = ['1', '2', '3', '4']

function status(b: BotCard, agent: AgentCard | undefined): { text: string; variant: BadgeVariant } {
  if (b.binding === 'pending_confirm') return { text: '待确认', variant: 'warning' }
  if (!agent?.available || b.presence === 'agent_missing')
    return { text: 'agent 缺失', variant: 'destructive' }
  if (b.presence === 'running') return { text: '运行中', variant: 'info' }
  if (b.presence === 'online') return { text: '在线', variant: 'success' }
  return { text: '离线', variant: 'secondary' }
}

export function BotsPage({ go }: PageProps) {
  const [bots, setBots] = useState<BotCard[] | null>(null)
  const [agents, setAgents] = useState<AgentCard[]>([])
  const [editing, setEditing] = useState<BotCard | null>(null)

  const load = useCallback(() => ipc.bots().then(setBots, fail), [])
  useEffect(() => {
    load()
    ipc.agents().then(setAgents, fail)
  }, [load])

  const confirm = async (b: BotCard) => {
    try {
      await ipc.confirmBots([b.id])
      toast({ type: 'success', message: `${b.name} 已确认` })
      await load()
    } catch (e) {
      fail(e)
    }
  }

  const agentOf = (b: BotCard) => agents.find((a) => a.kind === b.agentKind)

  return (
    <>
      {bots?.length === 0 ? <EmptyState title="本机还没有 Bot" /> : null}
      {bots?.map((b) => {
        const agent = agentOf(b)
        const badge = status(b, agent)
        const pending = b.binding === 'pending_confirm'
        const missing = !agent?.available
        const name = AGENTS[b.agentKind].name
        return (
          <div key={b.id} className="dk-card dk-bot">
            <div className="dk-run__head">
              <Bot size={15} className="dk-bot__icon" />
              <span className="dk-agent__name">{b.name}</span>
              <Badge variant={badge.variant}>{badge.text}</Badge>
              {pending ? <span className="dk-sub">他人为你创建</span> : null}
              <span className="dk-flex" />
              {pending ? (
                <Button variant="primary" size="sm" onClick={() => confirm(b)}>
                  确认
                </Button>
              ) : null}
              <Button variant="outline" size="sm" onClick={() => setEditing(b)}>
                设置
              </Button>
            </div>
            <div className="dk-grid4">
              <Meta k="Agent" warn={missing}>
                {missing ? `${name} · 未安装` : `${name} ${agent?.version ?? ''}`.trim()}
              </Meta>
              <Meta k="模型">
                {b.model ? modelName(agent, b.model) : `${agentDefault(agent)} · 跟随默认`}
              </Meta>
              <Meta k="并发上限">{b.concurrency}</Meta>
              <Meta k="命令审批">{APPROVAL[b.approval]}</Meta>
            </div>
            {missing ? (
              <div className="dk-warn">
                <TriangleAlert size={12} />
                <span className="dk-flex">本机未安装 {name}，该 Bot 暂不能执行</span>
                <Button variant="ghost" size="xs" onClick={() => go('agents')}>
                  前往 Agent
                </Button>
              </div>
            ) : pending ? (
              <div className="dk-warn dk-warn--muted">
                <TriangleAlert size={12} />
                <span>他人为你创建并指定到本机，确认后才能被触发</span>
              </div>
            ) : null}
          </div>
        )
      })}
      <div className="dk-hint">
        Bot 的名称、角色说明、MCP 与所属群在 Web 端管理；这里只配置它在本机的执行方式：用哪个
        agent、哪个模型、并发与审批。
      </div>
      {editing ? (
        <BotDialog
          bot={editing}
          agents={agents}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            load()
          }}
        />
      ) : null}
    </>
  )
}

function Meta({ k, warn, children }: { k: string; warn?: boolean; children: ReactNode }) {
  return (
    <div className="dk-meta">
      <span className="dk-meta__k">{k}</span>
      <span className={warn ? 'dk-meta__v dk-meta__v--warn' : 'dk-meta__v'}>{children}</span>
    </div>
  )
}

function Choice({
  checked,
  disabled,
  onPick,
  label,
  extra,
}: {
  checked: boolean
  disabled?: boolean
  onPick?: () => void
  label: ReactNode
  extra?: ReactNode
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a full-width option row; a native radio cannot carry this layout
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      className="dk-choice"
      onClick={onPick}
    >
      <span className="dk-choice__ring" />
      <span className="dk-flex">{label}</span>
      {extra ? <span className="dk-choice__extra">{extra}</span> : null}
    </button>
  )
}

function BotDialog({
  bot,
  agents,
  onClose,
  onSaved,
}: {
  bot: BotCard
  agents: AgentCard[]
  onClose: () => void
  onSaved: () => void
}) {
  const [model, setModel] = useState(bot.model)
  const [concurrency, setConcurrency] = useState(String(bot.concurrency))
  const [approval, setApproval] = useState<Approval>(bot.approval)
  const [allowlist, setAllowlist] = useState(bot.allowlist)
  const [prefix, setPrefix] = useState('')
  const [saving, setSaving] = useState(false)
  const agent = agents.find((a) => a.kind === bot.agentKind)
  const models = (agent?.catalog?.models ?? []).filter((m) => m.value !== 'default')
  const custom = model && !models.some((m) => m.value === model) ? [{ value: model, name: model }] : []
  const concurrencies = CONCURRENCY.includes(String(bot.concurrency))
    ? CONCURRENCY
    : [...CONCURRENCY, String(bot.concurrency)]

  const add = () => {
    const p = prefix.trim().replace(/\s+/g, ' ')
    if (p && !allowlist.includes(p)) setAllowlist([...allowlist, p])
    setPrefix('')
  }

  const save = async () => {
    setSaving(true)
    try {
      const n = Number(concurrency)
      await ipc.saveBot(bot.id, {
        model,
        approval,
        allowlist,
        concurrency: n === bot.concurrency ? null : n,
      })
      toast({ type: 'success', message: `${bot.name} 设置已保存` })
      onSaved()
    } catch (e) {
      fail(e)
      setSaving(false)
    }
  }

  return (
    <Dialog
      open
      width={480}
      onClose={onClose}
      title={`${bot.name} · 本机设置`}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            关闭
          </Button>
          <Button variant="primary" size="sm" onClick={save} disabled={saving}>
            保存
          </Button>
        </>
      }
    >
      <div className="dk-form">
        <div className="dk-field" role="radiogroup" aria-label="使用 agent">
          <span className="dk-field__title">使用 agent</span>
          {KINDS.map((kind) => {
            const a = agents.find((x) => x.kind === kind)
            return (
              <Choice
                key={kind}
                checked={bot.agentKind === kind}
                disabled={bot.agentKind !== kind}
                label={<span className="dk-strong">{AGENTS[kind].name}</span>}
                extra={a?.available ? a.version : '未安装 · 先在 Agent 页安装'}
              />
            )
          })}
          <span className="dk-hint">
            Bot 使用哪个 agent 由 Web 端设定。切换 agent 会结束该 Bot
            在各群的会话上下文，下一轮重新开始；工作区与文件不受影响。
          </span>
        </div>
        <div className="dk-field" role="radiogroup" aria-label="模型">
          <span className="dk-field__title">模型</span>
          <Choice
            checked={model === null}
            onPick={() => setModel(null)}
            label={`跟随 agent 默认 · ${agentDefault(agent)}`}
          />
          {[...models, ...custom].map((m) => (
            <Choice
              key={m.value}
              checked={model === m.value}
              onPick={() => setModel(m.value)}
              label={m.name}
              extra={<span className="dk-mono">{m.value}</span>}
            />
          ))}
          {models.length ? null : <span className="dk-hint">运行一次后显示可用模型</span>}
        </div>
        <div className="dk-split dk-split--wide">
          <div className="dk-field">
            <span className="dk-field__title">并发上限</span>
            <Tabs
              size="sm"
              items={concurrencies.map((v) => ({ value: v, label: v }))}
              value={concurrency}
              onChange={setConcurrency}
            />
          </div>
          <div className="dk-field">
            <span className="dk-field__title">命令审批</span>
            <Tabs
              size="sm"
              items={(Object.keys(APPROVAL) as Approval[]).map((v) => ({ value: v, label: APPROVAL[v] }))}
              value={approval}
              onChange={setApproval}
            />
          </div>
        </div>
        {approval === 'allowlist' ? (
          <div className="dk-field">
            <span className="dk-field__title">命令白名单</span>
            {allowlist.length ? (
              <div className="dk-chips">
                {allowlist.map((c) => (
                  <span key={c} className="dk-chip">
                    <span className="dk-mono">{c}</span>
                    <button
                      type="button"
                      aria-label={`移除 ${c}`}
                      onClick={() => setAllowlist(allowlist.filter((x) => x !== c))}
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            <div className="dk-inline">
              <Input
                size="sm"
                mono
                value={prefix}
                placeholder="命令前缀，如 go build"
                onChange={(e) => setPrefix(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') add()
                }}
              />
              <Button variant="outline" size="sm" onClick={add}>
                添加
              </Button>
            </div>
            <span className="dk-hint">
              以这些前缀开头的单条命令自动批准；含 &&、;、| 等组合或重定向的命令仍需你审批。
            </span>
          </div>
        ) : null}
        <span className="dk-hint">
          {agent?.available
            ? '模型与审批在该 Bot 下一轮运行时生效；并发上限保存到服务器。'
            : '当前 agent 未安装。模型与审批可先保存，安装并检测通过后生效。'}
        </span>
      </div>
    </Dialog>
  )
}
