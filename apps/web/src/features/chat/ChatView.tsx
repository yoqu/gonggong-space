import type { GroupDto, MessageDto, RunDto } from '@gonggong/protocol'
import { type DragEvent, Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { InspectorPortal, useInspector } from '../../app/inspector'
import { GROUP_MODE_LABEL } from '../../app/Sidebar'
import { useSession } from '../../app/session'
import { useWorkbench } from '../../app/workbench'
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
  PinnedBanner,
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
import { PreviewTags } from '../previews/PreviewTags'
import { TakeoverDialog } from '../teams/TakeoverDialog'
import { GitBar } from './GitBar'
import { continues, eventFolds, sameDay, unreadStart } from './grouping'
import { MessageComposer } from './MessageComposer'
import { ProviderBanner } from './ProviderBanner'
import { repoName } from './repo'
import { BotReply, dayLabel, EventFold, EventRow, RecallRow, RunCard, UserMessage } from './TimelineItems'
import { useTimeline } from './useTimeline'
import { WorkspaceBanner } from './WorkspaceBanner'
import './chat.css'
import './timeline.css'
import { t } from '../../i18n'

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

/** A team admin viewing a group of the team they are not in (plan D19): nothing can be sent, changed or acted on. */
function ReadOnlyBanner({ group }: { group: GroupDto }) {
  const [taking, setTaking] = useState(false)
  return (
    <div data-testid="readonly-banner">
      <PinnedBanner
        icon="eye"
        title={t('只读查看')}
        text={t('你正以团队管理员身份查看此群，不能发言或管理。')}
        action={
          <Button size="small" onClick={() => setTaking(true)}>
            {t('进群并成为管理员')}
          </Button>
        }
      />
      <Presence>
        {taking ? (
          <TakeoverDialog
            teamId={group.teamId}
            group={group}
            onDone={() => setTaking(false)}
            onClose={() => setTaking(false)}
          />
        ) : null}
      </Presence>
    </div>
  )
}

export function ChatView({
  group,
  readOnly = false,
  onBack,
}: {
  group: GroupDto
  /** Viewed by a team admin outside the group (plan D19). */
  readOnly?: boolean
  onBack?: () => void
}) {
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
  const benchTabs = useWorkbench((s) => s.benches[group.id]?.tabs.length ?? 0)
  const benchOpen = useWorkbench((s) => s.open)
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
      if (readOnly || document.hidden || lastSeq <= readSeq.current) return
      readSeq.current = lastSeq
      api.post(`/groups/${group.id}/read`, { seq: lastSeq }).catch(() => {})
    }
    flush()
    document.addEventListener('visibilitychange', flush)
    return () => document.removeEventListener('visibilitychange', flush)
  }, [group.id, lastSeq, readOnly])

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
    const timer = setTimeout(() => setFlash(null), FLASH_MS)
    return () => clearTimeout(timer)
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

  /** Executing runs whose card is not in the timeline (its trigger not loaded yet): a card already shows the rest. */
  const offscreen = useMemo(
    () =>
      Object.values(tl.runs).filter(
        (r) => r.status === 'running' && !byId.has(r.triggerMessageId) && !replies.has(r.id),
      ),
    [tl.runs, byId, replies],
  )
  /** The first of them lends its role to the mascot in the typing bubble. */
  const workingCostume = useBotCostume(offscreen[0]?.botId)
  /** Their Bots: the list ends with their typing dots. */
  const working = useMemo(
    () => [...new Set(offscreen.map((r) => botsById.get(r.botId)?.name ?? 'Bot'))],
    [offscreen, botsById],
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

  const { folds, folded } = useMemo(() => {
    const folds = eventFolds(tl.messages, unreadAt)
    const folded = new Set<number>()
    for (const [start, end] of folds) for (let i = start + 1; i <= end; i++) folded.add(i)
    return { folds, folded }
  }, [tl.messages, unreadAt])
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
  const dm = group.kind === 'dm'
  return (
    <div className="chat-view" {...(readOnly ? {} : drag.handlers)}>
      <ChatHeader
        group
        avatar={<GroupAvatar group={group} size={32} />}
        title={group.name}
        onBack={onBack}
        tags={dm ? undefined : [{ label: GROUP_MODE_LABEL[group.mode], tone: 'gray' }]}
        subtitle={
          <>
            {group.muted ? (
              <Icon name="bell-slash" size={11} label={t('消息免打扰#muted')} className="chat-view__muted" />
            ) : null}
            {dm
              ? t('仅你和你的 Bot · ')
              : botCount
                ? t('{n} 人 · {bots} Bot · ', { n: group.members.length, bots: botCount })
                : t('{n} 人 · ', { n: group.members.length })}
            <span title={group.repo?.url}>
              {group.repo
                ? `${repoName(group.repo.url)} · ${group.repo.branch}`
                : dm
                  ? t('未绑定仓库 · Bot 使用本机目录')
                  : t('未绑定仓库 · 各 Bot 使用本机目录')}
            </span>
          </>
        }
        actions={[
          ...(!dm
            ? [
                {
                  icon: 'person-2' as const,
                  label: botCount
                    ? t('群成员：{n} 人，{bots} 个 Bot', { n: group.members.length, bots: botCount })
                    : t('群成员：{n} 人', { n: group.members.length }),
                  onClick: () => inspector.open('group-info', 'members'),
                },
              ]
            : []),
          {
            icon: 'dashboard' as const,
            label: benchTabs ? t('工作台') : t('工作台 · 还没有打开的标签页'),
            text: benchTabs || undefined,
            active: benchOpen && benchTabs > 0,
            disabled: !benchTabs,
            onClick: () => useWorkbench.getState().setOpen(!benchOpen),
          },
          ...(readOnly
            ? []
            : [
                {
                  icon: 'sidebar-right' as const,
                  label: t('群设置'),
                  active: infoOpen,
                  onClick: () => (infoOpen ? inspector.close() : inspector.open('group-info', 'main')),
                },
              ]),
        ]}
      />
      <InspectorPortal view="group-info">
        <GroupInfo
          key={String(inspector.payload)}
          group={group}
          initialView={(inspector.payload as InfoView | null) ?? 'main'}
          readOnly={readOnly}
          onClose={inspector.close}
          onSettings={setSettings}
        />
      </InspectorPortal>
      <Presence>
        {settings ? (
          <GroupSettingsDialog group={group} tab={settings} onClose={() => setSettings(null)} />
        ) : null}
      </Presence>
      {readOnly ? null : <GitBar group={group} />}
      <div className="chat-view__body">
        {drag.over ? (
          <div className="chat-view__drop">
            <DropZone
              defaultDragging
              multiple
              aria-label={t('添加附件')}
              title={t('将文件拖到这里')}
              overTitle={t('松开以添加附件')}
              description={t('随下一条消息发送给群里的 Bot')}
              onFiles={(files) => dropFiles.current?.(files)}
            />
          </div>
        ) : null}
        <div className="chat-scroll" ref={box} onScroll={onScroll}>
          <div className="chat-view__banners">
            {readOnly ? <ReadOnlyBanner group={group} /> : null}
            <GroupNotice group={group} readOnly={readOnly} />
            {readOnly ? null : <WorkspaceBanner group={group} />}
          </div>
          <MessageList className="chat-scroll__list">
            {tl.older === 'loading' ? (
              <div className="chat-scroll__older" data-testid="older-loading">
                <Spinner />
              </div>
            ) : tl.older === 'failed' ? (
              <div className="chat-scroll__older" data-testid="older-error">
                {t('加载更早消息失败')}
                <Button size="small" variant="plain" onClick={loadOlder}>
                  {t('重试')}
                </Button>
              </div>
            ) : null}
            {tl.failed ? (
              <EmptyState
                bare
                illustration={<FailedArt />}
                title={t('消息加载失败')}
                description={t('请检查网络后重试。')}
                actions={
                  <Button size="small" onClick={tl.retry}>
                    {t('重试')}
                  </Button>
                }
              />
            ) : !tl.loaded ? (
              <div className="chat-scroll__loading">
                <Mascot action="wait" size={72} label={t('加载中')} />
              </div>
            ) : tl.messages.length ? (
              tl.messages.map((m, i) => {
                const prev = tl.messages[i - 1]
                const foldEnd = folds.get(i)
                if (folded.has(i)) return null
                return (
                  <Fragment key={m.id}>
                    {prev && sameDay(prev.createdAt, m.createdAt) ? null : (
                      <ChatNotice kind="date" day={dayLabel(m.createdAt)} />
                    )}
                    {m.id === unreadAt ? <ChatNotice kind="unread" /> : null}
                    {foldEnd === undefined ? (
                      <div
                        inert={readOnly}
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
                    {runsByTrigger.get(m.id)?.map((r) =>
                      replies.has(r.id) ? null : readOnly ? (
                        <div key={r.id} inert className="chat-view__inert">
                          {card(r)}
                        </div>
                      ) : (
                        card(r)
                      ),
                    )}
                  </Fragment>
                )
              })
            ) : (
              <EmptyState
                bare
                illustration={<EmptyChatArt />}
                title={t('还没有消息')}
                description={t('@ 一个 Bot 让它开始工作，不 @ 的消息会作为上下文补送。')}
              />
            )}
            {working.length ? (
              <TypingIndicator
                name={working}
                action={t('正在处理')}
                bubble={<Mascot action="think" costume={workingCostume} size={36} />}
              />
            ) : null}
          </MessageList>
          {unseen ? (
            <button type="button" className="chat-scroll__pill" onClick={toBottom}>
              <Icon name="chevron-down" size={13} />
              {t('{n} 条新消息', { n: unseen })}
            </button>
          ) : null}
        </div>
      </div>
      {readOnly ? null : (
        <>
          <PreviewTags groupId={group.id} />
          <ProviderBanner group={group} />
          <MessageComposer
            group={group}
            dropFiles={dropFiles}
            onSent={(m) => {
              stick.current = true
              tl.addMessage(m)
            }}
          />
        </>
      )}
    </div>
  )
}
