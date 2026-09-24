import type { BotDto } from '@aiws/protocol'
import { useState } from 'react'
import { Alert, Button, Dialog, toast } from '../../ui'
import { errorText } from '../auth/AuthCard'
import { botsApi } from './model'

export function DeleteBotDialog({ bot, onClose }: { bot: BotDto; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function remove() {
    setBusy(true)
    try {
      await botsApi.remove(bot.id)
      toast({ type: 'success', message: `已删除 ${bot.name}` })
      onClose()
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      title={`删除 ${bot.name}`}
      onClose={onClose}
      width={440}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button variant="destructive" disabled={busy} onClick={() => void remove()}>
            删除
          </Button>
        </>
      }
    >
      <ul className="ui-consequences">
        <li>{bot.groupCount ? `从所在的 ${bot.groupCount} 个群移除` : '当前不在任何群'}</li>
        <li>删除后不可恢复，群消息与运行记录保留</li>
      </ul>
      {error ? <Alert variant="error" description={error} /> : null}
    </Dialog>
  )
}
