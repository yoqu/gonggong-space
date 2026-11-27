import {
  AGENT_META,
  type GroupDto,
  type MessageDto,
  type RunDto,
  type ThreadStateDto,
} from '@gonggong/protocol'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useSession } from '../../app/session'
import { useIsMobile } from '../../app/viewport'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { cx } from '../../lib/cx'
import { toastError } from '../../lib/errors'
import {
  Button,
  EmptyState,
  FailedArt,
  Icon,
  IconButton,
  Mascot,
  reducedMotion,
  Spinner,
  ThreadPanel,
  toast,
  useEscape,
} from '../../ui'
import { eventCard, progressOfRuns, runReplies } from './EventCard'
import { lastEditable } from './editing'
import { ActiveRunsContext, startedRunIds } from './MessageActions'
import { MessageComposer } from './MessageComposer'
import { PendingMessages } from './PendingMessages'
import { ThreadTitle } from './ThreadTitle'
import { BotReply, EventRow, messageKey, RecallRow, RunCard, UserMessage } from './TimelineItems'
import { setThreadLayout, useThreadLayout, useThreadSideFits } from './threadLayout'
import { InThread, ThreadScope } from './threadSummary'
import { useTimeline } from './useTimeline'

const STICK_PX = 80
const FLASH_MS = 2000

/** What to bring into view in a thread: a run's card (or one of its approval / question cards), or a reply. */
export interface ThreadFocus {
  rootId: string
  runId?: string
  pendingId?: string
  messageId?: string
}
/** Older pages a linked reply may be searched through. */
const LINK_PAGES = 20
const LOAD_OLDER_PX = 40

/** One thread in the chat's right rail (plan 话题): its root, replies and run cards, and a composer replying in it. */
export function ThreadView({
  group,
  rootId,
  readOnly = false,
  focus = null,
  onFocused,
  onBack,
  onClose,
}: {
  group: GroupDto
  rootId: string
  readOnly?: boolean
  focus?: ThreadFocus | null
  onFocused?: () => void
  onBack?: () => void
  onClose: () => void
}) {
  useEscape(onClose)
  const tl = useTimeline(group.id, rootId)
  const me = useSession((s) => s.user)
  const latestMessages = useRef(tl.messages)
  latestMessages.current = tl.messages
  const editLast = useCallback(() => lastEditable(latestMessages.current, me?.id), [me?.id])
  const scroll = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const olderAnchor = useRef<number | null>(null)
  const focusPages = useRef(0)
  const root = tl.messages.find((m) => m.id === rootId)
  const replies = useMemo(() => tl.messages.filter((m) => m.id !== rootId), [tl.messages, rootId])
  const lastSeq = replies.at(-1)?.seq ?? 0

  useEffect(() => {
    if (readOnly || !tl.loaded || !tl.threadState?.unread) return
    api.put(`/messages/${rootId}/thread/read`, { seq: lastSeq }).catch(() => {})
  }, [readOnly, tl.loaded, tl.threadState?.unread, rootId, lastSeq])

  // biome-ignore lint/correctness/useExhaustiveDependencies: new replies and growing run cards re-pin the view
  useLayoutEffect(() => {
    const el = scroll.current
    if (!el) return
    if (olderAnchor.current !== null) {
      el.scrollTop += el.scrollHeight - olderAnchor.current
      olderAnchor.current = null
    } else if (stick.current) el.scrollTop = el.scrollHeight
  }, [tl.messages, tl.runs])

  // The card may arrive after the thread loads, so messages and runs re-run this until it is found.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    const el = scroll.current
    if (!focus || !el || !tl.loaded) return
    const target = focus.messageId ?? focus.pendingId ?? focus.runId
    if (!target) return onFocused?.()
    const id = CSS.escape(target)
    const card = el.querySelector<HTMLElement>(
      focus.messageId
        ? `[data-msg-id="${id}"]`
        : focus.pendingId
          ? `[data-pending-id="${id}"]`
          : `[data-run-id="${id}"]`,
    )
    if (!card) {
      // A linked reply may sit on an older page: load back until it shows.
      if (focus.messageId) {
        if (tl.hasMore && tl.older === 'idle' && focusPages.current < LINK_PAGES) {
          focusPages.current++
          tl.loadOlder().catch(() => {})
        } else if (tl.older !== 'loading') {
          focusPages.current = 0
          toast({ type: 'error', message: t('没找到这条回复') })
          onFocused?.()
        }
      }
      return
    }
    focusPages.current = 0
    stick.current = false
    card.scrollIntoView?.({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' })
    card.classList.remove('tl-item--flash')
    void card.offsetWidth
    card.classList.add('tl-item--flash')
    setTimeout(() => card.classList.remove('tl-item--flash'), FLASH_MS)
    onFocused?.()
  }, [focus, tl.loaded, tl.hasMore, tl.older, tl.loadOlder, tl.messages, tl.runs, onFocused])

  const loadOlder = () => {
    const el = scroll.current
    if (el) olderAnchor.current = el.scrollHeight
    tl.loadOlder().catch(() => {
      olderAnchor.current = null
    })
  }
  const onScroll = () => {
    const el = scroll.current
    if (!el) return
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX
    if (el.scrollTop < LOAD_OLDER_PX && tl.hasMore && tl.older === 'idle') loadOlder()
  }

  const item = useThreadItem(group, tl.messages, tl.runs, readOnly, tl.arrived)
  const runList = useMemo(() => Object.values(tl.runs), [tl.runs])
  const liveRuns = useRef(runList)
  liveRuns.current = runList

  const layout = useThreadLayout()
  const sideFits = useThreadSideFits()
  const mobile = useIsMobile()
  // In the chat's place the way out is 返回群聊, unless it came from the thread list (back leads there).
  const inChatsPlace = !mobile && (layout === 'replace' || !sideFits)
  const following = tl.threadState?.following ?? false
  const follow = async () => {
    try {
      await api.put<ThreadStateDto>(`/messages/${rootId}/thread/follow`, { following: !following })
    } catch (e) {
      toastError(e)
      return
    }
    toast({
      type: 'success',
      message: following ? t('已取消关注话题') : t('已关注，新回复会出现在「话题」里'),
    })
  }

  return (
    <ActiveRunsContext.Provider value={liveRuns}>
      <ThreadScope.Provider value={rootId}>
        <ThreadPanel
          className="thread-view"
          heading={<ThreadTitle root={root} readOnly={readOnly} />}
          subtitle={`# ${group.name}`}
          onClose={onBack || !inChatsPlace ? onClose : undefined}
          onBack={onBack ?? (inChatsPlace ? onClose : undefined)}
          backLabel={onBack ? undefined : t('返回群聊')}
          scrollRef={scroll}
          onScroll={onScroll}
          replyCount={root?.thread?.replyCount ?? replies.length}
          actions={
            <>
              {readOnly || !tl.loaded ? null : (
                <Button
                  size="small"
                  variant="plain"
                  icon={following ? 'bell-slash' : 'bell'}
                  onClick={follow}
                >
                  {following ? t('取消关注#thread') : t('关注#thread')}
                </Button>
              )}
              {mobile || !sideFits ? null : (
                <IconButton
                  size="small"
                  title={layout === 'replace' ? t('在右侧并排查看') : t('顶掉群聊查看')}
                  onClick={() => void setThreadLayout(layout === 'replace' ? 'side' : 'replace')}
                >
                  <Icon name={layout === 'replace' ? 'sidebar-right' : 'expand'} />
                </IconButton>
              )}
            </>
          }
          root={
            tl.failed ? (
              <EmptyState
                bare
                illustration={<FailedArt />}
                title={t('话题加载失败')}
                actions={
                  <Button size="small" onClick={tl.retry}>
                    {t('重试')}
                  </Button>
                }
              />
            ) : root ? (
              <InThread.Provider value>{item(root)}</InThread.Provider>
            ) : tl.loaded ? (
              <EmptyState bare title={t('话题不存在或已删除')} />
            ) : (
              <Mascot action="wait" size={56} label={t('加载中')} />
            )
          }
          composer={false}
          footer={
            readOnly ? undefined : (
              <MessageComposer group={group} thread={rootId} onSent={tl.addMessage} lastEditable={editLast} />
            )
          }
        >
          {tl.older === 'loading' ? (
            <Spinner />
          ) : tl.older === 'failed' ? (
            <div className="chat-scroll__older" data-testid="thread-older-error">
              {t('加载更早回复失败')}
              <Button size="small" variant="plain" onClick={loadOlder}>
                {t('重试')}
              </Button>
            </div>
          ) : null}
          {replies.map(item)}
          {tl.loaded && !readOnly ? (
            <PendingMessages
              groupId={group.id}
              thread={rootId}
              messages={tl.messages}
              onSent={tl.addMessage}
            />
          ) : null}
        </ThreadPanel>
      </ThreadScope.Provider>
    </ActiveRunsContext.Provider>
  )
}

/**
 * Renders one message of a thread: a bot reply inside its run's card, the other runs it started under it. Shared by
 * ThreadView and the canvas's AI 对话.
 */
export function useThreadItem(
  group: GroupDto,
  messages: MessageDto[],
  runs: Record<string, RunDto>,
  readOnly = false,
  arrived?: ReadonlySet<string>,
) {
  const me = useSession((s) => s.user)
  const bots = useWorkspace((s) => s.bots)
  const botsById = useMemo(() => new Map(bots.map((b) => [b.id, b])), [bots])
  const liveRuns = useRef<RunDto[]>([])
  liveRuns.current = Object.values(runs)
  const startedRuns = useCallback((messageId: string) => startedRunIds(liveRuns.current, messageId), [])
  const { runsByTrigger, replyRuns, progressByRun } = useMemo(() => {
    const replies = runReplies(messages, runs)
    const replyRuns = new Map<string, RunDto>()
    for (const [runId, m] of replies) replyRuns.set(m.id, runs[runId] as RunDto)
    const runsByTrigger = new Map<string, RunDto[]>()
    for (const r of Object.values(runs).sort((a, b) => a.queuedAt.localeCompare(b.queuedAt)))
      if (!replies.has(r.id))
        runsByTrigger.set(r.triggerMessageId, [...(runsByTrigger.get(r.triggerMessageId) ?? []), r])
    return { runsByTrigger, replyRuns, progressByRun: progressOfRuns(messages, runs) }
  }, [messages, runs])
  const targets = useMemo(
    () => [
      ...bots.map((b) => ({ id: b.id, name: b.name })),
      ...group.members.map((m) => ({ id: m.userId, name: m.name })),
    ],
    [bots, group.members],
  )
  const userName = (id: string | null) => group.members.find((m) => m.userId === id)?.name ?? '—'

  const card = (r: RunDto, reply?: MessageDto) => {
    const bot = botsById.get(r.botId)
    return (
      <RunCard
        key={r.id}
        run={r}
        reply={reply}
        botName={bot?.name ?? 'bot'}
        agent={bot ? AGENT_META[bot.agentKind].name : ''}
        trigger={r.triggerUserId ? userName(r.triggerUserId) : '—'}
        foldable={group.foldRuns}
        progress={progressByRun.get(r.id)}
      />
    )
  }
  const item = (m: MessageDto) => {
    const run = replyRuns.get(m.id)
    // A run's progress card shows inside its card.
    if (m.progress?.runId && progressByRun.has(m.progress.runId)) return null
    const special = run ? null : eventCard(m)
    const body = run ? (
      card(run, m)
    ) : special ? (
      special
    ) : m.kind === 'event' ? (
      <EventRow m={m} />
    ) : m.recalled || m.hidden ? (
      <RecallRow m={m} mine={m.authorId === me?.id} />
    ) : m.kind === 'bot' ? (
      <BotReply m={m} />
    ) : (
      <UserMessage
        m={m}
        targets={targets}
        meId={me?.id}
        mine={m.authorId === me?.id}
        startedRuns={startedRuns}
      />
    )
    return (
      <div
        key={messageKey(m)}
        data-msg-id={m.id}
        className={cx('tl-item', arrived?.has(m.id) && 'tl-item--enter')}
        inert={readOnly}
      >
        {body}
        {runsByTrigger.get(m.id)?.map((r) => card(r))}
      </div>
    )
  }

  return item
}
