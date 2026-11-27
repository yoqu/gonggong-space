import type { GroupDto, GroupThreadItemDto, GroupThreadsDto } from '@gonggong/protocol'
import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react'
import { useIsMobile } from '../../app/viewport'
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
  paletteColor,
  SearchField,
  Spinner,
  Tag,
  useEscape,
} from '../../ui'
import { openThread } from './thread'
import { useThreadLayout, useThreadSideFits } from './threadLayout'
import { useThreadLive, useThreadPeople } from './threadSummary'
import './group-threads.css'
import { messageSnippet } from './snippet'

const REFRESH_MS = 300
const NEAR_END_PX = 80

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
      style={{ '--thread-hue': paletteColor(root.id) } as CSSProperties}
      onClick={() => openThread(root.id, true)}
    >
      <span className="group-threads__top">
        {mentioned ? <span className="group-threads__at">{t('[有人@我] ')}</span> : null}
        <b>{root.authorName}</b>
        {root.thread ? <time dateTime={root.thread.lastReplyAt}>{ago(root.thread.lastReplyAt)}</time> : null}
      </span>
      {root.threadTitle ? <span className="group-threads__title">{root.threadTitle}</span> : null}
      <span className="group-threads__text">{messageSnippet(root)}</span>
      <span className="group-threads__meta">
        <AvatarGroup people={people} size={20} max={3} />
        <span>{t('{n} 条回复', { n: root.thread?.replyCount ?? 0 })}</span>
        {live ? (
          <Tag tone="blue" icon="bolt">
            {t('Bot 回复中')}
          </Tag>
        ) : null}
        <Badge count={state.unread} />
      </span>
    </button>
  )
}

/** 话题 of one group in the chat's right rail: bots at work first, then the latest reply first. */
export function GroupThreads({ group, onClose }: { group: GroupDto; onClose: () => void }) {
  useEscape(onClose)
  const [first, setFirst] = useState<GroupThreadsDto | null>(null)
  // Pages loaded further down stay while the first page refreshes.
  const [rest, setRest] = useState<{ threads: GroupThreadItemDto[]; next: number | null } | null>(null)
  const [failed, setFailed] = useState(false)
  const [moreFailed, setMoreFailed] = useState(false)
  const loadingMore = useRef(false)
  const shown = useRef(new Set<string>())
  const liveRoots = useThreadLive((s) => s.roots)
  const [q, setQ] = useState('')
  const query = q.trim()
  const url = `/groups/${group.id}/threads${query ? `?q=${encodeURIComponent(query)}` : ''}`
  const urlRef = useRef(url)
  urlRef.current = url

  // Another search (or clearing it) starts over from its own first page.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset whenever the query changes
  useEffect(() => {
    setFirst(null)
    setRest(null)
    setFailed(false)
    setMoreFailed(false)
  }, [url])

  const firstRef = useRef(first)
  firstRef.current = first
  const refresh = useCallback(async () => {
    try {
      const page = await api.get<GroupThreadsDto>(url)
      if (urlRef.current !== url) return
      // Threads pushed off the first page by newer ones stay among the pages loaded further down.
      const old = firstRef.current?.threads ?? []
      setRest(
        (r) =>
          r && { ...r, threads: [...new Map([...r.threads, ...old].map((x) => [x.root.id, x])).values()] },
      )
      setFirst(page)
      setFailed(false)
    } catch {
      if (urlRef.current === url) setFailed(true)
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
      // A rename of a listed thread.
      else if (e.t === 'message.edited' && shown.current.has(e.message.id)) later()
    })
    const offReconnect = realtime.onReconnect(later)
    return () => {
      clearTimeout(timer)
      off()
      offReconnect()
    }
  }, [group.id, liveRoots, url])

  const more = async () => {
    if (next === null || loadingMore.current) return
    loadingMore.current = true
    setMoreFailed(false)
    const from = url
    try {
      const page = await api.get<GroupThreadsDto>(`${url}${query ? '&' : '?'}cursor=${next}`)
      if (urlRef.current !== from) return
      setRest((r) => ({ threads: [...(r?.threads ?? []), ...page.threads], next: page.next }))
    } catch {
      if (urlRef.current === from) setMoreFailed(true)
    } finally {
      loadingMore.current = false
    }
  }

  const isLive = (x: GroupThreadItemDto) => x.live || liveRoots.has(x.root.id)
  const rows = list && [...list.filter(isLive), ...list.filter((x) => !isLive(x))]
  shown.current = new Set(rows?.map((x) => x.root.id))
  const mobile = useIsMobile()
  const layout = useThreadLayout()
  const sideFits = useThreadSideFits()
  const inChatsPlace = !mobile && (layout === 'replace' || !sideFits)

  return (
    <aside className="pn-threadpanel group-threads" aria-label={t('本群话题')}>
      <PanelHead
        onClose={inChatsPlace ? undefined : onClose}
        onBack={inChatsPlace ? onClose : undefined}
        backLabel={t('返回群聊')}
        closeLabel={t('关闭话题')}
      >
        <div className="pn-threadpanel__titles">
          <span>{t('话题#inbox')}</span>
          <span className="pn-threadpanel__sub">{`# ${group.name}`}</span>
        </div>
      </PanelHead>
      <SearchField className="group-threads__search" placeholder={t('搜索话题')} value={q} onChange={setQ} />
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
      ) : !rows.length && query ? (
        <div className="group-threads__center">
          <EmptyState bare illustration={<EmptyChatArt />} title={t('没有匹配的话题')} />
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
            if (moreFailed) return
            const el = e.currentTarget
            if (el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_END_PX) void more()
          }}
        >
          {rows.map((x) => (
            <Row key={x.root.id} item={x} live={isLive(x)} />
          ))}
          {moreFailed ? (
            <div className="group-threads__more-err">
              <span>{t('加载更多失败')}</span>
              <Button size="small" variant="plain" onClick={() => void more()}>
                {t('重试')}
              </Button>
            </div>
          ) : next !== null ? (
            <Spinner />
          ) : null}
        </div>
      )}
    </aside>
  )
}
