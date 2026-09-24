import type { GroupDto, MessageDto, RunDto } from '@aiws/protocol'
import { BellOff, Megaphone, PanelRight, Users } from 'lucide-react'
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { ChatHeader } from '../../app/ChatLayout'
import { GROUP_MODE_LABEL } from '../../app/Sidebar'
import { useWorkspace } from '../../app/workspace'
import { api } from '../../lib/api'
import { cx } from '../../lib/cx'
import { Badge, Button, EmptyState, IconButton, Spinner } from '../../ui'
import { AGENT_LABEL } from '../bots/model'
import { type DrawerView, GroupDrawer, type SettingsTab } from '../groups/GroupDrawer'
import { GroupSettingsDialog } from '../groups/GroupSettingsDialog'
import { GitBar } from './GitBar'
import { MessageComposer } from './MessageComposer'
import { BotReply, dayLabel, EventRow, RunCard, UserMessage } from './TimelineItems'
import { useTimeline } from './useTimeline'
import { WorkspaceBanner } from './WorkspaceBanner'
import './chat.css'

/** Distance from the bottom (px) within which new items keep the view pinned to the end. */
const STICK_PX = 80
const LOAD_OLDER_PX = 40
/** Older pages loaded at most while looking for a `?msg=` target. */
const LINK_PAGES = 10
const FLASH_MS = 2000

const sameDay = (a: string, b: string) => new Date(a).toDateString() === new Date(b).toDateString()

export function ChatView({ group, onBack }: { group: GroupDto; onBack?: () => void }) {
  const tl = useTimeline(group.id)
  const bots = useWorkspace((s) => s.bots)
  const setActiveGroup = useWorkspace((s) => s.setActiveGroup)
  const box = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const olderAnchor = useRef<{ id: string; height: number } | null>(null)
  const readSeq = useRef(0)
  /** What the view had shown at the last render, to count arrivals while scrolled up. */
  const seen = useRef({ first: '', seq: 0, runs: 0 })
  const [unseen, setUnseen] = useState(0)
  const [drawer, setDrawer] = useState<DrawerView | null>(null)
  const [settings, setSettings] = useState<SettingsTab | null>(null)
  const [params, setParams] = useSearchParams()
  const linked = params.get('msg')
  const linkPages = useRef(0)
  const [flash, setFlash] = useState<string | null>(null)

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

  const renderMessage = (m: MessageDto) => {
    const run = m.runId && replies.get(m.runId) === m ? tl.runs[m.runId] : undefined
    if (run) return card(run, m)
    if (m.kind === 'event') return <EventRow m={m} />
    if (m.kind === 'bot') return <BotReply m={m} />
    return <UserMessage m={m} names={names} fanOut={runsByTrigger.get(m.id)?.length} />
  }

  const botCount = group.botIds.length
  return (
    <>
      <ChatHeader
        title={group.name}
        badge={<Badge variant="secondary">{GROUP_MODE_LABEL[group.mode]}</Badge>}
        subtitle={
          group.repo ? `${group.repo.url} · ${group.repo.branch}` : '未绑定仓库 · 各 bot 使用本机目录'
        }
        onBack={onBack}
        actions={
          <>
            {group.muted ? (
              <span className="chat-header__muted" title="消息免打扰">
                <BellOff size={13} />
              </span>
            ) : null}
            {group.kind === 'group' ? (
              <button
                type="button"
                className="chat-header__members"
                title="群成员"
                aria-label={`群成员：${group.members.length} 人${botCount ? `，${botCount} 个 Bot` : ''}`}
                onClick={() => setDrawer('members')}
              >
                <Users size={14} />
                {group.members.length} 人{botCount ? ` · ${botCount} Bot` : ''}
              </button>
            ) : (
              <span className="chat-header__note">仅你和你的 bot</span>
            )}
            <IconButton
              title="群设置"
              className={drawer ? 'is-active' : undefined}
              onClick={() => setDrawer(drawer ? null : 'main')}
            >
              <PanelRight size={15} />
            </IconButton>
          </>
        }
      />
      {drawer ? (
        <GroupDrawer
          group={group}
          initialView={drawer}
          onClose={() => setDrawer(null)}
          onSettings={(tab) => {
            setDrawer(null)
            setSettings(tab)
          }}
        />
      ) : null}
      {settings ? (
        <GroupSettingsDialog group={group} tab={settings} onClose={() => setSettings(null)} />
      ) : null}
      {group.notice ? (
        <div className="chat-notice" data-testid="group-notice">
          <Megaphone size={13} className="muted-icon" />
          <span className="chat-notice__text">{group.notice}</span>
        </div>
      ) : null}
      <GitBar group={group} />
      <WorkspaceBanner group={group} />
      <div className="timeline" ref={box} onScroll={onScroll}>
        <div className="timeline__inner">
          {tl.older === 'loading' ? (
            <div className="timeline__older" data-testid="older-loading">
              <Spinner />
            </div>
          ) : tl.older === 'failed' ? (
            <div className="timeline__older" data-testid="older-error">
              加载更早消息失败
              <button type="button" className="timeline__retry" onClick={loadOlder}>
                重试
              </button>
            </div>
          ) : null}
          {tl.failed ? (
            <EmptyState
              bare
              title="消息加载失败"
              description="请检查网络后重试。"
              actions={
                <Button size="sm" onClick={tl.retry}>
                  重试
                </Button>
              }
            />
          ) : !tl.loaded ? (
            <div className="timeline__loading">
              <Spinner />
            </div>
          ) : tl.messages.length ? (
            tl.messages.map((m, i) => {
              const prev = tl.messages[i - 1]
              return (
                <Fragment key={m.id}>
                  {prev && sameDay(prev.createdAt, m.createdAt) ? null : (
                    <div className="tl-day">
                      <span>{dayLabel(m.createdAt)}</span>
                    </div>
                  )}
                  <div
                    data-msg-id={m.id}
                    className={cx(
                      'tl-item',
                      tl.arrived.has(m.id) && 'tl-item--enter',
                      flash === m.id && 'tl-item--flash',
                    )}
                  >
                    {renderMessage(m)}
                  </div>
                  {runsByTrigger.get(m.id)?.map((r) => (replies.has(r.id) ? null : card(r)))}
                </Fragment>
              )
            })
          ) : (
            <EmptyState
              bare
              title="还没有消息"
              description="@ 一个 Bot 让它开始工作，不 @ 的消息会作为上下文补送。"
            />
          )}
        </div>
        {unseen ? (
          <button type="button" className="timeline__pill" onClick={toBottom}>
            ↓ {unseen} 条新消息
          </button>
        ) : null}
      </div>
      <MessageComposer
        group={group}
        onSent={(m) => {
          stick.current = true
          tl.addMessage(m)
        }}
      />
    </>
  )
}
