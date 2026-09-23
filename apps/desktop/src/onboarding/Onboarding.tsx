import type { AgentInfo } from '@aiws/protocol'
import { Alert, Button, Checkbox, Field, Input, StepIndicator, type StepStatus } from '@web/ui'
import { CircleCheck, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { ipc, type MachineBot } from '../ipc'
import { AGENTS } from '../lib/labels'
import { refreshInfo } from '../store'

const STEPS = ['输入绑定码', '检测 agent', '确认 bot']
const NEXT = ['登录', '上报并继续', '完成']

/** First-run flow: bind code → detect agents (reported on connect) → confirm bots assigned to this machine. */
export function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0)
  const [server, setServer] = useState('')
  const [code, setCode] = useState('')
  const [agents, setAgents] = useState<AgentInfo[] | null>(null)
  const [checking, setChecking] = useState(false)
  const [bots, setBots] = useState<MachineBot[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const normalized = code.trim().toUpperCase()

  const detect = async () => {
    setChecking(true)
    try {
      setAgents(await ipc.detectAgents())
    } finally {
      setChecking(false)
    }
  }

  const steps = [
    async () => {
      await ipc.login(server.trim(), normalized)
      await refreshInfo()
      await detect()
    },
    async () => {
      await ipc.startDaemon()
      const pending = (await ipc.machineBots()).filter((b) => b.binding === 'pending_confirm')
      setBots(pending)
      setPicked(new Set(pending.map((b) => b.id)))
    },
    async () => {
      if (picked.size) await ipc.confirmBots([...picked])
      onDone()
    },
  ]

  const next = async () => {
    setBusy(true)
    setError('')
    try {
      await steps[step]?.()
      if (step < 2) setStep(step + 1)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const disabled =
    busy ||
    (step === 0 && (!server.trim() || !normalized)) ||
    (step === 1 && !agents?.some((a) => a.available))

  return (
    <div className="dk-onboarding">
      <div className="dk-onboarding__panel">
        <StepIndicator
          steps={STEPS.map((label, i) => ({
            label,
            status: (i < step ? 'completed' : i === step ? 'active' : 'pending') as StepStatus,
          }))}
        />
        {step === 0 ? (
          <>
            <div className="dk-onboarding__title">绑定到团队服务器</div>
            <div className="dk-onboarding__desc">
              在 Web
              端头像菜单选择「绑定新机器」生成一次性绑定码。绑定后本机归属于你，所有连接均由本机向外发起。
            </div>
            <Field label="服务器">
              <Input
                mono
                value={server}
                placeholder="https://aiws.corp.cn"
                onChange={(e) => setServer(e.target.value)}
              />
            </Field>
            <Field label="绑定码">
              <Input
                mono
                className="dk-code-input"
                value={code}
                placeholder="K7QM-4X2P"
                onChange={(e) => setCode(e.target.value)}
              />
            </Field>
            <div className="dk-mono-hint">
              等价命令：aiws login --server {server.trim() || '<服务器>'} --code {normalized || '<绑定码>'}
            </div>
          </>
        ) : null}
        {step === 1 ? (
          <>
            <div className="dk-onboarding__title">检测本机 agent</div>
            {agents?.map((a) => (
              <AgentRow key={a.kind} agent={a} checking={checking} onRecheck={detect} />
            ))}
            <div className="dk-hint">
              未安装的 agent 可以稍后在「Agent」页安装并重新检测；依赖它的 bot
              在此之前不能被触发。至少需要一个可用 agent 才能继续。
            </div>
          </>
        ) : null}
        {step === 2 ? (
          <>
            <div className="dk-onboarding__title">确认 bot</div>
            <div className="dk-onboarding__desc">
              你自己创建的 bot
              已直接绑定到本机，无需操作。以下由管理员为你创建并指定到本机，确认后才能被触发。
            </div>
            {bots.length === 0 ? <div className="dk-hint">没有待确认的 bot。</div> : null}
            {bots.map((b) => (
              <div key={b.id} className="dk-row">
                <div className="dk-row__main">
                  <span className="dk-strong">{b.name}</span>
                  <span className="dk-sub">
                    {[AGENTS[b.agentKind].name, b.systemPrompt].filter(Boolean).join(' · ')}
                  </span>
                </div>
                <Checkbox
                  label={<span className="dk-sr-only">{b.name}</span>}
                  checked={picked.has(b.id)}
                  onChange={(on) => {
                    const s = new Set(picked)
                    if (on) s.add(b.id)
                    else s.delete(b.id)
                    setPicked(s)
                  }}
                />
              </div>
            ))}
          </>
        ) : null}
        {error ? <Alert variant="error" description={error} /> : null}
        <div className="dk-onboarding__actions">
          <Button variant="primary" size="lg" disabled={disabled} onClick={next}>
            {NEXT[step]}
          </Button>
        </div>
      </div>
    </div>
  )
}

function AgentRow({
  agent,
  checking,
  onRecheck,
}: {
  agent: AgentInfo
  checking: boolean
  onRecheck: () => void
}) {
  const meta = AGENTS[agent.kind]
  const color = agent.available ? '#32D74B' : '#FF9F0A'
  const Icon = agent.available ? CircleCheck : TriangleAlert
  return (
    <div className="dk-row dk-row--stack">
      <div className="dk-row__head">
        <Icon size={15} color={color} />
        <div className="dk-row__main">
          <span className="dk-strong">
            {agent.available ? `${meta.name} ${agent.version ?? ''}`.trim() : meta.name}
          </span>
          <span className="dk-sub dk-mono">
            {agent.path ?? '未在 PATH、~/.local/bin、/opt/homebrew/bin 中找到'}
          </span>
        </div>
        <span style={{ fontSize: 12, color }}>
          {checking ? '检测中…' : agent.available ? '可用' : '未安装'}
        </span>
      </div>
      {agent.available ? null : (
        <div className="dk-install">
          <span className="dk-install__cmd">{meta.install}</span>
          <Button variant="ghost" size="xs" disabled={checking} onClick={onRecheck}>
            {checking ? '检测中…' : '重新检测'}
          </Button>
        </div>
      )}
    </div>
  )
}
