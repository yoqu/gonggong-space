import type { AgentInfo } from '@gonggong/protocol'
import { Alert, Button, Checkbox, GroupBox, Icon, TextField } from '@web/ui'
import { useState } from 'react'
import logo from '../assets/logo.svg'
import { ipc, type MachineBot } from '../ipc'
import { AGENTS } from '../lib/labels'
import { StatusText } from '../lib/ui'
import { TitleBar } from '../shell/TitleBar'
import { refreshInfo } from '../store'

const STEPS = 3
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
    <>
      <TitleBar lights scrolled={false} />
      <div className="dk-onboarding">
        <div className="dk-onboarding__panel">
          <img className="dk-onboarding__logo" src={logo} alt="" width={64} height={64} />
          <div className="dk-steps">
            {Array.from({ length: STEPS }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed step count
              <span key={i} className="dk-steps__dot" data-done={i <= step || undefined} />
            ))}
            <span>
              第 {step + 1} 步，共 {STEPS} 步
            </span>
          </div>
          {step === 0 ? (
            <>
              <h1 className="dk-onboarding__title">绑定到团队服务器</h1>
              <p className="dk-onboarding__desc">
                在 Web
                端头像菜单选择「绑定新机器」生成一次性绑定码。绑定后本机归属于你，所有连接均由本机向外发起。
              </p>
              <div className="dk-form">
                <TextField
                  label="服务器"
                  size="large"
                  mono
                  value={server}
                  placeholder="https://gonggong.corp.cn"
                  onChange={(e) => setServer(e.target.value)}
                />
                <TextField
                  label="绑定码"
                  size="large"
                  mono
                  className="dk-code-input"
                  value={code}
                  placeholder="K7QM-4X2P"
                  onChange={(e) => setCode(e.target.value)}
                  hint={`等价命令：gg login --server ${server.trim() || '<服务器>'} --code ${normalized || '<绑定码>'}`}
                />
              </div>
            </>
          ) : null}
          {step === 1 ? (
            <>
              <h1 className="dk-onboarding__title">检测本机 agent</h1>
              <p className="dk-onboarding__desc">
                未安装的 agent 可以稍后在「Agent」页安装并重新检测；依赖它的 Bot
                在此之前不能被触发。至少需要一个可用 agent 才能继续。
              </p>
              <GroupBox>
                {agents?.map((a) => (
                  <AgentRow key={a.kind} agent={a} checking={checking} onRecheck={detect} />
                ))}
              </GroupBox>
            </>
          ) : null}
          {step === 2 ? (
            <>
              <h1 className="dk-onboarding__title">确认 Bot</h1>
              <p className="dk-onboarding__desc">
                你自己创建的 Bot
                已直接绑定到本机，无需操作。以下由管理员为你创建并指定到本机，确认后才能被触发。
              </p>
              <GroupBox>
                {bots.length === 0 ? <div className="dk-row dk-row--empty">没有待确认的 Bot。</div> : null}
                {bots.map((b) => (
                  <div key={b.id} className="dk-row">
                    <span className="dk-tile" style={{ background: 'var(--system-indigo)' }}>
                      <Icon name="bot" size={16} />
                    </span>
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
              </GroupBox>
            </>
          ) : null}
          {error ? <Alert variant="error" description={error} /> : null}
          <Button variant="primary" size="xlarge" fullWidth disabled={disabled} onClick={next}>
            {NEXT[step]}
          </Button>
        </div>
      </div>
    </>
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
  const color = agent.available ? 'var(--system-green)' : 'var(--system-orange)'
  return (
    <>
      <div className="dk-row">
        <Icon name={agent.available ? 'checkmark-circle' : 'warning'} size={18} color={color} />
        <div className="dk-row__main">
          <span className="dk-strong">
            {agent.available ? `${meta.name} ${agent.version ?? ''}`.trim() : meta.name}
          </span>
          <span className="dk-sub dk-mono dk-ellipsis">
            {agent.path ?? '未在 PATH、~/.local/bin、/opt/homebrew/bin 中找到'}
          </span>
        </div>
        <StatusText color={color}>{checking ? '检测中…' : agent.available ? '可用' : '未安装'}</StatusText>
      </div>
      {agent.available ? null : (
        <div className="dk-row dk-row--sub">
          <code className="dk-install__cmd dk-row__main">{meta.install}</code>
          <Button disabled={checking} onClick={onRecheck}>
            {checking ? '检测中…' : '重新检测'}
          </Button>
        </div>
      )}
    </>
  )
}
