import type { GroupDto, MessageDto, RunDto, ThreadStateDto } from '@gonggong/protocol'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { Button, EmptyState, FailedArt, Mascot, Spinner, ThreadPanel, toast } from '../../ui'
import { AGENT_LABEL } from '../bots/model'
import { lastEditable } from './editing'
import { MessageComposer } from './MessageComposer'
import { BotReply, EventRow, RecallRow, RunCard, UserMessage } from './TimelineItems'
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
  const tl = useTimeline(group.id, rootId)
  const me = useSession((s) => s.user)
  const latestMessages = useRef(tl.messages)
  latestMessages.current = tl.messages
  const editLast = useCallback(() => lastEditable(latestMessages.current, me?.id), [me?.id])
  const bots = useWorkspace((s) => s.bots)
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
    card.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
    card.classList.remove('tl-item--flash')
    void card.offsetWidth
    card.classList.add('tl-item--flash')
    setTimeout(() => card.classList.remove('tl-item--flash'), FLASH_MS)
    onFocused?.()
  }, [focus, tl.loaded, tl.hasMore, tl.older, tl.loadOlder, tl.messages, tl.runs, onFocused])

  const onScroll = () => {
    const el = scroll.current
    if (!el) return
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX
    if (el.scrollTop < LOAD_OLDER_PX && tl.hasMore && tl.older === 'idle') {
      olderAnchor.current = el.scrollHeight
      tl.loadOlder().catch(() => {
        olderAnchor.current = null
      })
    }
  }

  const botsById = useMemo(() => new Map(bots.map((b) => [b.id, b])), [bots])
  const { runsByTrigger, replyRuns } = useMemo(() => {
    const replyRuns = new Map<string, RunDto>()
    for (const m of tl.messages) {
      const run = m.kind === 'bot' && m.runId ? tl.runs[m.runId] : undefined
      if (run) replyRuns.set(m.id, run)
    }
    const answered = new Set([...replyRuns.values()].map((r) => r.id))
    const runsByTrigger = new Map<string, RunDto[]>()
    for (const r of Object.values(tl.runs).sort((a, b) => a.queuedAt.localeCompare(b.queuedAt)))
      if (!answered.has(r.id))
        runsByTrigger.set(r.triggerMessageId, [...(runsByTrigger.get(r.triggerMessageId) ?? []), r])
    return { runsByTrigger, replyRuns }
  }, [tl.messages, tl.runs])
  const names = useMemo(
    () => [...bots.map((b) => b.name), ...group.members.map((m) => m.name)],
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
        agent={bot ? AGENT_LABEL[bot.agentKind] : ''}
        trigger={r.triggerUserId ? userName(r.triggerUserId) : '—'}
        foldable={group.foldRuns}
      />
    )
  }
  const item = (m: MessageDto) => {
    const run = replyRuns.get(m.id)
    const body = run ? (
      card(run, m)
    ) : m.kind === 'event' ? (
      <EventRow m={m} />
    ) : m.recalled || m.hidden ? (
      <RecallRow m={m} mine={m.authorId === me?.id} />
    ) : m.kind === 'bot' ? (
      <BotReply m={m} />
    ) : (
      <UserMessage m={m} names={names} me={me?.name} mine={m.authorId === me?.id} />
    )
    return (
      <div key={m.id} data-msg-id={m.id} className="tl-item" inert={readOnly}>
        {body}
        {runsByTrigger.get(m.id)?.map((r) => card(r))}
      </div>
    )
  }

  const following = tl.threadState?.following ?? false
  const follow = async () => {
    try {
      await api.put<ThreadStateDto>(`/messages/${rootId}/thread/follow`, { following: !following })
    } catch (e) {
      toastError(e)
    }
  }

  return (
    <ThreadScope.Provider value={rootId}>
      <ThreadPanel
        className="thread-view"
        subtitle={`# ${group.name}`}
        onClose={onClose}
        onBack={onBack}
        scrollRef={scroll}
        onScroll={onScroll}
        replyCount={root?.thread?.replyCount ?? replies.length}
        actions={
          readOnly || !tl.loaded ? null : (
            <Button size="small" variant="plain" icon={following ? 'bell-slash' : 'bell'} onClick={follow}>
              {following ? t('取消关注#thread') : t('关注#thread')}
            </Button>
          )
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
        {tl.older === 'loading' ? <Spinner /> : null}
        {replies.map(item)}
      </ThreadPanel>
    </ThreadScope.Provider>
  )
}
