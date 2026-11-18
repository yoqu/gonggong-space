import type { SecretCard, SecretNeedDto } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { t } from '../../i18n'
import { realtime } from '../../lib/realtime'
import { useGet } from '../../lib/useGet'
import { Button, PinnedBanner, Presence } from '../../ui'
import { FillDialog } from './SecretCard'
import { actionable, NeedsDialog } from './SecretNeeds'

const SNOOZE_MS = 24 * 3600_000
const snoozeKey = (groupId: string) => `gg.secretNeeds.snooze.${groupId}`

/** Snoozed for 24 hours for this exact set of missing names: a new one (e.g. an upgrade) shows it again. */
function snoozed(groupId: string, sig: string) {
  try {
    const s = JSON.parse(localStorage.getItem(snoozeKey(groupId)) ?? 'null') as {
      sig: string
      until: number
    } | null
    return !!s && s.sig === sig && s.until > Date.now()
  } catch {
    return false
  }
}

/**
 * Atop the chat, one line (plan Skill密钥声明 §6): my unfilled 填写密钥 cards, which newer messages would bury, and
 * the required secrets the group's skills declare that I can fill or create. Only the latter can be snoozed.
 */
export function SecretBanner({ groupId }: { groupId: string }) {
  const cards = useGet<SecretCard[]>(`/groups/${groupId}/secret-requests`)
  const needs = useGet<SecretNeedDto[]>(`/groups/${groupId}/secret-needs`)
  const [open, setOpen] = useState<'card' | 'needs' | null>(null)
  const [, setTick] = useState(0)
  const reloadCards = cards.reload
  const reloadNeeds = needs.reload
  useEffect(() => {
    const reload = () => {
      reloadCards()
      reloadNeeds()
    }
    const off = realtime.subscribe((e) => {
      if (
        (e.t === 'message.new' || e.t === 'message.edited') &&
        e.message.groupId === groupId &&
        e.message.secretCard
      )
        reload()
    })
    const offReconnect = realtime.onReconnect(reload)
    return () => {
      off()
      offReconnect()
    }
  }, [groupId, reloadCards, reloadNeeds])
  const first = cards.data?.[0]
  const todo = (needs.data ?? []).filter((n) => n.spec.required && actionable(n))
  const names = [...new Set(todo.map((n) => n.spec.name))].sort()
  const sig = names.join(',')
  // A card asking me means a run already needs it: the snooze gives way.
  const showNeeds = names.length > 0 && (!!first || !snoozed(groupId, sig))
  const count =
    (cards.data ?? []).reduce((k, c) => k + c.names.filter((n) => !names.includes(n)).length, 0) +
    (showNeeds ? names.length : 0)
  if (!first && !showNeeds) return null
  const done = () => {
    setOpen(null)
    reloadCards()
    reloadNeeds()
  }
  return (
    <div data-testid="secret-banner">
      <PinnedBanner
        icon="lock"
        title={null}
        text={t('本群有 {n} 个密钥待你配置', { n: count })}
        action={
          <Button size="small" variant="primary" onClick={() => setOpen(first ? 'card' : 'needs')}>
            {t('去配置')}
          </Button>
        }
        onClose={
          first
            ? undefined
            : () => {
                localStorage.setItem(
                  snoozeKey(groupId),
                  JSON.stringify({ sig, until: Date.now() + SNOOZE_MS }),
                )
                setTick((n) => n + 1)
              }
        }
        closeLabel={t('24 小时内不再提醒')}
      />
      <Presence>
        {open === 'card' && first ? (
          <FillDialog card={first} onClose={() => setOpen(null)} onDone={done} />
        ) : null}
        {open === 'needs' && needs.data ? (
          <NeedsDialog
            groupId={groupId}
            needs={needs.data.filter((n) => todo.some((x) => x.skill === n.skill))}
            onClose={() => setOpen(null)}
            onDone={done}
          />
        ) : null}
      </Presence>
    </div>
  )
}
