import type { PinnedMessageDto } from '@gonggong/protocol'
import { useEffect, useRef, useState } from 'react'
import { setPins, useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { attempt } from '../../lib/errors'
import { Linkified } from '../../lib/links'
import { Button, Icon, PinnedBanner, toast } from '../../ui'
import { usePinsExpanded } from '../group-tabs/store'

const NONE: PinnedMessageDto[] = []

export const usePins = (groupId: string) => useWorkspace((s) => s.pins[groupId] ?? NONE)

export const pinsApi = {
  pin: (groupId: string, messageId: string) =>
    attempt(async () =>
      setPins(
        groupId,
        (await api.post<{ pins: PinnedMessageDto[] }>(`/groups/${groupId}/pins`, { messageId })).pins,
      ),
    ),
  unpin: (groupId: string, messageId: string) =>
    attempt(async () => {
      await api.del(`/groups/${groupId}/pins/${messageId}`)
      setPins(groupId, useWorkspace.getState().pins[groupId]?.filter((p) => p.messageId !== messageId) ?? [])
    }),
}

const line = (p: PinnedMessageDto) => `${p.authorName}：${p.text || t('[{n} 个附件]', { n: p.attachments })}`

/** A pin's line: jumps to its message, except on a link in it, which opens itself (a button can't hold a link). */
function PinLine({ pin, onLocate }: { pin: PinnedMessageDto; onLocate: () => void }) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a <button> can't hold the link inside the line
    <span
      role="button"
      tabIndex={0}
      className="chat-pins__link"
      onClick={onLocate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onLocate()
        }
      }}
    >
      <Linkified text={line(pin)} />
    </span>
  )
}

/** 消息置顶 atop the chat: the newest pin, the rest one click away; a pin jumps to its message. */
export function PinnedMessages({
  groupId,
  onLocate,
}: {
  groupId: string
  onLocate: (pin: PinnedMessageDto) => void
}) {
  const pins = usePins(groupId)
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const count = useRef(0)
  count.current = pins.length
  // The 置顶消息 group tab: show them all.
  useEffect(
    () =>
      usePinsExpanded.subscribe(() => {
        if (!count.current) return toast({ message: t('本群还没有置顶消息') })
        setOpen(true)
        box.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
      }),
    [],
  )
  const [first] = pins
  if (!first) return null
  return (
    <div ref={box} data-testid="pinned-messages">
      <PinnedBanner
        icon="pin"
        title={t('置顶')}
        text={<PinLine pin={first} onLocate={() => onLocate(first)} />}
        action={
          pins.length > 1 ? (
            <Button
              size="small"
              variant="plain"
              aria-expanded={open}
              aria-label={t('全部 {n} 条置顶', { n: pins.length })}
              onClick={() => setOpen(!open)}
            >
              {t('全部 {n} 条', { n: pins.length })}
            </Button>
          ) : null
        }
        closeLabel={t('取消置顶')}
        onClose={() => void pinsApi.unpin(groupId, first.messageId)}
      />
      {open ? (
        <ul className="chat-pins">
          {pins.map((p) => (
            <li key={p.messageId} className="chat-pins__item" data-testid="pinned-item">
              <Icon name="pin" size={12} />
              <PinLine
                pin={p}
                onLocate={() => {
                  setOpen(false)
                  onLocate(p)
                }}
              />
              <span className="chat-pins__by">{t('{name} 置顶', { name: p.pinnedBy.name })}</span>
              <Button
                size="small"
                variant="plain"
                aria-label={t('取消置顶')}
                icon="xmark"
                onClick={() => void pinsApi.unpin(groupId, p.messageId)}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
