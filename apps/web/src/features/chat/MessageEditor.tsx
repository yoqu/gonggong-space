import type { MessageDto } from '@gonggong/protocol'
import { useState } from 'react'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { attempt } from '../../lib/errors'
import { Textarea } from '../../ui'
import { applyLocal } from './useTimeline'
import './edit.css'

/** Inline 编辑 of my own message: Enter saves, Shift/Ctrl/Cmd/Alt+Enter breaks the line, Esc cancels. */
export function MessageEditor({ message, onDone }: { message: MessageDto; onDone: () => void }) {
  const [body, setBody] = useState(message.body)
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (body === message.body) return onDone()
    setBusy(true)
    const ok = await attempt(async () => {
      const edited = await api.patch<MessageDto>(`/messages/${message.id}`, { body })
      applyLocal({ t: 'message.edited', message: edited })
    })
    setBusy(false)
    if (ok) onDone()
  }
  return (
    <div className="msg-edit">
      <Textarea
        aria-label={t('编辑消息')}
        autoFocus
        rows={Math.min(8, body.split('\n').length)}
        value={body}
        disabled={busy}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onDone()
          else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            if (!(e.ctrlKey || e.metaKey || e.altKey)) return void save()
            const { selectionStart: s, selectionEnd: end } = e.currentTarget
            const el = e.currentTarget
            setBody(`${body.slice(0, s)}\n${body.slice(end)}`)
            setTimeout(() => el.setSelectionRange(s + 1, s + 1))
          }
        }}
      />
      <span className="msg-edit-hint">{t('Enter 保存 · Esc 取消')}</span>
    </div>
  )
}
