import type { ClientDownloads, MachineDto } from '@gonggong/protocol'
import { useEffect, useRef, useState } from 'react'
import { api } from '../../lib/api'
import { realtime } from '../../lib/realtime'
import { Alert, Dialog, Form, FormRow, Spinner, StepIndicator, type StepStatus } from '../../ui'
import { AGENT_LABEL } from '../bots/model'
import { BindCodePanel, useBindCode } from './BindCodePanel'
import './machines.css'
import { t } from '../../i18n'

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
    { label: t('生成接入链接'), status: code || bound ? 'completed' : error ? 'error' : 'active' },
    {
      label: t('客户端绑定'),
      status: bound ? 'completed' : expired ? 'error' : waiting ? 'active' : 'pending',
    },
    { label: t('上报机器与 agent'), status: bound ? (bound.online ? 'completed' : 'active') : 'pending' },
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
        {bound ? (
          <BoundMachine machine={bound} />
        ) : (
          <>
            <BindCodePanel bind={bind} />
            {waiting ? (
              <span className="bind__waiting">
                <Spinner size={14} />
                {t('等待客户端确认绑定…')}
              </span>
            ) : null}
            <p className="bind__note">
              {t(
                '绑定后该机器归属于你，客户端会上报机器名、系统、CPU、内存与本机可用的 Claude Code / Codex；同一台机器重新绑定会恢复原记录。还没安装共工空间客户端？',
              )}
              <DownloadLinks open={open} />
            </p>
          </>
        )}
      </div>
    </Dialog>
  )
}

const GITHUB_RELEASES = 'https://github.com/yoqu/gonggong-space/releases/latest'
const DESKTOP_LABEL: Record<string, string> = {
  'macos-aarch64': t('macOS（Apple 芯片）'),
  'macos-x86_64': t('macOS（Intel）'),
  'windows-x86_64': 'Windows',
}

/** Installers hosted by this server (管理后台 · 客户端发布); Linux has no desktop app, so it gets the gg CLI. */
function DownloadLinks({ open }: { open: boolean }) {
  const [downloads, setDownloads] = useState<ClientDownloads | null>(null)
  useEffect(() => {
    if (open)
      void api
        .get<ClientDownloads | null>('/client-downloads')
        .then(setDownloads)
        .catch(() => {})
  }, [open])

  const links = [
    ...Object.entries(downloads?.desktop ?? {})
      .filter(([p]) => DESKTOP_LABEL[p])
      .map(([p, b]) => ({ label: DESKTOP_LABEL[p] as string, url: b.url })),
    ...Object.entries(downloads?.builds ?? {})
      .filter(([p]) => p.startsWith('linux-'))
      .map(([p, b]) => ({
        label: t('Linux {arch}（命令行）', { arch: p.slice('linux-'.length) }),
        url: b.url,
      })),
  ]
  if (!links.length)
    return (
      <a className="bind__link" href={GITHUB_RELEASES} target="_blank" rel="noreferrer">
        {t('前往 GitHub 下载')}
      </a>
    )
  return (
    <span className="bind__downloads">
      {links.map((l) => (
        <a key={l.url} className="bind__link" href={l.url} download>
          {l.label}
        </a>
      ))}
    </span>
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
            : t('本机已归属你 · {name}（{os} · {arch}）', {
                name: machine.name,
                os: OS_LABEL[machine.os],
                arch: machine.arch,
              })
        }
      />
      <Form>
        <FormRow label={t('本机 agent')} align="top">
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
          '你自己创建的 Bot 已直接绑定到本机，无需操作；管理员为你创建并指定到本机的 Bot，需在通知中确认后才能被触发。',
        )}
      </p>
    </>
  )
}
