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
      title={t('要解绑电脑 {name} 吗？', { name: machine.name })}
      message={t('解绑后需要重新生成接入链接才能再次使用。')}
      consequences={[
        t('这台电脑的共工客户端会立即断开'),
        t('客户端会清理这台电脑上的托管工作区；/cd 目录与本地备份保留'),
      ]}
      label={t('解绑#computer')}
      done={t('已解绑 {name}', { name: machine.name })}
      run={async () => {
        await api.del(`/machines/${machine.id}`)
        useWorkspace.getState().applyEvent({ t: 'machine.removed', machineId: machine.id })
      }}
      onDone={onRevoked}
      onClose={onClose}
    />
  )
}
