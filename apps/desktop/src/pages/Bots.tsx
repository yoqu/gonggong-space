import type { AgentKind } from '@gonggong/protocol'
import {
  Button,
  Dialog,
  EmptyState,
  Form,
  FormRow,
  GroupBox,
  GroupRow,
  HelpButton,
  Icon,
  Kbd,
  PopUpButton,
  SegmentedControl,
  Skeleton,
  Stepper,
  Tag,
  type TagTone,
  type Token,
  TokenField,
  toast,
} from '@web/ui'
import { useCallback, useEffect, useState } from 'react'
import { type AgentCard, type Approval, type BotCard, ipc } from '../ipc'
import { AGENTS, APPROVAL, agentDefault, modelName } from '../lib/labels'
import type { PageProps } from '.'

const fail = (e: unknown) => toast({ type: 'error', message: String(e) })
const KINDS: AgentKind[] = ['claude', 'codex']
const MAX_CONCURRENCY = 8

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
      {bots ? null : <Skeleton variant="conversation" count={3} />}
      {bots?.length === 0 ? (
        <EmptyState
          icon="bot"
          title="本机还没有 Bot"
          description="在 Web 端创建 Bot 并指定到这台机器后，会显示在这里。"
        />
      ) : null}
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
              <GroupRow
                label="Agent"
                value={
                  missing ? (
                    <span className="dk-danger">{`${name} · 未安装`}</span>
                  ) : (
                    `${name} ${agent?.version ?? ''}`.trim()
                  )
                }
              />
              <GroupRow
                label="模型"
                value={b.model ? modelName(agent, b.model) : `${agentDefault(agent)} · 跟随默认`}
              />
              <GroupRow label="并发上限" value={b.concurrency} />
              <GroupRow label="命令审批" value={APPROVAL[b.approval]} />
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
      {bots?.length ? (
        <p className="dk-footnote">
          Bot 的名称、角色说明、MCP 与所属群在 Web 端管理；这里只配置它在本机的执行方式：用哪个
          agent、哪个模型、并发与审批。
        </p>
      ) : null}
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

/** Collapses inner whitespace and drops duplicates, so `go  build` and `go build` are one prefix. */
const prefixes = (tokens: Token[]) => [
  ...new Set(
    tokens.map((t) => (typeof t === 'string' ? t : t.label).trim().replace(/\s+/g, ' ')).filter(Boolean),
  ),
]

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
  const [model, setModel] = useState(bot.model ?? '')
  const [concurrency, setConcurrency] = useState(bot.concurrency)
  const [approval, setApproval] = useState<Approval>(bot.approval)
  const [allowlist, setAllowlist] = useState(bot.allowlist)
  const [saving, setSaving] = useState(false)
  const agent = agents.find((a) => a.kind === bot.agentKind)
  const models = (agent?.catalog?.models ?? []).filter((m) => m.value !== 'default')
  const custom = model && !models.some((m) => m.value === model) ? [{ value: model, name: model }] : []

  const save = async () => {
    setSaving(true)
    try {
      await ipc.saveBot(bot.id, {
        model: model || null,
        approval,
        allowlist,
        concurrency: concurrency === bot.concurrency ? null : concurrency,
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
      width={520}
      closeOnScrim={false}
      onClose={onClose}
      title={`${bot.name} · 本机设置`}
      message={
        agent?.available
          ? '模型与审批在该 Bot 下一轮运行时生效；并发上限保存到服务器。'
          : '当前 agent 未安装。模型与审批可先保存，安装并检测通过后生效。'
      }
      footer={
        <HelpButton help="Bot 的名称、角色说明、MCP 与所属群在 Web 端管理；这里只配置它在本机的执行方式。" />
      }
      actions={[
        { label: '取消', onClick: onClose },
        { label: '保存', variant: 'primary', onClick: save, disabled: saving },
      ]}
    >
      <Form aria-label="本机设置">
        <FormRow
          label="使用 agent"
          hint="Bot 使用哪个 agent 由 Web 端设定。切换 agent 会结束该 Bot 在各群的会话上下文，下一轮重新开始；工作区与文件不受影响。"
        >
          <PopUpButton
            aria-label="使用 agent"
            disabled
            value={bot.agentKind}
            options={KINDS.map((kind) => {
              const a = agents.find((x) => x.kind === kind)
              return {
                value: kind,
                label: `${AGENTS[kind].name} · ${a?.available ? a.version : '未安装'}`,
              }
            })}
          />
        </FormRow>
        <FormRow label="模型" hint={models.length ? null : '运行一次后显示可用模型'}>
          <PopUpButton
            aria-label="模型"
            value={model}
            onChange={setModel}
            options={[
              { value: '', label: `跟随 agent 默认 · ${agentDefault(agent)}` },
              ...[...models, ...custom].map((m) => ({ value: m.value, label: m.name })),
            ]}
          />
        </FormRow>
        <FormRow label="并发上限" hint="同时运行的轮次，超出的在本机排队">
          <Stepper
            aria-label="并发上限"
            min={1}
            max={Math.max(MAX_CONCURRENCY, bot.concurrency)}
            value={concurrency}
            onChange={setConcurrency}
            width={48}
          />
        </FormRow>
        <FormRow label="命令审批">
          <SegmentedControl
            aria-label="命令审批"
            items={(Object.keys(APPROVAL) as Approval[]).map((v) => ({ value: v, label: APPROVAL[v] }))}
            value={approval}
            onChange={setApproval}
          />
        </FormRow>
        {approval === 'allowlist' ? (
          <FormRow
            label="命令白名单"
            align="top"
            hint={
              <>
                输入命令前缀后按 <Kbd>↩</Kbd> 添加。以这些前缀开头的单条命令自动批准；含 &&、;、|
                等组合或重定向的命令仍需你审批。
              </>
            }
          >
            <TokenField
              value={allowlist}
              placeholder="命令前缀，如 go build"
              onChange={(tokens) => setAllowlist(prefixes(tokens))}
            />
          </FormRow>
        ) : null}
      </Form>
    </Dialog>
  )
}
