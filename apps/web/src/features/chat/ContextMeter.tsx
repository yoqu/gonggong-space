import type { ContextUsage } from '@gonggong/protocol'
import { useState } from 'react'
import { t } from '../../i18n'
import { toastError } from '../../lib/errors'
import { Button, Popover, TextField } from '../../ui'
import { ContextRing, ContextSummary, contextGauge, contextTitle } from './ContextRing'
import { uuid } from './MessageComposer'
import { postMessage } from './pending'

/** A bot's context window occupancy in this group, with /compact and /new at hand (both sent as group messages). */
export function ContextMeter({
  groupId,
  bot,
  context,
}: {
  groupId: string
  bot: string
  context: ContextUsage
}) {
  const [keep, setKeep] = useState('')
  const { level, detail } = contextGauge(context)
  const send = (command: string) =>
    postMessage(groupId, {
      body: `/${command} @${bot}`,
      clientId: uuid(),
      attachmentIds: [],
      quote: null,
      appendTo: null,
    }).catch(toastError)
  const compact = (close: () => void) => {
    close()
    const text = keep.replace(/\s+/g, ' ').trim()
    setKeep('')
    send(text ? `compact ${text}` : 'compact')
  }
  return (
    <Popover
      portal
      placement="bottom-end"
      width={272}
      aria-label={t('{bot} 的上下文', { bot })}
      trigger={
        <button
          type="button"
          className="ctx-meter"
          data-level={level}
          aria-label={t('{bot} 上下文 {detail}', { bot, detail })}
          title={contextTitle(context)}
        >
          <ContextRing context={context} />
        </button>
      }
    >
      {(close) => (
        <div className="ctx-pop">
          <ContextSummary context={context} />
          <TextField
            size="regular"
            aria-label={t('压缩时保留的重点（可选）')}
            placeholder={t('压缩时保留的重点（可选）')}
            value={keep}
            maxLength={500}
            onChange={(e) => setKeep(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) compact(close)
            }}
          />
          <div className="ctx-pop__actions">
            <Button
              size="small"
              variant="plain"
              onClick={() => {
                close()
                send('new')
              }}
            >
              {t('开新对话')}
            </Button>
            <Button size="small" variant="primary" onClick={() => compact(close)}>
              {t('压缩上下文')}
            </Button>
          </div>
        </div>
      )}
    </Popover>
  )
}
