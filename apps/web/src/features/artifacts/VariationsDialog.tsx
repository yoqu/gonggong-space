import type { BotDto } from '@gonggong/protocol'
import { useState } from 'react'
import { t } from '../../i18n'
import { Dialog, Stepper, Textarea } from '../../ui'
import { BotChoice } from './ElementPopover'

/** Variations › Custom… (⇧V): the direction and how many, for each selected screen. */
export function VariationsDialog({
  screens,
  bots,
  bot,
  onPickBot,
  onSend,
  onClose,
}: {
  screens: string[]
  bots: BotDto[]
  bot: BotDto | null
  onPickBot: (id: string) => void
  onSend: (text: string, count: number) => Promise<boolean>
  onClose: () => void
}) {
  const [text, setText] = useState('')
  const [count, setCount] = useState(3)
  const [busy, setBusy] = useState(false)
  const send = async () => {
    setBusy(true)
    const ok = await onSend(text.trim(), count)
    setBusy(false)
    if (ok) onClose()
  }
  return (
    <Dialog
      open
      onClose={onClose}
      closeOnBackdrop={false}
      title={t('自定义变体')}
      message={screens.join('、')}
      actions={[
        { label: t('取消'), onClick: onClose },
        {
          label: bot ? t('发给 @{name}', { name: bot.name }) : t('群里没有 Bot'),
          variant: 'primary',
          disabled: busy || !bot || !text.trim(),
          onClick: () => void send(),
        },
      ]}
    >
      <div className="art-variations">
        <Textarea
          aria-label={t('变体方向')}
          placeholder={t('想往哪个方向变？例如：更活泼的配色、卡片改成列表')}
          rows={3}
          maxLength={2000}
          value={text}
          autoFocus
          onChange={(e) => setText(e.target.value)}
        />
        <div className="art-variations__row">
          <Stepper
            aria-label={t('数量')}
            label={t('数量')}
            min={1}
            max={5}
            value={count}
            onChange={setCount}
          />
          <BotChoice bots={bots} bot={bot} onPick={onPickBot} />
        </div>
      </div>
    </Dialog>
  )
}
