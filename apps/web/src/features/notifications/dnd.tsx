import type { MeDto, NotifyPrefs } from '@gonggong/protocol'
import { useState } from 'react'
import { useSession } from '../../app/session'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { attempt, toastError } from '../../lib/errors'
import { Button, Dialog, Input } from '../../ui'

/** 勿扰: PATCH /me merges it; null clears a field. */
export const saveNotifyPrefs = (prefs: NotifyPrefs) =>
  api.patch<MeDto>('/me', { notifyPrefs: prefs }).then((me) => useSession.getState().setUser(me))

/** Paused until this time, while it is still ahead. */
export function usePausedUntil() {
  const until = useSession((s) => s.tenancy?.notifyPrefs?.pausedUntil)
  return until && new Date(until) > new Date() ? new Date(until) : null
}

const later = (ms: number) => new Date(Date.now() + ms)
function tomorrowNine() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(9, 0, 0, 0)
  return d
}

/** 暂停通知 choices; `custom` opens a picker. */
export const PAUSE_CHOICES: { label: string; value: string; until?: () => Date }[] = [
  { label: t('30 分钟'), value: 'pause:30m', until: () => later(30 * 60_000) },
  { label: t('1 小时'), value: 'pause:1h', until: () => later(3600_000) },
  { label: t('2 小时'), value: 'pause:2h', until: () => later(2 * 3600_000) },
  { label: t('到明天 9 点'), value: 'pause:tomorrow', until: tomorrowNine },
  { label: t('自定义…'), value: 'pause:custom' },
]

export const pause = (until: Date) => attempt(() => saveNotifyPrefs({ pausedUntil: until.toISOString() }))
export const resume = () => attempt(() => saveNotifyPrefs({ pausedUntil: null }))

const local = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 暂停通知 · 自定义: until a chosen time. */
export function PauseDialog({ onClose }: { onClose: () => void }) {
  const [value, setValue] = useState(local(later(3600_000)))
  const until = new Date(value)
  const ok = !Number.isNaN(until.getTime()) && until > new Date()
  return (
    <Dialog
      open
      width={360}
      title={t('暂停通知')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('取消')}</Button>
          <Button
            variant="primary"
            disabled={!ok}
            onClick={() =>
              void saveNotifyPrefs({ pausedUntil: until.toISOString() }).then(onClose, toastError)
            }
          >
            {t('暂停')}
          </Button>
        </>
      }
    >
      <Input
        aria-label={t('暂停到')}
        type="datetime-local"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
    </Dialog>
  )
}
