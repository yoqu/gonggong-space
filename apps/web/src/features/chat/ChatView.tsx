import type { GroupDto, MessageDto, RunDto } from '@gonggong/protocol'
import { type DragEvent, Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { InspectorPortal, useInspector } from '../../app/inspector'
import { GROUP_MODE_LABEL } from '../../app/Sidebar'
import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { api } from '../../lib/api'
import { cx } from '../../lib/cx'
import {
  Button,
  ChatHeader,
  ChatNotice,
  DropZone,
  EmptyChatArt,
  EmptyState,
  FailedArt,
  Icon,
  Mascot,
  MessageList,
  Presence,
  Spinner,
  TypingIndicator,
} from '../../ui'
import { useBotCostume } from '../bots/avatars'
import { AGENT_LABEL } from '../bots/model'
import { GroupAvatar } from '../groups/GroupAvatar'
import { GroupInfo, type InfoView, type SettingsTab } from '../groups/GroupInfo'
import { GroupNotice } from '../groups/GroupNotice'
import { GroupSettingsDialog } from '../groups/GroupSettingsDialog'
import { GitBar } from './GitBar'
import { continues, eventFolds, sameDay, unreadStart } from './grouping'
import { MessageComposer } from './MessageComposer'
import { repoName } from './repo'
import { BotReply, dayLabel, EventFold, EventRow, RecallRow, RunCard, UserMessage } from './TimelineItems'
import { useTimeline } from './useTimeline'
import { WorkspaceBanner } from './WorkspaceBanner'
import './chat.css'
import './timeline.css'

/** Distance from the bottom (px) within which new items keep the view pinned to the end. */
const STICK_PX = 80
const LOAD_OLDER_PX = 40
/** Older pages loaded at most while looking for a `?msg=` target. */
const LINK_PAGES = 10
const FLASH_MS = 2000

/** Files dragged over the chat (not text or links): shows the drop zone until they leave or land. */
function useFileDrag() {
  const [over, setOver] = useState(false)
  // dragenter/dragleave fire for every child crossed; the depth tells when the pointer really left.
  const depth = useRef(0)
  const files = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files')
  const reset = () => {
    depth.current = 0
    setOver(false)
  }
  return {
    over,
    handlers: {
      onDragEnter: (e: DragEvent) => {
        if (!files(e)) return
        depth.current++
        setOver(true)
      },
      onDragLeave: (e: DragEvent) => {
        if (!files(e)) return
        depth.current = Math.max(0, depth.current - 1)
        if (!depth.current) setOver(false)
      },
      onDragOver: (e: DragEvent) => {
        if (files(e)) e.preventDefault()
      },
      onDrop: reset,
    },
  }
}

export function ChatView({ group, onBack }: { group: GroupDto; onBack?: () => void }) {
  const tl = useTimeline(group.id)
  const bots = useWorkspace((s) => s.bots)
  const setActiveGroup = useWorkspace((s) => s.setActiveGroup)
  const me = useSession((s) => s.user)
  const meId = me?.id
  const box = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const olderAnchor = useRef<{ id: string; height: number } | null>(null)
  const readSeq = useRef(0)
  /** What the view had shown at the last render, to count arrivals while scrolled up. */
  const seen = useRef({ first: '', seq: 0, runs: 0 })
  const [unseen, setUnseen] = useState(0)
  const dropFiles = useRef<((files: File[]) => void) | null>(null)
  const drag = useFileDrag()
  const inspector = useInspector()
  const infoOpen = inspector.view === 'group-info'
  const [settings, setSettings] = useState<SettingsTab | null>(null)
  const [params, setParams] = useSearchParams()
  const linked = params.get('msg')
  const linkPages = useRef(0)
  const [flash, setFlash] = useState<string | null>(null)
  /** Unread count when entering; the divider stays where it was placed while new messages arrive. */
  const [entryUnread] = useState(group.unread)
  const [unreadAt, setUnreadAt] = useState<string | null | undefined>(undefined)
  if (unreadAt === undefined && tl.loaded) setUnreadAt(unreadStart(tl.messages, entryUnread, meId))

  useEffect(() => {
    setActiveGroup(group.id)
    return () => setActiveGroup(null)
  }, [group.id, setActiveGroup])

  const lastSeq = tl.messages.at(-1)?.seq ?? 0
  // A hidden tab has not really seen the messages: mark read once it is visible again.
  useEffect(() => {
    const flush = () => {
      if (document.hidden || lastSeq <= readSeq.current) return
      readSeq.current = lastSeq
      api.post(`/groups/${group.id}/read`, { seq: lastSeq }).catch(() => {})
    }
    flush()
    document.addEventListener('visibilitychange', flush)
    return () => document.removeEventListener('visibilitychange', flush)
  }, [group.id, lastSeq])

  const runCount = Object.keys(tl.runs).length
  // Runs and streamed deltas grow cards too, so they must re-pin the view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: tl.runs / tl.deltas are intentional triggers
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const first = tl.messages[0]?.id ?? ''
    const anchor = olderAnchor.current
    if (anchor && first !== anchor.id) {
      el.scrollTop += el.scrollHeight - anchor.height
      olderAnchor.current = null
    } else if (stick.current) el.scrollTop = el.scrollHeight
    else if (first === seen.current.first) {
      const added =
        tl.messages.filter((m) => m.seq > seen.current.seq).length + Math.max(0, runCount - seen.current.runs)
      if (added) setUnseen((n) => n + added)
    }
    seen.current = { first, seq: lastSeq, runs: runCount }
  }, [tl.messages, tl.runs, tl.deltas])

  const loadOlder = () => {
    const el = box.current
    const first = tl.messages[0]
    if (!el || !first || olderAnchor.current || tl.older === 'loading') return
    olderAnchor.current = { id: first.id, height: el.scrollHeight }
    tl.loadOlder().catch(() => {
      olderAnchor.current = null
    })
  }

  const onScroll = () => {
    const el = box.current
    if (!el) return
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX
    if (stick.current) setUnseen(0)
    // After a failure only the retry row loads again, so scrolling doesn't hammer a failing server.
    if (el.scrollTop < LOAD_OLDER_PX && tl.hasMore && tl.older === 'idle') loadOlder()
  }

  const toBottom = () => {
    const el = box.current
    if (el) el.scrollTop = el.scrollHeight
    stick.current = true
    setUnseen(0)
  }

  // `?msg=<id>` (search hits): page back until the message is loaded, then scroll to and flash it.
  useEffect(() => {
    if (!linked || !tl.loaded) return
    if (tl.messages.some((m) => m.id === linked)) {
      stick.current = false
      const items = box.current?.querySelectorAll<HTMLElement>('[data-msg-id]') ?? []
      ;[...items].find((e) => e.dataset.msgId === linked)?.scrollIntoView?.({ block: 'center' })
      setFlash(linked)
    } else if (tl.hasMore && tl.older === 'idle' && linkPages.current < LINK_PAGES) {
      linkPages.current++
      tl.loadOlder().catch(() => {})
      return
    } else if (tl.older === 'loading') return
    setParams(
      (p) => {
        p.delete('msg')
        return p
      },
      { replace: true },
    )
  }, [linked, tl.loaded, tl.messages, tl.hasMore, tl.older, tl.loadOlder, setParams])

  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), FLASH_MS)
    return () => clearTimeout(t)
  }, [flash])

  const botsById = useMemo(() => new Map(bots.map((b) => [b.id, b])), [bots])
  /** Runs by trigger message, and each run's final reply (the card moves to the reply once it exists). */
  const { runsByTrigger, replies, byId } = useMemo(() => {
    const byId = new Map(tl.messages.map((m) => [m.id, m]))
    const replies = new Map<string, MessageDto>()
    for (const m of tl.messages) if (m.kind === 'bot' && m.runId && tl.runs[m.runId]) replies.set(m.runId, m)
    const runsByTrigger = new Map<string, RunDto[]>()
    for (const r of Object.values(tl.runs).sort((a, b) => a.queuedAt.localeCompare(b.queuedAt)))
      runsByTrigger.set(r.triggerMessageId, [...(runsByTrigger.get(r.triggerMessageId) ?? []), r])
    return { runsByTrigger, replies, byId }
  }, [tl.messages, tl.runs])

  /** Bot names per fan-out message (two or more runs); a stable prop keeps other rows memoized. */
  const fanOuts = useMemo(() => {
    const out = new Map<string, string[]>()
    for (const [id, rs] of runsByTrigger)
      if (rs.length > 1)
        out.set(
          id,
          rs.map((r) => botsById.get(r.botId)?.name ?? 'Bot'),
        )
    return out
  }, [runsByTrigger, botsById])

  /** The first of them lends its role to the mascot in the typing bubble. */
  const workingCostume = useBotCostume(Object.values(tl.runs).find((r) => r.status === 'running')?.botId)
  /** Bots whose run is executing now: the list ends with their typing dots. */
  const working = useMemo(
    () => [
      ...new Set(
        Object.values(tl.runs)
          .filter((r) => r.status === 'running')
          .map((r) => botsById.get(r.botId)?.name ?? 'Bot'),
      ),
    ],
    [tl.runs, botsById],
  )

  const names = useMemo(
    () => [...bots.map((b) => b.name), ...group.members.map((m) => m.name)],
    [bots, group],
  )
  const userName = (id: string | null) => group.members.find((m) => m.userId === id)?.name ?? '—'

  const card = (r: RunDto, reply?: MessageDto) => {
    const bot = botsById.get(r.botId)
    return (
      <RunCard
        key={r.id}
        run={r}
        delta={tl.deltas[r.id]}
        reply={reply}
        botName={bot?.name ?? 'bot'}
        agent={bot ? AGENT_LABEL[bot.agentKind] : ''}
        trigger={
          r.triggerUserId ? userName(r.triggerUserId) : (byId.get(r.triggerMessageId)?.authorName ?? '—')
        }
        foldable={group.foldRuns}
      />
    )
  }

  const folds = eventFolds(tl.messages, unreadAt)
  const foldedAt = (i: number) => [...folds].some(([start, end]) => i > start && i <= end)
  const replyRun = (m: MessageDto) => (m.runId && replies.get(m.runId) === m ? tl.runs[m.runId] : undefined)
  /** Merged under the previous message: nothing (run card, divider) is drawn between them. */
  const isCompact = (prev: MessageDto | undefined, m: MessageDto) =>
    !!prev &&
    !prev.recalled &&
    !m.recalled &&
    m.id !== unreadAt &&
    continues(prev, m) &&
    !replyRun(prev) &&
    !replyRun(m) &&
    !runsByTrigger.get(prev.id)?.some((r) => !replies.has(r.id))

  const renderMessage = (m: MessageDto, compact: boolean) => {
    const run = replyRun(m)
    if (run) return card(run, m)
    if (m.kind === 'event') return <EventRow m={m} />
    if (m.recalled) return <RecallRow m={m} mine={m.authorId === meId} />
    if (m.kind === 'bot') return <BotReply m={m} compact={compact} />
    return (
      <UserMessage
        m={m}
        names={names}
        me={me?.name}
        mine={m.authorId === meId}
        compact={compact}
        fanOut={fanOuts.get(m.id)}
      />
    )
  }

  const botCount = group.botIds.length
  return (
    <div className="chat-view" {...drag.handlers}>
      <ChatHeader
        group
        avatar={<GroupAvatar group={group} size={32} />}
        title={group.name}
        onBack={onBack}
        tags={[{ label: GROUP_MODE_LABEL[group.mode], tone: 'gray' }]}
        subtitle={
          <>
            {group.muted ? (
              <Icon name="bell-slash" size={11} label="消息免打扰" className="chat-view__muted" />
            ) : null}
            {group.kind === 'group'
              ? `${group.members.length} 人${botCount ? ` · ${botCount} Bot` : ''} · `
              : '仅你和你的 Bot · '}
            <span title={group.repo?.url}>
              {group.repo
                ? `${repoName(group.repo.url)} · ${group.repo.branch}`
                : '未绑定仓库 · 各 Bot 使用本机目录'}
            </span>
          </>
        }
        actions={[
          ...(group.kind === 'group'
            ? [
                {
                  icon: 'person-2' as const,
                  label: `群成员：${group.members.length} 人${botCount ? `，${botCount} 个 Bot` : ''}`,
                  onClick: () => inspector.open('group-info', 'members'),
                },
              ]
            : []),
          {
            icon: 'sidebar-right',
            label: '群设置',
            active: infoOpen,
            onClick: () => (infoOpen ? inspector.close() : inspector.open('group-info', 'main')),
          },
        ]}
      />
      <InspectorPortal view="group-info">
        <GroupInfo
          key={String(inspector.payload)}
          group={group}
          initialView={(inspector.payload as InfoView | null) ?? 'main'}
          onClose={inspector.close}
          onSettings={setSettings}
        />
      </InspectorPortal>
      <Presence>
        {settings ? (
          <GroupSettingsDialog group={group} tab={settings} onClose={() => setSettings(null)} />
        ) : null}
      </Presence>
      <GitBar group={group} />
      <div className="chat-view__body">
        {drag.over ? (
          <div className="chat-view__drop">
            <DropZone
              defaultDragging
              multiple
              aria-label="添加附件"
              title="将文件拖到这里"
              overTitle="松开以添加附件"
              description="随下一条消息发送给群里的 Bot"
              onFiles={(files) => dropFiles.current?.(files)}
            />
          </div>
        ) : null}
        <div className="chat-scroll" ref={box} onScroll={onScroll}>
          <div className="chat-view__banners">
            <GroupNotice group={group} />
            <WorkspaceBanner group={group} />
          </div>
          <MessageList className="chat-scroll__list">
            {tl.older === 'loading' ? (
              <div className="chat-scroll__older" data-testid="older-loading">
                <Spinner />
              </div>
            ) : tl.older === 'failed' ? (
              <div className="chat-scroll__older" data-testid="older-error">
                加载更早消息失败
                <Button size="small" variant="plain" onClick={loadOlder}>
                  重试
                </Button>
              </div>
            ) : null}
            {tl.failed ? (
              <EmptyState
                bare
                illustration={<FailedArt />}
                title="消息加载失败"
                description="请检查网络后重试。"
                actions={
                  <Button size="small" onClick={tl.retry}>
                    重试
                  </Button>
                }
              />
            ) : !tl.loaded ? (
              <div className="chat-scroll__loading">
                <Mascot action="wait" size={72} label="加载中" />
              </div>
            ) : tl.messages.length ? (
              tl.messages.map((m, i) => {
                const prev = tl.messages[i - 1]
                const foldEnd = folds.get(i)
                if (foldEnd === undefined && foldedAt(i)) return null
                return (
                  <Fragment key={m.id}>
                    {prev && sameDay(prev.createdAt, m.createdAt) ? null : (
                      <ChatNotice kind="date" day={dayLabel(m.createdAt)} />
                    )}
                    {m.id === unreadAt ? <ChatNotice kind="unread" /> : null}
                    {foldEnd === undefined ? (
                      <div
                        data-msg-id={m.id}
                        className={cx(
                          'tl-item',
                          tl.arrived.has(m.id) && 'tl-item--enter',
                          flash === m.id && 'tl-item--flash',
                        )}
                      >
                        {renderMessage(m, isCompact(prev, m))}
                      </div>
                    ) : (
                      <EventFold events={tl.messages.slice(i, foldEnd + 1)} flash={flash} />
                    )}
                    {runsByTrigger.get(m.id)?.map((r) => (replies.has(r.id) ? null : card(r)))}
                  </Fragment>
                )
              })
            ) : (
              <EmptyState
                bare
                illustration={<EmptyChatArt />}
                title="还没有消息"
                description="@ 一个 Bot 让它开始工作，不 @ 的消息会作为上下文补送。"
              />
            )}
            {working.length ? (
              <TypingIndicator
                name={working}
                action="正在处理"
                bubble={<Mascot action="think" costume={workingCostume} size={36} />}
              />
            ) : null}
          </MessageList>
          {unseen ? (
            <button type="button" className="chat-scroll__pill" onClick={toBottom}>
              <Icon name="chevron-down" size={13} />
              {unseen} 条新消息
            </button>
          ) : null}
        </div>
      </div>
      <MessageComposer
        group={group}
        dropFiles={dropFiles}
        onSent={(m) => {
          stick.current = true
          tl.addMessage(m)
        }}
      />
    </div>
  )
}
