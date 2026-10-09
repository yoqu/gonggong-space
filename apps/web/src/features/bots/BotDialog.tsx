import type { BotDto, UserBriefDto, UserDto } from '@gonggong/protocol'
import { useGet } from '../../lib/useGet'
import { Dialog } from '../../ui'
import { BotDetail, type BotTab } from './BotSettings'
import './bots.css'
import { t } from '../../i18n'

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
  return (
    <Dialog open title={t('Bot 详情')} width={540} onClose={onClose}>
      <BotDetail key={bot.id} bot={bot} me={me} users={users} tab={tab} plain />
    </Dialog>
  )
}
