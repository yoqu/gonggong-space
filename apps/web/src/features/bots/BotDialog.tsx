import type { BotDto, UserBriefDto, UserDto } from '@gonggong/protocol'
import { useGet } from '../../lib/useGet'
import { Dialog } from '../../ui'
import { BotDetail } from './BotsAdminPage'
import './bots.css'

/** Bot detail opened from the chat sidebar, so members manage their bots without the admin console. */
export function BotDialog({ bot, me, onClose }: { bot: BotDto; me: UserDto; onClose: () => void }) {
  const users = useGet<UserBriefDto[]>('/users').data ?? []
  return (
    <Dialog open title="Bot 详情" width={540} onClose={onClose}>
      <BotDetail key={bot.id} bot={bot} me={me} users={users} plain />
    </Dialog>
  )
}
