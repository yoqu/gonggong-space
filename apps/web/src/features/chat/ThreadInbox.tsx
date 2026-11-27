import type { MessageDto, ThreadInboxDto, ThreadInboxItemDto } from '@gonggong/protocol'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { cx } from '../../lib/cx'
import { toastError } from '../../lib/errors'
import { ago } from '../../lib/time'
import { useRealtimeRefresh } from '../../lib/useRealtimeRefresh'
import {
  Badge,
  Button,
  EmptyChatArt,
  EmptyState,
  FailedArt,
  Icon,
  Mascot,
  toast,
  useEscape,
  useLeaving,
} from '../../ui'
import { MessageComposer } from './MessageComposer'
import './thread-inbox.css'
import { messageSnippet } from './snippet'

function Line({ m }: { m: MessageDto }) {
  return (
    <span className="thread-inbox__line">
      <b>{m.authorName}</b>
      <span>{messageSnippet(m)}</span>
      <time dateTime={m.createdAt}>{ago(m.createdAt)}</time>
    </span>
  )
}

function Card({
  item,
  leaving,
  onSent,
  onRead,
  onUnfollow,
}: {
  item: ThreadInboxItemDto
  leaving: boolean
  onSent: () => void
  onRead: () => void
  onUnfollow: () => void
}) {
  const navigate = useNavigate()
  const group = useWorkspace((s) => s.groups.find((g) => g.id === item.groupId))
  const [replying, setReplying] = useState(false)
  const card = useRef<HTMLElement>(null)
  const opened = useRef(false)
  // Keyboard users land in the composer when it opens, and back on 回复 when Esc closes it.
  useEffect(() => {
    if (replying) card.current?.querySelector('textarea')?.focus()
    else if (opened.current) card.current?.querySelector<HTMLElement>('.thread-inbox__reply')?.focus()
    opened.current ||= replying
  }, [replying])
  useEscape(() => setReplying(false), replying)
  const { state } = item
  return (
    <article
      ref={card}
      className={cx('thread-inbox__card', leaving && 'ui-leaving')}
      data-unread={state.unread > 0 || undefined}
    >
      <button
        type="button"
        className="thread-inbox__open"
        onClick={() => navigate(`/g/${item.groupId}?thread=${item.root.id}`)}
      >
        <span className="thread-inbox__where">
          <Icon name="thread" size={12} />
          {item.groupName}
          {state.mentioned ? <span className="thread-inbox__at">{t('[有人@我] ')}</span> : null}
          <Badge count={state.unread} />
        </span>
        {item.root.threadTitle ? <span className="thread-inbox__title">{item.root.threadTitle}</span> : null}
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
      {group ? (
        replying ? (
          <div className="thread-inbox__composer">
            <MessageComposer
              group={group}
              thread={item.root.id}
              onSent={() => {
                setReplying(false)
                onSent()
              }}
            />
            <div className="thread-inbox__reply-bar">
              <Button size="small" variant="plain" onClick={() => setReplying(false)}>
                {t('收起回复')}
              </Button>
            </div>
          </div>
        ) : (
          <span className="thread-inbox__actions">
            <Button
              size="small"
              variant="plain"
              className="thread-inbox__reply"
              onClick={() => setReplying(true)}
            >
              {t('回复')}
            </Button>
            {state.unread ? (
              <Button size="small" variant="plain" icon="check" onClick={onRead}>
                {t('标为已读')}
              </Button>
            ) : null}
            <Button size="small" variant="plain" icon="bell-slash" onClick={onUnfollow}>
              {t('取消关注#thread')}
            </Button>
          </span>
        )
      ) : null}
    </article>
  )
}

/** 话题: the threads I follow, latest reply first (plan 话题 收件箱). */
export function ThreadInbox({ onBack }: { onBack?: () => void }) {
  const [list, setList] = useState<ThreadInboxItemDto[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [more, setMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const { leaving, leave } = useLeaving()

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
  useRealtimeRefresh(
    load,
    (e) =>
      e.t === 'thread.state' ||
      // A rename of a listed thread.
      (e.t === 'message.edited' && !!list?.some((x) => x.root.id === e.message.id)),
  )

  const older = async () => {
    const last = list?.at(-1)?.latest.at(-1)?.seq
    if (!last || loadingMore) return
    setLoadingMore(true)
    try {
      const { threads } = await api.get<ThreadInboxDto>(`/threads?before=${last}`)
      setList((l) => [...(l ?? []), ...threads])
      setMore(threads.length === 20)
    } catch (e) {
      toastError(e)
    } finally {
      setLoadingMore(false)
    }
  }

  const markRead = (ids: string[]) => {
    const read = new Set(ids)
    setList(
      (l) =>
        l?.map((x) =>
          read.has(x.root.id) ? { ...x, state: { ...x.state, unread: 0, mentioned: false } } : x,
        ) ?? null,
    )
    Promise.all(ids.map((id) => api.put(`/messages/${id}/thread/read`, {}))).catch((e) => {
      toastError(e)
      void load()
    })
  }
  const follow = (id: string, following: boolean) =>
    api.put(`/messages/${id}/thread/follow`, { following }).then(
      () => true,
      (e) => {
        toastError(e)
        return false
      },
    )
  const unfollow = async (id: string) => {
    leave(id, () => setList((l) => l?.filter((x) => x.root.id !== id) ?? null))
    if (!(await follow(id, false))) return void load()
    toast({
      type: 'success',
      message: t('已取消关注，新回复不会再出现在这里'),
      action: { label: t('撤销#undo'), onClick: () => void follow(id, true).then(() => load()) },
    })
  }
  const unread = list?.filter((x) => x.state.unread > 0) ?? []

  return (
    <section className="works thread-inbox" aria-label={t('话题#inbox')}>
      <header className="works__head">
        {onBack ? (
          <button type="button" className="pn-chathead__back" aria-label={t('返回')} onClick={onBack}>
            <Icon name="chevron-left" size={20} weight={1.8} />
          </button>
        ) : null}
        <h1 className="works__title">{t('话题#inbox')}</h1>
        <span className="spacer" />
        {unread.length ? (
          <Button
            size="small"
            variant="plain"
            icon="check"
            onClick={() => markRead(unread.map((x) => x.root.id))}
          >
            {t('全部标为已读')}
          </Button>
        ) : null}
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
            <Card
              key={item.root.id}
              item={item}
              leaving={leaving.has(item.root.id)}
              onSent={() => void load()}
              onRead={() => markRead([item.root.id])}
              onUnfollow={() => void unfollow(item.root.id)}
            />
          ))}
          {more ? (
            <Button
              size="small"
              variant="plain"
              loading={loadingMore}
              disabled={loadingMore}
              onClick={() => void older()}
            >
              {t('加载更多')}
            </Button>
          ) : null}
        </div>
      )}
    </section>
  )
}
