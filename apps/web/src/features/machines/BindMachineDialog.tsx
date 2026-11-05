import type { MachineDto } from '@gonggong/protocol'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { api } from '../../lib/api'
import { realtime } from '../../lib/realtime'
import { Alert, Button, Dialog, Form, FormRow, Spinner, StepIndicator, type StepStatus } from '../../ui'
import { AGENT_LABEL } from '../bots/model'
import { BindCodePanel, useBindCode } from './BindCodePanel'
import { ClientDownload } from './ClientDownload'
import { OS_LABEL } from './model'
import './machines.css'
import { t } from '../../i18n'

/**
 * 绑定新机器 in three steps: ① install the client (skippable), ② open the 接入链接 in it, ③ wait for the machine to
 * come online, then go on to 新建 Bot on it or to its page.
 */
export function BindMachineDialog({
  open,
  onClose,
  onNewBot,
}: {
  open: boolean
  onClose: () => void
  /** 新建 Bot on the machine just bound; without it the button is not offered. */
  onNewBot?: (machineId: string) => void
}) {
  const navigate = useNavigate()
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

  const online = !!bound?.online
  const steps: { label: string; status: StepStatus }[] = [
    { label: t('安装客户端'), status: bound ? 'completed' : 'active' },
    {
      label: t('打开接入链接'),
      status: bound ? 'completed' : expired || error ? 'error' : code ? 'active' : 'pending',
    },
    { label: t('等待机器上线'), status: online ? 'completed' : bound ? 'active' : 'pending' },
  ]

  return (
    <Dialog
      open={open}
      title={t('绑定新机器')}
      message={t('在共工空间客户端中打开接入链接，确认后这台机器就归属于你，Bot 在上面运行。')}
      width={520}
      onClose={onClose}
      actions={[
        bound
          ? { label: t('完成'), variant: 'primary', onClick: onClose }
          : { label: t('取消'), onClick: onClose },
      ]}
    >
      <div className="bind">
        <StepIndicator steps={steps} />
        {bound ? null : (
          <>
            <section className="bind__section" aria-label={t('安装客户端')}>
              <h3 className="bind__heading">{t('① 安装客户端')}</h3>
              <span className="bind__note">{t('已经装好客户端可以跳过这一步。')}</span>
              <ClientDownload open={open} />
            </section>
            <section className="bind__section" aria-label={t('打开接入链接')}>
              <h3 className="bind__heading">{t('② 打开接入链接')}</h3>
              <BindCodePanel bind={bind} />
            </section>
          </>
        )}
        <section className="bind__section" aria-label={t('等待机器上线')}>
          <h3 className="bind__heading">{t('③ 等待机器上线')}</h3>
          {bound ? (
            <>
              <BoundMachine machine={bound} />
              {online ? (
                <span className="bind__actions">
                  <span className="bind__online">{t('机器已上线')}</span>
                  {onNewBot ? (
                    <Button variant="primary" onClick={() => onNewBot(bound.id)}>
                      {t('新建 Bot')}
                    </Button>
                  ) : null}
                  <Button
                    onClick={() => {
                      onClose()
                      navigate(`/machine/${bound.id}`)
                    }}
                  >
                    {t('查看机器')}
                  </Button>
                </span>
              ) : null}
            </>
          ) : (
            <>
              {code && !expired ? (
                <span className="bind__waiting">
                  <Spinner size={14} />
                  {t('等待机器上线…')}
                </span>
              ) : null}
              <p className="bind__note">
                {t(
                  '绑定后该机器归属于你，客户端会上报机器名、系统、CPU、内存与该机器可用的 Claude Code / Codex；同一台机器重新绑定会恢复原记录。',
                )}
              </p>
            </>
          )}
        </section>
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
        title={restored ? t('已恢复原有机器') : t('绑定成功')}
        description={
          restored
            ? t('{name} 之前绑定过，已沿用原机器记录与其上的 Bot（{os} · {arch}）', {
                name: machine.name,
                os: OS_LABEL[machine.os],
                arch: machine.arch,
              })
            : t('该机器已归属你 · {name}（{os} · {arch}）', {
                name: machine.name,
                os: OS_LABEL[machine.os],
                arch: machine.arch,
              })
        }
      />
      <Form>
        <FormRow label={t('该机器的 agent')} align="top">
          {machine.agents.length ? (
            <ul className="bind__agents">
              {machine.agents.map((a) => (
                <li key={a.kind} className="bind__agent">
                  <span
                    className="bind__dot"
                    style={{ background: a.available ? 'var(--system-green)' : 'var(--system-gray)' }}
                  />
                  <span>
                    {`${AGENT_LABEL[a.kind]} ${a.available ? (a.version ?? '') : t('未安装')}`.trim()}
                  </span>
                </li>
              ))}
            </ul>
          ) : machine.online ? (
            <span className="bind__note">
              {t('未检测到 Claude Code / Codex，安装后在客户端中重新检测即可上报。')}
            </span>
          ) : (
            <span className="bind__waiting">
              <Spinner size={14} />
              {t('等待上报 agent…在机器上打开共工空间客户端')}
            </span>
          )}
        </FormRow>
      </Form>
      <p className="bind__note">
        {t(
          '你自己创建的 Bot 已直接绑定到该机器，无需操作；管理员为你创建并指定到该机器的 Bot，需在通知中确认后才能被触发。',
        )}
      </p>
    </>
  )
}
