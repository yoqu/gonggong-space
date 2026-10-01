import type { MachineDto } from '@gonggong/protocol'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { ConfirmActionDialog } from '../../ui'

export function RevokeMachineDialog({
  machine,
  onRevoked,
  onClose,
}: {
  machine: MachineDto
  onRevoked?: () => void
  onClose: () => void
}) {
  return (
    <ConfirmActionDialog
      title={t('要吊销机器 {name} 吗？', { name: machine.name })}
      message={t('吊销后需要重新生成接入链接才能再次使用。')}
      consequences={[t('该机器的 daemon 立即断开'), t('daemon 会清理本机托管工作区；/cd 目录与备份保留')]}
      label={t('吊销')}
      done={t('已吊销 {name}', { name: machine.name })}
      run={async () => {
        await api.del(`/machines/${machine.id}`)
        useWorkspace.getState().applyEvent({ t: 'machine.removed', machineId: machine.id })
      }}
      onDone={onRevoked}
      onClose={onClose}
    />
  )
}
