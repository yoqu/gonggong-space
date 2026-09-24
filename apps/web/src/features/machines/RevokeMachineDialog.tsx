import type { MachineDto } from '@aiws/protocol'
import { useState } from 'react'
import { useWorkspace } from '../../app/workspace'
import { api } from '../../lib/api'
import { Alert, Button, Dialog, toast } from '../../ui'
import { errorText } from '../auth/AuthCard'

export function RevokeMachineDialog({ machine, onClose }: { machine: MachineDto; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function revoke() {
    setBusy(true)
    try {
      await api.del(`/machines/${machine.id}`)
      useWorkspace.getState().applyEvent({ t: 'machine.removed', machineId: machine.id })
      toast({ type: 'success', message: `已吊销 ${machine.name}` })
      onClose()
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      title={`吊销机器 ${machine.name}`}
      onClose={onClose}
      width={440}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button variant="destructive" disabled={busy} onClick={() => void revoke()}>
            吊销
          </Button>
        </>
      }
    >
      <ul className="ui-consequences">
        <li>该机器的 daemon 立即断开，需重新生成绑定码才能再次使用</li>
        <li>本机工作区与备份保留在本地，不会被删除</li>
      </ul>
      {error ? <Alert variant="error" description={error} /> : null}
    </Dialog>
  )
}
