import type { MessageDto, ThreadInboxDto, ThreadInboxItemDto } from '@gonggong/protocol'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { realtime } from '../../lib/realtime'
import { ago } from '../../lib/time'
import { Badge, Button, EmptyChatArt, EmptyState, FailedArt, Icon, Mascot } from '../../ui'
import './thread-inbox.css'

const SNIPPET = 140
const REFRESH_MS = 300

const snippet = (m: MessageDto) =>
  m.hidden
    ? t('你已删除这条消息')
    : m.recalled
      ? t('该消息已撤回')
      : m.body.replace(/\s+/g, ' ').trim().slice(0, SNIPPET) || (m.attachments.length ? t('[附件]') : '')

function Line({ m }: { m: MessageDto }) {
  return (
    <p className="thread-inbox__line">
      <b>{m.authorName}</b>
      <span>{snippet(m)}</span>
      <time dateTime={m.createdAt}>{ago(m.createdAt)}</time>
    </p>
  )
}

function Card({ item }: { item: ThreadInboxItemDto }) {
  const navigate = useNavigate()
  const { state } = item
  return (
    <button
      type="button"
      className="thread-inbox__card"
      data-unread={state.unread > 0 || undefined}
      onClick={() => navigate(`/g/${item.groupId}?thread=${item.root.id}`)}
    >
      <span className="thread-inbox__where">
        <Icon name="thread" size={12} />
        {item.groupName}
        {state.mentioned ? <span className="thread-inbox__at">{t('[有人@我] ')}</span> : null}
        {state.unread ? <Badge count={state.unread} /> : null}
      </span>
      <Line m={item.root} />
      {item.root.thread && item.root.thread.replyCount > item.latest.length ? (
        <span className="thread-inbox__more">
          {t('还有 {n} 条回复', { n: item.root.thread.replyCount - item.latest.length })}
        </span>
      ) : null}
      <span className="thread-inbox__replies">
        {item.latest.map((m) => (
          <Line key={m.id} m={m} />
        ))}
      </span>
    </button>
  )
}

/** 话题: the threads I follow, latest reply first (plan 话题 收件箱). */
export function ThreadInbox({ onBack }: { onBack?: () => void }) {
  const [list, setList] = useState<ThreadInboxItemDto[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [more, setMore] = useState(false)

  const load = useCallback(async () => {
    try {
      const { threads } = await api.get<ThreadInboxDto>('/threads')
      setList(threads)
      setMore(threads.length === 20)
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }, [])
  useEffect(() => {
    void load()
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = realtime.subscribe((e) => {
      if (e.t !== 'thread.state') return
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

  const older = async () => {
    const last = list?.at(-1)?.latest.at(-1)?.seq
    if (!last) return
    try {
      const { threads } = await api.get<ThreadInboxDto>(`/threads?before=${last}`)
      setList((l) => [...(l ?? []), ...threads])
      setMore(threads.length === 20)
    } catch {
      setFailed(true)
    }
  }

  return (
    <section className="works thread-inbox" aria-label={t('话题#inbox')}>
      <header className="works__head">
        {onBack ? (
          <Button size="small" variant="plain" icon="chevron-left" aria-label={t('返回')} onClick={onBack} />
        ) : null}
        <h1 className="works__title">{t('话题#inbox')}</h1>
      </header>
      {failed && !list ? (
        <div className="works__center">
          <EmptyState
            illustration={<FailedArt />}
            title={t('话题加载失败')}
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
          <EmptyState
            illustration={<EmptyChatArt />}
            title={t('还没有关注的话题')}
            description={t('在消息上点「回复话题」，或在话题里被 @，就会出现在这里。')}
          />
        </div>
      ) : (
        <div className="thread-inbox__list">
          {list.map((item) => (
            <Card key={item.root.id} item={item} />
          ))}
          {more ? (
            <Button size="small" variant="plain" onClick={() => void older()}>
              {t('加载更多')}
            </Button>
          ) : null}
        </div>
      )}
    </section>
  )
}
