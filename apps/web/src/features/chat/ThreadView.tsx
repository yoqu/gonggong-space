import type { GroupDto, MessageDto, RunDto, ThreadStateDto } from '@gonggong/protocol'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { Button, EmptyState, FailedArt, Mascot, Spinner, ThreadPanel } from '../../ui'
import { AGENT_LABEL } from '../bots/model'
import { MessageComposer } from './MessageComposer'
import { BotReply, EventRow, RecallRow, RunCard, UserMessage } from './TimelineItems'
import { InThread } from './threadSummary'
import { useTimeline } from './useTimeline'

const STICK_PX = 80
const LOAD_OLDER_PX = 40

/** One thread in the chat's right rail (plan 话题): its root, replies and run cards, and a composer replying in it. */
export function ThreadView({
  group,
  rootId,
  readOnly = false,
  onClose,
}: {
  group: GroupDto
  rootId: string
  readOnly?: boolean
  onClose: () => void
}) {
  const tl = useTimeline(group.id, rootId)
  const me = useSession((s) => s.user)
  const bots = useWorkspace((s) => s.bots)
  const scroll = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const olderAnchor = useRef<number | null>(null)
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
    ) : m.recalled ? (
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
    <ThreadPanel
      className="thread-view"
      subtitle={`# ${group.name}`}
      onClose={onClose}
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
      footer={readOnly ? undefined : <MessageComposer group={group} thread={rootId} onSent={tl.addMessage} />}
    >
      {tl.older === 'loading' ? <Spinner /> : null}
      {replies.map(item)}
    </ThreadPanel>
  )
}
