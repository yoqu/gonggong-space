import type { BotDto, GroupDto, GroupProviderStateDto } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { realtime } from '../../lib/realtime'
import { Button, PinnedBanner } from '../../ui'
import { postMessage, uuid } from './MessageComposer'

type Item = GroupProviderStateDto['items'][number]

/**
 * Above the composer (design §4.3): bots of this group whose session keeps a provider other than a new session
 * would use. Held in server memory only, so it is fetched on open and replaced by group.providerState.
 */
export function ProviderBanner({ group }: { group: GroupDto }) {
  const bots = useWorkspace((s) => s.bots)
  const [items, setItems] = useState<Item[]>([])
  const [sending, setSending] = useState<string | null>(null)

  useEffect(() => {
    setItems([])
    const load = () =>
      api.get<GroupProviderStateDto>(`/groups/${group.id}/provider-state`).then(
        (s) => setItems(s.items),
        () => {},
      )
    load()
    const offEvents = realtime.subscribe((e) => {
      if (e.t === 'group.providerState' && e.groupId === group.id) setItems(e.items)
    })
    const offStatus = realtime.onStatus((st) => {
      if (st === 'open') load()
    })
    return () => {
      offEvents()
      offStatus()
    }
  }, [group.id])

  // Same as typing the Agent command: `/new @bot` in the group.
  const renew = (bot: BotDto) => {
    setSending(bot.id)
    postMessage(group.id, {
      body: `/new @${bot.name}`,
      clientId: uuid(),
      attachmentIds: [],
      quote: null,
      appendTo: null,
    })
      .catch(toastError)
      .finally(() => setSending(null))
  }

  const shown = items.flatMap((i) => {
    const bot = group.botIds.includes(i.botId) ? bots.find((b) => b.id === i.botId) : undefined
    return bot ? [{ ...i, bot }] : []
  })
  if (!shown.length) return null
  return (
    <div className="provider-banners">
      {shown.map(({ bot, session, effective }) => (
        <PinnedBanner
          key={bot.id}
          icon="info"
          color="var(--system-blue)"
          title={null}
          text={t('{name} 本会话使用 {session}；已切换为 {effective}，开启新会话后生效', {
            name: bot.name,
            session,
            effective,
          })}
          action={
            <Button size="small" disabled={sending === bot.id} onClick={() => renew(bot)}>
              {t('开启新会话')}
            </Button>
          }
        />
      ))}
    </div>
  )
}
