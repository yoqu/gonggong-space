import type { MachineDto } from '@gonggong/protocol'
import { useState } from 'react'
import { useWorkspace } from '../../app/workspace'
import { api } from '../../lib/api'
import { Alert, AlertDialog, toast } from '../../ui'
import { errorText } from '../auth/AuthCard'

export function RevokeMachineDialog({
  machine,
  onRevoked,
  onClose,
}: {
  machine: MachineDto
  onRevoked?: () => void
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function revoke() {
    setBusy(true)
    try {
      await api.del(`/machines/${machine.id}`)
      useWorkspace.getState().applyEvent({ t: 'machine.removed', machineId: machine.id })
      toast({ type: 'success', message: `已吊销 ${machine.name}` })
      ;(onRevoked ?? onClose)()
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }
  return (
    <AlertDialog
      open
      title={`要吊销机器 ${machine.name} 吗？`}
      message="吊销后需要重新生成绑定码才能再次使用。"
      detail={
        <>
          <ul className="ui-consequences">
            <li>该机器的 daemon 立即断开</li>
            <li>daemon 会清理本机托管工作区；/cd 目录与备份保留</li>
          </ul>
          {error ? <Alert variant="error" description={error} /> : null}
        </>
      }
      onClose={onClose}
      actions={[
        { label: '取消', onClick: onClose },
        { label: '吊销', variant: 'destructive', disabled: busy, onClick: () => void revoke() },
      ]}
    />
  )
}
