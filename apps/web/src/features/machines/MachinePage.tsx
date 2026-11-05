import { type AdminMachineDto, type BotDto, type MachineDto, TERMINAL_DIR_FEATURE } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useSession } from '../../app/session'
import { t } from '../../i18n'
import { useGet } from '../../lib/useGet'
import { ChatHeader, DeniedArt, EmptyState, FailedArt, Icon, Presence } from '../../ui'
import { NewTerminalDialog } from '../terminal/NewTerminalDialog'
import { MachineDetails, MachineName, OS_ICON, osText } from './MachineDetails'
import { OS_LABEL } from './model'
import { RevokeMachineDialog } from './RevokeMachineDialog'
import './machines.css'

/**
 * A machine in the content area like a bot page: from the sidebar for its owner, or from 管理后台 for a sysadmin, who
 * sees only the overview and may rename or revoke it.
 */
export function MachinePage({
  machine,
  bots,
  ownerName,
  onChanged,
  onBack,
}: {
  machine: MachineDto
  bots: BotDto[]
  /** The owner, named when someone else (a sysadmin) is looking. */
  ownerName?: string
  /** Rename done: machine events reach only the owner, so a sysadmin's copy must reload itself. */
  onChanged?: () => void
  onBack?: () => void
}) {
  const navigate = useNavigate()
  const owner = useSession((s) => s.user?.id === machine.ownerId)
  const [revoking, setRevoking] = useState(false)
  const [terminal, setTerminal] = useState(false)
  const terminals =
    owner &&
    machine.online &&
    (machine.os === 'macos' || machine.os === 'linux') &&
    machine.features.includes(TERMINAL_DIR_FEATURE)
  return (
    <section className="machine-page" aria-label={t('机器详情')}>
      {owner ? null : (
        <p className="machine-page__admin" role="note">
          {t('正在以管理员身份查看 {owner} 的机器', { owner: ownerName ?? '' })}
          <Link to="/admin/machines">{t('返回后台')}</Link>
        </p>
      )}
      <ChatHeader
        avatar={
          <span className="machine-page__avatar" data-online={machine.online}>
            <Icon name={OS_ICON[machine.os]} size={18} label={OS_LABEL[machine.os]} />
          </span>
        }
        title={<MachineName machine={machine} onChanged={onChanged} />}
        subtitle={[machine.online ? t('在线') : t('离线'), osText(machine), machine.arch].join(' · ')}
        onBack={onBack}
        actions={[
          ...(terminals
            ? [
                {
                  icon: 'terminal' as const,
                  label: t('新建终端'),
                  text: t('终端'),
                  onClick: () => setTerminal(true),
                },
              ]
            : []),
          { icon: 'trash', label: t('吊销机器'), text: t('吊销'), onClick: () => setRevoking(true) },
        ]}
      />
      <div className="machine-page__body">
        <MachineDetails machine={machine} bots={bots} ownerName={owner ? undefined : ownerName} />
      </div>
      <Presence>
        {terminal ? <NewTerminalDialog machine={machine.id} onClose={() => setTerminal(false)} /> : null}
      </Presence>
      <Presence>
        {revoking ? (
          <RevokeMachineDialog
            machine={machine}
            onRevoked={() => navigate(owner ? '/' : '/admin/machines', { replace: true })}
            onClose={() => setRevoking(false)}
          />
        ) : null}
      </Presence>
    </section>
  )
}

/** A member's machine opened from 管理后台 by a sysadmin: read from the admin list, which polls like that page. */
export function AdminMachinePage({ id, onBack }: { id: string; onBack?: () => void }) {
  const { data, error, reload } = useAdminMachines()
  const machine = data?.find((m) => m.id === id)
  if (error)
    return (
      <div className="chat__placeholder">
        <EmptyState illustration={<FailedArt />} title={t('加载失败')} description={error} />
      </div>
    )
  if (!data) return null
  if (!machine)
    return (
      <div className="chat__placeholder">
        <EmptyState illustration={<DeniedArt />} title={t('机器不存在或已吊销')} />
      </div>
    )
  return (
    <MachinePage
      machine={machine}
      bots={[]}
      ownerName={machine.ownerName}
      onChanged={reload}
      onBack={onBack}
    />
  )
}

const POLL_MS = 15_000

/** Machine events reach only their owner, so a sysadmin's copy polls at the heartbeat pace like 机器与网络. */
function useAdminMachines() {
  const list = useGet<AdminMachineDto[]>('/admin/machines')
  const { reload } = list
  useEffect(() => {
    const h = setInterval(reload, POLL_MS)
    return () => clearInterval(h)
  }, [reload])
  return list
}
