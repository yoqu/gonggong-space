import type { MachineDto } from '@gonggong/protocol'
import { useWorkspace } from '../../app/workspace'
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
      title={`要吊销机器 ${machine.name} 吗？`}
      message="吊销后需要重新生成接入链接才能再次使用。"
      consequences={['该机器的 daemon 立即断开', 'daemon 会清理本机托管工作区；/cd 目录与备份保留']}
      label="吊销"
      done={`已吊销 ${machine.name}`}
      run={async () => {
        await api.del(`/machines/${machine.id}`)
        useWorkspace.getState().applyEvent({ t: 'machine.removed', machineId: machine.id })
      }}
      onDone={onRevoked}
      onClose={onClose}
    />
  )
}
