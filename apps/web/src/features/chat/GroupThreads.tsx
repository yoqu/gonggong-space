import type { GroupDto, GroupThreadItemDto, GroupThreadsDto, MessageDto } from '@gonggong/protocol'
import { useCallback, useEffect, useRef, useState } from 'react'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { realtime } from '../../lib/realtime'
import { ago } from '../../lib/time'
import {
  AvatarGroup,
  Badge,
  Button,
  EmptyChatArt,
  EmptyState,
  FailedArt,
  Mascot,
  PanelHead,
  Spinner,
  Tag,
} from '../../ui'
import { openThread } from './thread'
import { useThreadLive, useThreadPeople } from './threadSummary'
import './group-threads.css'

const SNIPPET = 120
const REFRESH_MS = 300
const NEAR_END_PX = 80

const snippet = (m: MessageDto) =>
  m.recalled
    ? t('该消息已撤回')
    : m.body.replace(/\s+/g, ' ').trim().slice(0, SNIPPET) || (m.attachments.length ? t('[附件]') : '')

function Row({ item, live }: { item: GroupThreadItemDto; live: boolean }) {
  const { root, state } = item
  const people = useThreadPeople(root.groupId, root.thread?.participants)
  const mentioned = state.mentioned
  return (
    <button
      type="button"
      className="group-threads__row"
      data-testid="group-thread"
      data-unread={state.unread > 0 || undefined}
      onClick={() => openThread(root.id, true)}
    >
      <span className="group-threads__top">
        {mentioned ? <span className="group-threads__at">{t('[有人@我] ')}</span> : null}
        <b>{root.authorName}</b>
        {root.thread ? <time dateTime={root.thread.lastReplyAt}>{ago(root.thread.lastReplyAt)}</time> : null}
      </span>
      <span className="group-threads__text">{snippet(root)}</span>
      <span className="group-threads__meta">
        <AvatarGroup people={people} size={20} max={3} />
        <span>{t('{n} 条回复', { n: root.thread?.replyCount ?? 0 })}</span>
        {live ? (
          <Tag tone="blue" icon="bolt">
            {t('Bot 回复中')}
          </Tag>
        ) : null}
        {state.unread ? <Badge count={state.unread} /> : null}
      </span>
    </button>
  )
}

/** 话题 of one group in the chat's right rail: bots at work first, then the latest reply first. */
export function GroupThreads({ group, onClose }: { group: GroupDto; onClose: () => void }) {
  const [first, setFirst] = useState<GroupThreadsDto | null>(null)
  // Pages loaded further down stay while the first page refreshes.
  const [rest, setRest] = useState<{ threads: GroupThreadItemDto[]; next: number | null } | null>(null)
  const [failed, setFailed] = useState(false)
  const loadingMore = useRef(false)
  const liveRoots = useThreadLive((s) => s.roots)
  const url = `/groups/${group.id}/threads`

  const firstRef = useRef(first)
  firstRef.current = first
  const refresh = useCallback(async () => {
    try {
      const page = await api.get<GroupThreadsDto>(url)
      // Threads pushed off the first page by newer ones stay among the pages loaded further down.
      const old = firstRef.current?.threads ?? []
      setRest(
        (r) =>
          r && { ...r, threads: [...new Map([...r.threads, ...old].map((x) => [x.root.id, x])).values()] },
      )
      setFirst(page)
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }, [url])
  const list =
    first &&
    [...new Map([...(rest?.threads ?? []), ...first.threads].map((x) => [x.root.id, x])).values()].sort(
      (a, b) => (b.root.thread?.lastReplyAt ?? '').localeCompare(a.root.thread?.lastReplyAt ?? ''),
    )
  const next = rest ? rest.next : (first?.next ?? null)
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh

  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRoots changing (a bot starts or ends) re-orders the list
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const later = () => {
      clearTimeout(timer)
      timer = setTimeout(() => void refreshRef.current(), REFRESH_MS)
    }
    later()
    const off = realtime.subscribe((e) => {
      if (e.t === 'thread.state' && e.groupId === group.id) later()
      else if (e.t === 'thread.updated' && e.groupId === group.id) later()
    })
    const offReconnect = realtime.onReconnect(later)
    return () => {
      clearTimeout(timer)
      off()
      offReconnect()
    }
  }, [group.id, liveRoots])

  const more = async () => {
    if (next === null || loadingMore.current) return
    loadingMore.current = true
    try {
      const page = await api.get<GroupThreadsDto>(`${url}?cursor=${next}`)
      setRest((r) => ({ threads: [...(r?.threads ?? []), ...page.threads], next: page.next }))
    } catch {
      setFailed(true)
    } finally {
      loadingMore.current = false
    }
  }

  const isLive = (x: GroupThreadItemDto) => x.live || liveRoots.has(x.root.id)
  const rows = list && [...list.filter(isLive), ...list.filter((x) => !isLive(x))]

  return (
    <aside className="pn-threadpanel group-threads" aria-label={t('本群话题')}>
      <PanelHead onClose={onClose} closeLabel={t('关闭话题')}>
        <div className="pn-threadpanel__titles">
          <span>{t('话题#inbox')}</span>
          <span className="pn-threadpanel__sub">{`# ${group.name}`}</span>
        </div>
      </PanelHead>
      {failed && !list ? (
        <div className="group-threads__center">
          <EmptyState
            bare
            illustration={<FailedArt />}
            title={t('话题加载失败')}
            actions={
              <Button size="small" onClick={() => void refresh()}>
                {t('重试')}
              </Button>
            }
          />
        </div>
      ) : !rows ? (
        <div className="group-threads__center">
          <Mascot action="wait" size={56} label={t('加载中')} />
        </div>
      ) : !rows.length ? (
        <div className="group-threads__center">
          <EmptyState
            bare
            illustration={<EmptyChatArt />}
            title={t('还没有话题')}
            description={t('在任意消息上选择「回复话题」即可开始')}
          />
        </div>
      ) : (
        <div
          className="group-threads__list"
          onScroll={(e) => {
            const el = e.currentTarget
            if (el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_END_PX) void more()
          }}
        >
          {rows.map((x) => (
            <Row key={x.root.id} item={x} live={isLive(x)} />
          ))}
          {next !== null ? <Spinner /> : null}
        </div>
      )}
    </aside>
  )
}
