import type { MessageDto, UnreadsDto } from '@gonggong/protocol'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { realtime } from '../../lib/realtime'
import { ago } from '../../lib/time'
import { Button, EmptyChatArt, EmptyState, FailedArt, Input, Mascot, toast } from '../../ui'
import { GroupAvatar } from '../groups/GroupAvatar'
import { uuid } from './MessageComposer'
import './thread-inbox.css'

type Item = UnreadsDto['groups'][number]

const SNIPPET = 140
const REFRESH_MS = 300

const snippet = (m: MessageDto) =>
  m.recalled
    ? t('该消息已撤回')
    : m.body.replace(/\s+/g, ' ').trim().slice(0, SNIPPET) || (m.attachments.length ? t('[附件]') : '')

function Reply({ groupId }: { groupId: string }) {
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const send = async () => {
    if (!body.trim() || busy) return
    setBusy(true)
    try {
      await api.post(`/groups/${groupId}/messages`, { body, clientId: uuid() })
      setBody('')
    } catch {
      toast({ type: 'error', message: t('发送失败') })
    } finally {
      setBusy(false)
    }
  }
  return (
    <form
      className="unread-inbox__reply"
      onSubmit={(e) => {
        e.preventDefault()
        void send()
      }}
    >
      <Input
        value={body}
        placeholder={t('回复…')}
        aria-label={t('回复…')}
        onChange={(e) => setBody(e.target.value)}
      />
      <Button size="small" type="submit" disabled={!body.trim() || busy}>
        {t('发送')}
      </Button>
    </form>
  )
}

function Card({ item, onRead }: { item: Item; onRead: () => void }) {
  const { group } = item
  return (
    <article className="thread-inbox__card unread-inbox__card" aria-label={group.name}>
      <header className="unread-inbox__head">
        <Link to={`/g/${group.id}`} className="unread-inbox__where">
          <GroupAvatar group={group} size={20} />
          {group.name}
        </Link>
        <Button size="small" variant="plain" onClick={onRead}>
          {t('标为已读')}
        </Button>
      </header>
      <span className="thread-inbox__replies">
        {item.messages.map((m) => (
          <p key={m.id} className="thread-inbox__line">
            <b>{m.authorName}</b>
            <span>{snippet(m)}</span>
            <time dateTime={m.createdAt}>{ago(m.createdAt)}</time>
          </p>
        ))}
      </span>
      {item.more ? (
        <Link to={`/g/${group.id}`} className="thread-inbox__more">
          {t('还有更多未读，去群里看')}
        </Link>
      ) : null}
      <Reply groupId={group.id} />
    </article>
  )
}

/** 全部未读: the unread messages of every group in one place (plan 未读与通知). */
export function UnreadInbox({ onBack }: { onBack?: () => void }) {
  const [list, setList] = useState<Item[] | null>(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    try {
      setList((await api.get<UnreadsDto>('/unreads')).groups)
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }, [])
  useEffect(() => {
    void load()
    let timer: ReturnType<typeof setTimeout> | undefined
    // Only arrivals add to the list; reading elsewhere leaves cards in place until the page is opened again.
    const off = realtime.subscribe((e) => {
      if (e.t !== 'message.new') return
      clearTimeout(timer)
      timer = setTimeout(() => void load(), REFRESH_MS)
    })
    const offReconnect = realtime.onReconnect(() => void load())
    return () => {
      clearTimeout(timer)
      off()
      offReconnect()
    }
  }, [load])

  const read = (groupId: string) => {
    setList((l) => l?.filter((x) => x.group.id !== groupId) ?? null)
    api.post(`/groups/${groupId}/read`, {}).catch(() => void load())
  }

  return (
    <section className="works thread-inbox" aria-label={t('全部未读')}>
      <header className="works__head">
        {onBack ? (
          <Button size="small" variant="plain" icon="chevron-left" aria-label={t('返回')} onClick={onBack} />
        ) : null}
        <h1 className="works__title">{t('全部未读')}</h1>
      </header>
      {failed && !list ? (
        <div className="works__center">
          <EmptyState
            illustration={<FailedArt />}
            title={t('未读消息加载失败')}
            actions={
              <Button size="small" onClick={() => void load()}>
                {t('重试')}
              </Button>
            }
          />
        </div>
      ) : !list ? (
        <div className="works__center">
          <Mascot action="wait" size={72} label={t('加载中')} />
        </div>
      ) : !list.length ? (
        <div className="works__center">
          <EmptyState illustration={<EmptyChatArt />} title={t('没有未读消息')} />
        </div>
      ) : (
        <div className="thread-inbox__list">
          {list.map((item) => (
            <Card key={item.group.id} item={item} onRead={() => read(item.group.id)} />
          ))}
        </div>
      )}
    </section>
  )
}
