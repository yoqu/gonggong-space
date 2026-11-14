import type { ActionsBlock, AnswerActionsReq, MessageDto } from '@gonggong/protocol'
import { useContext, useState } from 'react'
import { t } from '../../i18n'
import { ApiError, api, errorText } from '../../lib/api'
import { Button, type ButtonVariant, toast } from '../../ui'
import { applyLocal } from '../chat/useTimeline'
import { RichMessage } from './context'

const VARIANT: Record<NonNullable<ActionsBlock['options'][number]['style']>, ButtonVariant> = {
  primary: 'primary',
  default: 'default',
  danger: 'destructive',
}

/**
 * ```actions: buttons under a bot reply. Answering posts `@bot 选择了「…」` as me (server side), once per block;
 * the answer shows to everyone. Outside a bot reply (files, process view) the buttons are read-only.
 */
export function Actions({ data }: { data: ActionsBlock }) {
  const message = useContext(RichMessage)
  const answer = message?.actions?.[data.id]
  const [picked, setPicked] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  const locked = !message || !!answer || busy

  const send = async (options: number[]) => {
    if (!message) return
    setBusy(true)
    try {
      const body: AnswerActionsReq = { blockId: data.id, options }
      const updated = await api.post<MessageDto>(`/messages/${message.id}/actions`, body)
      applyLocal({ t: 'message.edited', message: updated })
    } catch (e) {
      toast({
        type: 'error',
        message: e instanceof ApiError && e.status === 409 ? t('已有人作答') : errorText(e),
      })
    } finally {
      setBusy(false)
    }
  }
  const chosen = (label: string, i: number) => (answer ? answer.labels.includes(label) : picked.includes(i))

  return (
    <div className="rich-actions" data-answered={!!answer || undefined}>
      {data.prompt ? <span className="rich-actions__prompt">{data.prompt}</span> : null}
      <div className="rich-actions__options">
        {data.options.map((o, i) => (
          <Button
            // biome-ignore lint/suspicious/noArrayIndexKey: options are answered by index
            key={i}
            size="small"
            variant={VARIANT[o.style ?? 'default']}
            disabled={locked}
            aria-pressed={data.multiple || answer ? chosen(o.label, i) : undefined}
            onClick={() =>
              data.multiple
                ? setPicked((p) =>
                    p.includes(i) ? p.filter((x) => x !== i) : [...p, i].sort((a, b) => a - b),
                  )
                : send([i])
            }
          >
            {o.label}
          </Button>
        ))}
        {data.multiple && !answer ? (
          <Button
            size="small"
            variant="primary"
            disabled={locked || !picked.length}
            onClick={() => send(picked)}
          >
            {t('提交#submit')}
          </Button>
        ) : null}
      </div>
      {answer ? (
        <span className="rich-actions__answer">
          {t('{name} 已选择 {labels}', { name: answer.name, labels: answer.labels.join(t('、')) })}
        </span>
      ) : null}
    </div>
  )
}
