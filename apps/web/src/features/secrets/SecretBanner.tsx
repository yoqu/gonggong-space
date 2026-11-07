import type { SecretCard } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { t } from '../../i18n'
import { realtime } from '../../lib/realtime'
import { useGet } from '../../lib/useGet'
import { Button, PinnedBanner, Presence } from '../../ui'
import { FillDialog } from './SecretCard'

/** My unfilled 填写密钥 cards of the group, kept atop the chat so newer messages don't bury them. */
export function SecretBanner({ groupId }: { groupId: string }) {
  const { data, reload } = useGet<SecretCard[]>(`/groups/${groupId}/secret-requests`)
  const [open, setOpen] = useState<SecretCard | null>(null)
  useEffect(() => {
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
  }, [groupId, reload])
  const first = data?.[0]
  if (!first) return null
  return (
    <div data-testid="secret-banner">
      <PinnedBanner
        icon="lock"
        title={null}
        text={t('你有 {n} 个密钥待填写', { n: data.length })}
        action={
          <Button size="small" variant="primary" onClick={() => setOpen(first)}>
            {t('填写密钥')}
          </Button>
        }
      />
      <Presence>
        {open ? (
          <FillDialog
            card={open}
            onClose={() => setOpen(null)}
            onDone={() => {
              setOpen(null)
              reload()
            }}
          />
        ) : null}
      </Presence>
    </div>
  )
}
