import type { MessageDto } from '@gonggong/protocol'
import { useState } from 'react'
import { t } from '../../i18n'
import { pad } from '../../lib/time'
import { Button, Dialog, Input, type MenuItem, Presence } from '../../ui'
import { remindPresets, savedApi, useSaved } from './store'

const local = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`

/** 自定义 reminder time, in the browser's time zone. */
export function RemindDialog({ onPick, onClose }: { onPick: (at: Date) => void; onClose: () => void }) {
  const [value, setValue] = useState(() => local(new Date(Date.now() + 60 * 60_000)))
  const at = value ? new Date(value) : null
  const valid = !!at && !Number.isNaN(at.getTime()) && at.getTime() > Date.now()
  return (
    <Dialog
      open
      title={t('设置提醒时间')}
      width={360}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('取消')}</Button>
          <Button
            variant="primary"
            disabled={!valid}
            onClick={() => {
              if (at) onPick(at)
              onClose()
            }}
          >
            {t('确定')}
          </Button>
        </>
      }
    >
      <Input
        aria-label={t('提醒时间')}
        type="datetime-local"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
    </Dialog>
  )
}

/** 稍后处理 in a message's menus: save with a reminder (a submenu), change it, or remove it. */
export function useSaveMenu(message: MessageDto | null) {
  const saved = useSaved((s) => !!message && s.ids.has(message.id))
  const [custom, setCustom] = useState(false)
  const offer = !!message && message.kind !== 'event' && !message.recalled
  const item: MenuItem[] = offer
    ? [
        {
          value: 'later',
          label: saved ? t('修改提醒') : t('稍后处理'),
          icon: 'bookmark',
          submenu: [
            ...remindPresets().map((p) => ({ value: p.value, label: p.label })),
            ...(saved ? [{ separator: true as const }, { value: 'unsave', label: t('移除稍后处理') }] : []),
          ],
        },
      ]
    : []
  /** Handles the menu's value; false when it is not one of these. */
  const select = (value: string) => {
    if (!message) return false
    if (value === 'unsave') void savedApi.remove(message.id)
    else if (value === 'remind:custom') setCustom(true)
    else if (value.startsWith('remind:'))
      void savedApi.save(message.id, remindPresets().find((p) => p.value === value)?.at ?? null)
    else return false
    return true
  }
  const dialog = (
    <Presence>
      {custom && message ? (
        <RemindDialog onPick={(at) => void savedApi.save(message.id, at)} onClose={() => setCustom(false)} />
      ) : null}
    </Presence>
  )
  return { item, select, dialog, saved }
}
