import type { LinkRequestDto, MachineDto } from '@gonggong/protocol'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import demoDark from '../../assets/demo/a1-dark.mp4'
import demoDarkPoster from '../../assets/demo/a1-dark-poster.webp'
import demoLight from '../../assets/demo/a1-light.mp4'
import demoLightPoster from '../../assets/demo/a1-light-poster.webp'
import { api } from '../../lib/api'
import { realtime } from '../../lib/realtime'
import {
  Alert,
  Button,
  DemoVideo,
  Dialog,
  Disclosure,
  Form,
  FormRow,
  Mascot,
  Spinner,
  StepIndicator,
  type StepStatus,
} from '../../ui'
import { AGENT_LABEL } from '../bots/model'
import { AgentPrompt, BindCodePanel, useBindCode } from './BindCodePanel'
import { ClientDownload } from './ClientDownload'
import { LinkRequestCard } from './LinkRequestCard'
import { OS_LABEL } from './model'
import './machines.css'
import { t } from '../../i18n'

/** Windows has no install.sh: its users go the desktop app way. */
const onWindows = () => /Windows/i.test(navigator.userAgent)

/**
 * 绑定新机器. Leads with a sentence to paste to a local agent (Agent 自助接入): it installs gg, binds the machine and
 * gets its bot and DM made, and the dialog then opens that DM. 其他方式 keeps the desktop app, the gg login command
 * and Docker; a machine bound that way ends on 新建 Bot.
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
  const [bound, setBound] = useState<MachineDto | null>(null)
  /** ① is the user's word: there is no telling whether the client is installed until it binds. */
  const [installed, setInstalled] = useState(false)
  /** 其他方式 opened: the machine is bound from the desktop app, which then reports its agents. */
  const [viaClient, setViaClient] = useState(onWindows)
  /** id → boundAt before this code: a new id or a newer boundAt is the machine that just logged in. */
  const known = useRef<Map<string, string> | null>(null)
  /** A machine whose code had expired asking to be bound: confirmed right here instead of on /link/:id. */
  const [request, setRequest] = useState<LinkRequestDto | null>(null)
  /** The code whose sentence was copied: until then ① waits on the user rather than spinning. */
  const [copied, setCopied] = useState<string | null>(null)
  const bind = useBindCode(open, !!bound)
  const { code, error } = bind
  const navigate = useNavigate()
  // Read when the agent is done, so a parent re-render (a new onClose) does not restart the wait below.
  const leave = useRef({ navigate, onClose })
  leave.current = { navigate, onClose }

  useEffect(() => {
    if (!open) return
    setBound(null)
    setInstalled(false)
    setViaClient(onWindows())
    setRequest(null)
    setCopied(null)
    known.current = null
    void api.get<MachineDto[]>('/machines').then((list) => {
      known.current = new Map(list.map((m) => [m.id, m.boundAt]))
    })
    return realtime.subscribe((e) => {
      if (e.t === 'machine.linkRequested') {
        setRequest(e.request)
        return
      }
      if (e.t === 'machine.onboarded') {
        leave.current.navigate(`/g/${e.groupId}`)
        leave.current.onClose()
        return
      }
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
  const handedOver = (!!code && copied === code.code) || !!request
  const steps: { label: string; status: StepStatus }[] = [
    {
      label: t('复制给 Agent'),
      status: bound || handedOver ? 'completed' : error ? 'error' : code ? 'current' : 'pending',
    },
    { label: t('机器接入'), status: bound ? 'completed' : handedOver ? 'active' : 'pending' },
    { label: t('Bot 就绪'), status: bound ? 'active' : 'pending' },
  ]

  return (
    <Dialog
      open={open}
      title={t('绑定新机器')}
      message={t(
        '把下面这句话粘贴给本机的 Claude Code、Codex 等，它会自己安装 gg、绑定这台机器并建好 Bot（支持 macOS 和 Linux）。机器归属于你，Bot 在上面运行。',
      )}
      width={520}
      onClose={onClose}
      actions={
        !bound
          ? [{ label: t('取消'), onClick: onClose }]
          : onNewBot
            ? [
                { label: t('稍后'), onClick: onClose },
                { label: t('新建 Bot'), variant: 'primary', onClick: () => onNewBot(bound.id) },
              ]
            : [{ label: t('完成'), variant: 'primary', onClick: onClose }]
      }
    >
      <div className="bind">
        <StepIndicator steps={steps} />
        {bound ? null : (
          <>
            <section className="bind__section" aria-label={t('发给你的 Agent')}>
              <h3 className="bind__heading">{t('发给你的 Agent')}</h3>
              <DemoVideo
                className="bind__demo"
                label={t('一句话接入演示')}
                autoPlay
                sources={{
                  light: { src: demoLight, poster: demoLightPoster },
                  dark: { src: demoDark, poster: demoDarkPoster },
                }}
              />
              <AgentPrompt bind={bind} onCopied={setCopied} />
              {request ? <LinkRequestCard key={request.id} request={request} /> : null}
              {onWindows() ? (
                <Alert variant="info" description={t('Windows 上请展开「其他方式」，用桌面客户端绑定。')} />
              ) : null}
            </section>
            <Disclosure
              title={t('其他方式')}
              defaultOpen={onWindows()}
              onToggle={(o) => o && setViaClient(true)}
            >
              <div className="bind">
                <section className="bind__section" aria-label={t('安装客户端')}>
                  <h3 className="bind__heading">{t('① 安装客户端')}</h3>
                  {installed ? (
                    <span className="bind__note">{t('已安装客户端')}</span>
                  ) : (
                    <>
                      <span className="bind__step-line">
                        <span className="bind__note">{t('已经装好客户端可以跳过这一步。')}</span>
                        <Button size="small" onClick={() => setInstalled(true)}>
                          {t('我已安装')}
                        </Button>
                      </span>
                      <ClientDownload open={open} />
                    </>
                  )}
                </section>
                <section className="bind__section" aria-label={t('打开接入链接')}>
                  <h3 className="bind__heading">{t('② 打开接入链接')}</h3>
                  <BindCodePanel bind={bind} />
                </section>
              </div>
            </Disclosure>
          </>
        )}
        <section className="bind__section" aria-label={bound ? t('已接入的机器') : t('等待接入')}>
          <h3 className="bind__heading">{bound ? t('已接入的机器') : t('等待接入')}</h3>
          {bound ? (
            <>
              <BoundMachine machine={bound} viaClient={viaClient} />
              {online ? <span className="bind__online">{t('机器已上线')}</span> : null}
            </>
          ) : (
            <>
              {code ? (
                <span className="bind__waiting">
                  <Spinner size={14} />
                  {t('等待接入…Agent 会自己下载安装，通常 1–3 分钟')}
                </span>
              ) : null}
              <Disclosure title={t('了解上报内容')}>
                <p className="bind__note">
                  {t(
                    '绑定后该机器归属于你，客户端会上报机器名、系统、CPU、内存与该机器可用的 Claude Code / Codex / Gemini CLI；同一台机器重新绑定会恢复原记录。',
                  )}
                </p>
              </Disclosure>
            </>
          )}
        </section>
      </div>
    </Dialog>
  )
}

function BoundMachine({ machine, viaClient }: { machine: MachineDto; viaClient: boolean }) {
  const restored = machine.boundAt !== machine.createdAt
  return (
    <>
      <div className="bind__success">
        <Mascot action="done" size={72} label={t('共字君')} />
        <span className="bind__success-text">
          <strong className="bind__success-title">{restored ? t('已恢复原有机器') : t('绑定成功')}</strong>
          <span className="bind__note">
            {restored
              ? t('{name} 之前绑定过，已沿用原机器记录与其上的 Bot（{os} · {arch}）', {
                  name: machine.name,
                  os: OS_LABEL[machine.os],
                  arch: machine.arch,
                })
              : t('该机器已归属你 · {name}（{os} · {arch}）', {
                  name: machine.name,
                  os: OS_LABEL[machine.os],
                  arch: machine.arch,
                })}
          </span>
        </span>
      </div>
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
              {t('未检测到 Claude Code / Codex / Gemini CLI，安装后在客户端中重新检测即可上报。')}
            </span>
          ) : (
            <span className="bind__waiting">
              <Spinner size={14} />
              {viaClient ? t('等待上报 agent…在机器上打开共工空间客户端') : t('等待机器上线…')}
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
