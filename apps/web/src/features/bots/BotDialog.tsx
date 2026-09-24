import type { BotDto, UserBriefDto, UserDto } from '@aiws/protocol'
import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { Dialog, toast } from '../../ui'
import { BotDetail } from './BotsAdminPage'
import './bots.css'

/** Bot detail opened from the chat sidebar, so members manage their bots without the admin console. */
export function BotDialog({ bot, me, onClose }: { bot: BotDto; me: UserDto; onClose: () => void }) {
  const [users, setUsers] = useState<UserBriefDto[]>([])
  useEffect(() => {
    api
      .get<UserBriefDto[]>('/users')
      .then(setUsers)
      .catch((e: Error) => toast({ type: 'error', message: e.message }))
  }, [])
  return (
    <Dialog open title="bot 详情" width={480} onClose={onClose}>
      <BotDetail key={bot.id} bot={bot} me={me} users={users} plain />
    </Dialog>
  )
}
