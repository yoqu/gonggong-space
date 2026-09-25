import type { BotDto } from '@gonggong/protocol'
import { useState } from 'react'
import { Alert, AlertDialog, toast } from '../../ui'
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
    <AlertDialog
      open
      title={`要删除 ${bot.name} 吗？`}
      message="删除后不可恢复，群消息与运行记录保留。"
      detail={
        <>
          <ul className="ui-consequences">
            <li>{bot.groupCount ? `从所在的 ${bot.groupCount} 个群移除` : '当前不在任何群'}</li>
          </ul>
          {error ? <Alert variant="error" description={error} /> : null}
        </>
      }
      onClose={onClose}
      actions={[
        { label: '取消', onClick: onClose },
        { label: '删除', variant: 'destructive', disabled: busy, onClick: () => void remove() },
      ]}
    />
  )
}
