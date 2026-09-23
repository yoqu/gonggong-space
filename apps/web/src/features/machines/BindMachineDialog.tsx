import type { AgentInfo, BindCodeDto, MachineDto } from '@aiws/protocol'
import { Copy } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../lib/api'
import { realtime } from '../../lib/realtime'
import { Alert, Button, Dialog, IconButton, Spinner, StepIndicator, type StepStatus, toast } from '../../ui'
import { errorText } from '../auth/AuthCard'
import './machines.css'

export const OS_LABEL: Record<MachineDto['os'], string> = {
  macos: 'macOS',
  linux: 'Linux',
  windows: 'Windows',
}
export const AGENT_LABEL: Record<AgentInfo['kind'], string> = { claude: 'Claude Code', codex: 'Codex' }

const mmss = (ms: number) => {
  const s = Math.floor(ms / 1000)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  return now
}

/** 绑定新机器 (Web 对话.dc.html ovBind): one-time code → daemon login → machine/agents reported. */
export function BindMachineDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [code, setCode] = useState<BindCodeDto | null>(null)
  const [error, setError] = useState('')
  const [bound, setBound] = useState<MachineDto | null>(null)
  const known = useRef<Set<string> | null>(null)
  const now = useNow(open && !!code && !bound)

  const generate = useCallback(async () => {
    setCode(null)
    setError('')
    try {
      setCode(await api.post<BindCodeDto>('/bind-codes'))
    } catch (err) {
      setError(errorText(err))
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setBound(null)
    known.current = null
    void api.get<MachineDto[]>('/machines').then((list) => {
      known.current = new Set(list.map((m) => m.id))
    })
    void generate()
    return realtime.subscribe((e) => {
      if (e.t !== 'machine.updated') return
      const m = e.machine
      setBound((prev) =>
        prev ? (prev.id === m.id ? m : prev) : known.current?.has(m.id) === false ? m : null,
      )
    })
  }, [open, generate])

  const remaining = code ? Date.parse(code.expiresAt) - now : 0
  const expired = !!code && !bound && remaining <= 0
  const waiting = !!code && !bound && !expired
  const command = code ? `aiws login --server ${location.origin} --code ${code.code}` : ''
  const steps: { label: string; status: StepStatus }[] = [
    { label: '生成绑定码', status: code || bound ? 'completed' : error ? 'error' : 'active' },
    {
      label: 'daemon 登录',
      status: bound ? 'completed' : expired ? 'error' : waiting ? 'active' : 'pending',
    },
    { label: '上报机器与 agent', status: bound ? (bound.online ? 'completed' : 'active') : 'pending' },
    { label: '确认 bot', status: bound?.online ? 'completed' : 'pending' },
  ]

  return (
    <Dialog open={open} title="绑定新机器" onClose={onClose}>
      <div className="bind">
        <StepIndicator steps={steps} />
        {bound ? (
          <BoundMachine machine={bound} />
        ) : (
          <>
            <div className="bind__code-box">
              {expired ? (
                <>
                  <span className="bind__expired">绑定码已失效</span>
                  <Button size="sm" onClick={() => void generate()}>
                    重新生成
                  </Button>
                </>
              ) : code ? (
                <>
                  <span className="bind__code" data-testid="bind-code">
                    {code.code}
                  </span>
                  <span className="bind__hint">{`一次性绑定码 · ${mmss(remaining)} 后失效`}</span>
                </>
              ) : error ? (
                <>
                  <Alert variant="error" description={error} />
                  <Button size="sm" onClick={() => void generate()}>
                    重试
                  </Button>
                </>
              ) : (
                <Spinner size={18} />
              )}
            </div>
            <div className="bind__cmd-wrap">
              <span className="bind__label">在本机终端执行，或在 daemon 桌面端粘贴</span>
              <div className="bind__cmd">
                <span className="bind__cmd-text">{command || '—'}</span>
                <IconButton
                  title="复制命令"
                  disabled={!waiting}
                  onClick={() =>
                    void navigator.clipboard
                      ?.writeText(command)
                      .then(() => toast({ type: 'success', message: '已复制绑定命令' }))
                  }
                >
                  <Copy size={13} />
                </IconButton>
              </div>
            </div>
            <p className="bind__note">
              绑定后该机器归属于你，daemon 会上报机器名、系统与本机可用的 Claude Code / Codex。未安装 daemon？
              <button
                type="button"
                className="bind__link"
                onClick={() => toast({ message: '安装包下载即将上线，请先从源码构建 aiws' })}
              >
                下载 macOS / Linux / Windows 版
              </button>
            </p>
            {waiting ? (
              <div className="bind__waiting">
                <Spinner size={14} />
                等待 daemon 使用绑定码登录…
              </div>
            ) : null}
          </>
        )}
      </div>
    </Dialog>
  )
}

function BoundMachine({ machine }: { machine: MachineDto }) {
  return (
    <>
      <Alert
        variant="success"
        title="绑定成功"
        description={`本机已归属你 · ${machine.name}（${OS_LABEL[machine.os]} · ${machine.arch}）`}
      />
      <div className="bind__cmd-wrap">
        <span className="bind__label">本机 agent</span>
        {machine.agents.length ? (
          <ul className="bind__agents">
            {machine.agents.map((a) => (
              <li key={a.kind} className="bind__agent">
                <span
                  className="dot"
                  style={{ background: a.available ? 'var(--color-success)' : '#636366' }}
                />
                <span>{`${AGENT_LABEL[a.kind]} ${a.available ? (a.version ?? '') : '未安装'}`.trim()}</span>
              </li>
            ))}
          </ul>
        ) : machine.online ? (
          <span className="bind__note">未检测到 Claude Code / Codex，安装后重启 daemon 即可上报。</span>
        ) : (
          <div className="bind__waiting">
            <Spinner size={14} />
            等待 daemon 上报 agent…在本机执行 aiws run 启动 daemon
          </div>
        )}
      </div>
      <p className="bind__note">
        你自己创建的 bot 已直接绑定到本机，无需操作；管理员为你创建并指定到本机的
        bot，需在通知中确认后才能被触发。
      </p>
    </>
  )
}
