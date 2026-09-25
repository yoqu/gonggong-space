import type { AgentKind } from '@gonggong/protocol'
import {
  Button,
  Dialog,
  EmptyState,
  GroupBox,
  Icon,
  Input,
  RadioGroup,
  SegmentedControl,
  Tag,
  type TagTone,
  toast,
} from '@web/ui'
import { useCallback, useEffect, useState } from 'react'
import { type AgentCard, type Approval, type BotCard, ipc } from '../ipc'
import { AGENTS, APPROVAL, agentDefault, modelName } from '../lib/labels'
import { Meta } from '../lib/ui'
import type { PageProps } from '.'

const fail = (e: unknown) => toast({ type: 'error', message: String(e) })
const KINDS: AgentKind[] = ['claude', 'codex']
const CONCURRENCY = ['1', '2', '3', '4']

function status(b: BotCard, agent: AgentCard | undefined): { text: string; tone: TagTone } {
  if (b.binding === 'pending_confirm') return { text: '待确认', tone: 'orange' }
  if (!agent?.available || b.presence === 'agent_missing') return { text: 'agent 缺失', tone: 'red' }
  if (b.presence === 'running') return { text: '运行中', tone: 'blue' }
  if (b.presence === 'online') return { text: '在线', tone: 'green' }
  return { text: '离线', tone: 'gray' }
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
          <div key={b.id} className="dk-bot">
            <GroupBox>
              <div className="dk-row">
                <span className="dk-tile" style={{ background: 'var(--system-indigo)' }}>
                  <Icon name="bot" size={16} />
                </span>
                <div className="dk-row__main">
                  <span className="dk-row__title">
                    <span className="dk-strong">{b.name}</span>
                    <Tag tone={badge.tone}>{badge.text}</Tag>
                  </span>
                  {pending ? <span className="dk-sub">他人为你创建</span> : null}
                </div>
                {pending ? (
                  <Button variant="primary" onClick={() => confirm(b)}>
                    确认
                  </Button>
                ) : null}
                <Button onClick={() => setEditing(b)}>设置…</Button>
              </div>
              <div className="dk-row dk-grid4">
                <Meta k="Agent">
                  {missing ? (
                    <span className="dk-danger">{`${name} · 未安装`}</span>
                  ) : (
                    `${name} ${agent?.version ?? ''}`.trim()
                  )}
                </Meta>
                <Meta k="模型">
                  {b.model ? modelName(agent, b.model) : `${agentDefault(agent)} · 跟随默认`}
                </Meta>
                <Meta k="并发上限">{b.concurrency}</Meta>
                <Meta k="命令审批">{APPROVAL[b.approval]}</Meta>
              </div>
              {missing ? (
                <div className="dk-row dk-warn">
                  <Icon name="warning" size={16} color="var(--system-red)" />
                  <span className="dk-row__main">本机未安装 {name}，该 Bot 暂不能执行</span>
                  <Button onClick={() => go('agents')}>前往 Agent</Button>
                </div>
              ) : pending ? (
                <div className="dk-row dk-warn">
                  <Icon name="warning" size={16} color="var(--system-orange)" />
                  <span className="dk-row__main">他人为你创建并指定到本机，确认后才能被触发</span>
                </div>
              ) : null}
            </GroupBox>
          </div>
        )
      })}
      <p className="dk-footnote">
        Bot 的名称、角色说明、MCP 与所属群在 Web 端管理；这里只配置它在本机的执行方式：用哪个
        agent、哪个模型、并发与审批。
      </p>
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
          <Button onClick={onClose}>关闭</Button>
          <Button variant="primary" onClick={save} disabled={saving}>
            保存
          </Button>
        </>
      }
    >
      <div className="dk-form">
        <div className="dk-field">
          <span className="dk-field__title">使用 agent</span>
          <RadioGroup
            aria-label="使用 agent"
            value={bot.agentKind}
            options={KINDS.map((kind) => {
              const a = agents.find((x) => x.kind === kind)
              return {
                value: kind,
                disabled: bot.agentKind !== kind,
                label: (
                  <span className="dk-choice">
                    <span>{AGENTS[kind].name}</span>
                    <span className="dk-sub">{a?.available ? a.version : '未安装 · 先在 Agent 页安装'}</span>
                  </span>
                ),
              }
            })}
          />
          <span className="dk-sub">
            Bot 使用哪个 agent 由 Web 端设定。切换 agent 会结束该 Bot
            在各群的会话上下文，下一轮重新开始；工作区与文件不受影响。
          </span>
        </div>
        <div className="dk-field">
          <span className="dk-field__title">模型</span>
          <RadioGroup
            aria-label="模型"
            value={model ?? ''}
            onChange={(v) => setModel(v || null)}
            options={[
              { value: '', label: `跟随 agent 默认 · ${agentDefault(agent)}` },
              ...[...models, ...custom].map((m) => ({
                value: m.value,
                label: (
                  <span className="dk-choice">
                    <span>{m.name}</span>
                    <span className="dk-sub dk-mono">{m.value}</span>
                  </span>
                ),
              })),
            ]}
          />
          {models.length ? null : <span className="dk-sub">运行一次后显示可用模型</span>}
        </div>
        <div className="dk-split">
          <div className="dk-field">
            <span className="dk-field__title">并发上限</span>
            <SegmentedControl
              aria-label="并发上限"
              items={concurrencies.map((v) => ({ value: v, label: v }))}
              value={concurrency}
              onChange={setConcurrency}
            />
          </div>
          <div className="dk-field">
            <span className="dk-field__title">命令审批</span>
            <SegmentedControl
              aria-label="命令审批"
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
                      <Icon name="xmark" size={10} weight={2} />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            <div className="dk-inline dk-inline--fill">
              <Input
                mono
                value={prefix}
                placeholder="命令前缀，如 go build"
                onChange={(e) => setPrefix(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') add()
                }}
              />
              <Button onClick={add}>添加</Button>
            </div>
            <span className="dk-sub">
              以这些前缀开头的单条命令自动批准；含 &&、;、| 等组合或重定向的命令仍需你审批。
            </span>
          </div>
        ) : null}
        <span className="dk-sub">
          {agent?.available
            ? '模型与审批在该 Bot 下一轮运行时生效；并发上限保存到服务器。'
            : '当前 agent 未安装。模型与审批可先保存，安装并检测通过后生效。'}
        </span>
      </div>
    </Dialog>
  )
}
