import type { BotDto, UserBriefDto, UserDto } from '@gonggong/protocol'
import { useState } from 'react'
import { t } from '../../i18n'
import { useGet } from '../../lib/useGet'
import { Dialog, DiscardChangesDialog } from '../../ui'
import { BotDetail, type BotTab } from './BotSettings'
import './bots.css'

/** Bot detail opened from the chat sidebar, so members manage their bots without the admin console. */
export function BotDialog({
  bot,
  me,
  tab,
  onClose,
}: {
  bot: BotDto
  me: UserDto
  tab?: BotTab
  onClose: () => void
}) {
  const users = useGet<UserBriefDto[]>('/users').data ?? []
  const [dirty, setDirty] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const requestClose = () => {
    if (dirty) setConfirming(true)
    else onClose()
  }
  return (
    <>
      <Dialog open title={t('Bot 详情')} width={540} closeOnBackdrop={!dirty} onClose={requestClose}>
        <BotDetail key={bot.id} bot={bot} me={me} users={users} tab={tab} plain onDirtyChange={setDirty} />
      </Dialog>
      <DiscardChangesDialog
        open={confirming}
        onCancel={() => setConfirming(false)}
        onDiscard={() => {
          setConfirming(false)
          setDirty(false)
          onClose()
        }}
      />
    </>
  )
}
