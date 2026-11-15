import type { BotDto } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { t } from '../../i18n'
import { Icon } from '../../ui'
import { groupsApi } from '../groups/api'

const join = (bots: BotDto[]) => bots.map((b) => b.name).join('、')

/** One line for the bots a message would wait on or never reach; null when all can run (busy ones queue briefly). */
export function presenceHint(bots: BotDto[], waitMin: number | null) {
  const offline = bots.filter((b) => b.presence === 'offline')
  const missing = bots.filter((b) => b.presence === 'agent_missing')
  const pending = bots.filter((b) => b.presence === 'pending_bind' || b.presence === 'pending_confirm')
  const parts = [
    offline.length
      ? waitMin === null
        ? t('{name} 离线，消息会等上线后处理', { name: join(offline) })
        : t('{name} 离线，消息会等上线后处理，超过 {n} 分钟作废', { name: join(offline), n: waitMin })
      : '',
    missing.length ? t('{name} 所在机器缺少 agent，暂时无法响应', { name: join(missing) }) : '',
    pending.length ? t('{name} 还不可触发', { name: join(pending) }) : '',
  ].filter(Boolean)
  return parts.length ? parts.join(t('；')) : null
}

const waits = new Map<string, number>()

/** Above the composer: warns, never blocks — an offline bot's message still runs once it is back in time. */
export function BotPresenceHint({ groupId, bots }: { groupId: string; bots: BotDto[] }) {
  const anyOffline = bots.some((b) => b.presence === 'offline')
  const [waitMin, setWaitMin] = useState(() => waits.get(groupId) ?? null)
  useEffect(() => {
    setWaitMin(waits.get(groupId) ?? null)
    if (!anyOffline || waits.has(groupId)) return
    let live = true
    groupsApi.params(groupId).then(
      (p) => {
        waits.set(groupId, p.offlineWaitMin)
        if (live) setWaitMin(p.offlineWaitMin)
      },
      () => {},
    )
    return () => {
      live = false
    }
  }, [groupId, anyOffline])
  const text = presenceHint(bots, waitMin)
  if (!text) return null
  return (
    <p className="composer__presence" role="status">
      <Icon name="info" size={12} />
      <span>{text}</span>
    </p>
  )
}
