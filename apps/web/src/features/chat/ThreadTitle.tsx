import { type MessageDto, THREAD_TITLE_MAX } from '@gonggong/protocol'
import { useRef, useState } from 'react'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { attempt } from '../../lib/errors'
import { useEscape } from '../../ui'
import { threadTitle } from './snippet'
import { applyLocal } from './useTimeline'

/** The thread's name in its header: click to rename in place, Enter or leaving the field saves, Esc cancels. */
export function ThreadTitle({ root, readOnly }: { root: MessageDto | undefined; readOnly: boolean }) {
  const name = root ? threadTitle(root) : t('话题')
  const [draft, setDraft] = useState<string | null>(null)
  const settled = useRef(false)
  useEscape(() => {
    settled.current = true
    setDraft(null)
  }, draft !== null)
  if (!root || readOnly || root.hidden || root.recalled)
    return (
      <span className="thread-title" title={name}>
        {name}
      </span>
    )
  const save = async () => {
    if (settled.current || draft === null) return
    settled.current = true
    const title = draft.trim()
    const saved =
      title === name ||
      (await attempt(async () => {
        const renamed = await api.put<MessageDto>(`/messages/${root.id}/thread/title`, { title })
        applyLocal({ t: 'message.edited', message: renamed })
      }))
    // A failed save keeps the typed name in the field to retry (Enter or leaving it again).
    if (saved) setDraft(null)
    else settled.current = false
  }
  return draft === null ? (
    <button
      type="button"
      className="thread-title thread-title--editable"
      aria-label={t('话题名称：{name}，点击修改', { name })}
      title={t('点击改名')}
      onClick={() => {
        settled.current = false
        setDraft(name)
      }}
    >
      {name}
    </button>
  ) : (
    <input
      className="thread-title__input"
      aria-label={t('话题名称')}
      placeholder={t('留空则用首条消息')}
      maxLength={THREAD_TITLE_MAX}
      value={draft}
      // biome-ignore lint/a11y/noAutofocus: the field replaces the name the user just clicked
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
          e.preventDefault()
          void save()
        }
      }}
      onBlur={() => void save()}
    />
  )
}
