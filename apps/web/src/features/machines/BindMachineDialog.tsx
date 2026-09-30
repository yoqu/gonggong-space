import type { MachineDto } from '@gonggong/protocol'
import { useEffect, useRef, useState } from 'react'
import { api } from '../../lib/api'
import { realtime } from '../../lib/realtime'
import { Alert, Dialog, Form, FormRow, Spinner, StepIndicator, type StepStatus, toast } from '../../ui'
import { AGENT_LABEL } from '../bots/model'
import { BindCodePanel, useBindCode } from './BindCodePanel'
import './machines.css'

export const OS_LABEL: Record<MachineDto['os'], string> = {
  macos: 'macOS',
  linux: 'Linux',
  windows: 'Windows',
}

/** 绑定新机器 (Web 对话.dc.html ovBind): 接入链接 → desktop app binds → machine/agents reported. */
export function BindMachineDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [bound, setBound] = useState<MachineDto | null>(null)
  /** id → boundAt before this code: a new id or a newer boundAt is the machine that just logged in. */
  const known = useRef<Map<string, string> | null>(null)
  const bind = useBindCode(open, !!bound)
  const { code, error, expired } = bind

  useEffect(() => {
    if (!open) return
    setBound(null)
    known.current = null
    void api.get<MachineDto[]>('/machines').then((list) => {
      known.current = new Map(list.map((m) => [m.id, m.boundAt]))
    })
    return realtime.subscribe((e) => {
      if (e.t !== 'machine.updated') return
      const m = e.machine
      setBound((prev) =>
        prev
          ? prev.id === m.id
            ? m
            : prev
          : known.current && known.current.get(m.id) !== m.boundAt
            ? m
            : null,
      )
    })
  }, [open])

  const waiting = !!code && !bound && !expired
  const steps: { label: string; status: StepStatus }[] = [
    { label: '生成接入链接', status: code || bound ? 'completed' : error ? 'error' : 'active' },
    {
      label: '客户端绑定',
      status: bound ? 'completed' : expired ? 'error' : waiting ? 'active' : 'pending',
    },
    { label: '上报机器与 agent', status: bound ? (bound.online ? 'completed' : 'active') : 'pending' },
  ]

  return (
    <Dialog
      open={open}
      title="绑定新机器"
      message="在共工空间客户端中打开接入链接，确认后这台机器就归属于你，Bot 在上面运行。"
      width={520}
      onClose={onClose}
      actions={[
        bound ? { label: '完成', variant: 'primary', onClick: onClose } : { label: '取消', onClick: onClose },
      ]}
    >
      <div className="bind">
        <StepIndicator steps={steps} />
        {bound ? (
          <BoundMachine machine={bound} />
        ) : (
          <>
            <BindCodePanel bind={bind} />
            {waiting ? (
              <span className="bind__waiting">
                <Spinner size={14} />
                等待客户端确认绑定…
              </span>
            ) : null}
            <p className="bind__note">
              绑定后该机器归属于你，客户端会上报机器名、系统、CPU、内存与本机可用的 Claude Code /
              Codex；同一台机器重新绑定会恢复原记录。还没安装共工空间客户端？
              <button
                type="button"
                className="bind__link"
                onClick={() => toast({ message: '安装包下载即将上线，请先从源码构建' })}
              >
                下载 macOS / Linux / Windows 版
              </button>
            </p>
          </>
        )}
      </div>
    </Dialog>
  )
}

function BoundMachine({ machine }: { machine: MachineDto }) {
  const restored = machine.boundAt !== machine.createdAt
  return (
    <>
      <Alert
        variant="success"
        title={restored ? '已恢复原有机器' : '绑定成功'}
        description={
          restored
            ? `${machine.name} 之前绑定过，已沿用原机器记录与其上的 Bot（${OS_LABEL[machine.os]} · ${machine.arch}）`
            : `本机已归属你 · ${machine.name}（${OS_LABEL[machine.os]} · ${machine.arch}）`
        }
      />
      <Form>
        <FormRow label="本机 agent" align="top">
          {machine.agents.length ? (
            <ul className="bind__agents">
              {machine.agents.map((a) => (
                <li key={a.kind} className="bind__agent">
                  <span
                    className="bind__dot"
                    style={{ background: a.available ? 'var(--system-green)' : 'var(--system-gray)' }}
                  />
                  <span>{`${AGENT_LABEL[a.kind]} ${a.available ? (a.version ?? '') : '未安装'}`.trim()}</span>
                </li>
              ))}
            </ul>
          ) : machine.online ? (
            <span className="bind__note">
              未检测到 Claude Code / Codex，安装后在客户端中重新检测即可上报。
            </span>
          ) : (
            <span className="bind__waiting">
              <Spinner size={14} />
              等待上报 agent…在机器上打开共工空间客户端
            </span>
          )}
        </FormRow>
      </Form>
      <p className="bind__note">
        你自己创建的 Bot 已直接绑定到本机，无需操作；管理员为你创建并指定到本机的
        Bot，需在通知中确认后才能被触发。
      </p>
    </>
  )
}
