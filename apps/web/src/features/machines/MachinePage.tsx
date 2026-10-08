import type { BotDto, MachineDto } from '@gonggong/protocol'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { t } from '../../i18n'
import { ChatHeader, Icon, Presence } from '../../ui'
import { OS_LABEL } from './BindMachineDialog'
import { MachineDetails, OS_ICON, osText } from './MachineDialog'
import { RevokeMachineDialog } from './RevokeMachineDialog'
import './machines.css'

/** A machine opened from the sidebar, shown in the content area like a bot page. */
export function MachinePage({
  machine,
  bots,
  onBack,
}: {
  machine: MachineDto
  bots: BotDto[]
  onBack?: () => void
}) {
  const navigate = useNavigate()
  const [revoking, setRevoking] = useState(false)
  return (
    <section className="machine-page" aria-label={t('机器详情')}>
      <ChatHeader
        avatar={
          <span className="machine-page__avatar" data-online={machine.online}>
            <Icon name={OS_ICON[machine.os]} size={18} label={OS_LABEL[machine.os]} />
          </span>
        }
        title={machine.name}
        subtitle={[machine.online ? t('在线') : t('离线'), osText(machine), machine.arch].join(' · ')}
        onBack={onBack}
        actions={[{ icon: 'trash', label: t('吊销机器'), text: t('吊销'), onClick: () => setRevoking(true) }]}
      />
      <div className="machine-page__body">
        <MachineDetails machine={machine} bots={bots} />
      </div>
      <Presence>
        {revoking ? (
          <RevokeMachineDialog
            machine={machine}
            onRevoked={() => navigate('/', { replace: true })}
            onClose={() => setRevoking(false)}
          />
        ) : null}
      </Presence>
    </section>
  )
}
