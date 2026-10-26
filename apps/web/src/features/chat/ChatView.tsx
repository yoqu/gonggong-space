import type { GroupDto, MessageDto, RunDto, RunStatus } from '@gonggong/protocol'
import {
  type DragEvent,
  Fragment,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { InspectorPortal, useInspector } from '../../app/inspector'
import { useSession } from '../../app/session'
import { useWorkbench } from '../../app/workbench'
import { loadPins, useWorkspace } from '../../app/workspace'
import { cx } from '../../lib/cx'
import { named } from '../../lib/lazy'
import { realtime } from '../../lib/realtime'
import { useHeightVar } from '../../lib/useHeightVar'
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
import { McpSecretCard } from '../config/McpSecretCard'
import { FeishuChatLink } from '../feishu/FeishuChatLink'
import { LinkedGitOperation } from '../git/GitOperations'
import { GroupTabBar } from '../group-tabs/GroupTabBar'
import { GroupAvatar } from '../groups/GroupAvatar'
import { GroupInfo, type InfoView, type SettingsTab } from '../groups/GroupInfo'
import { GroupNotice } from '../groups/GroupNotice'
import { CreationDraftView } from '../plugins/CreationCard'
import { CreationHost } from '../plugins/CreationHost'
import { useEnabledPlugins, useGroupPlugins } from '../plugins/store'
import { PreviewTags } from '../previews/PreviewTags'
import { ScheduleCard } from '../schedules/ScheduleCard'
import { ScheduleTag } from '../schedules/ScheduleTag'
import { SecretCard } from '../secrets/SecretCard'
import { ConflictEvent } from '../sync/RunSyncLine'
import { LinkedConflict, SyncBar, useLinkedSync } from '../sync/SyncBar'
import { TakeoverDialog } from '../teams/TakeoverDialog'
import { openTab } from '../workbench/open'
import { useRunDeltas } from './deltas'
import { GitBar } from './GitBar'
import { continues, eventFolds, sameDay, unreadStart } from './grouping'
import { MentionNames } from './Markdown'
import { branchableRuns } from './MessageActions'
import { MessageComposer } from './MessageComposer'
import { PinnedMessages } from './PinnedMessages'
import { ProgressCard } from './ProgressCard'
import { ProviderBanner } from './ProviderBanner'
import { repoName } from './repo'
import { TaskDock } from './TaskDock'
import {
  BotReply,
  dayLabel,
  EventFold,
  EventRow,
  eventText,
  RecallRow,
  RunCard,
  UserMessage,
} from './TimelineItems'
import { useMarkRead } from './useMarkRead'
import { useTimeline } from './useTimeline'
import { WorkspaceBanner } from './WorkspaceBanner'
import './chat.css'
import './timeline.css'
import { t } from '../../i18n'

const GroupSettingsDialog = named(() => import('../groups/GroupSettingsDialog'), 'GroupSettingsDialog')

/** Distance from the bottom (px) within which new items keep the view pinned to the end. */
const STICK_PX = 80
const LOAD_OLDER_PX = 40
/** Older pages loaded at most while looking for a `?msg=` target. */
const LINK_PAGES = 10
const FLASH_MS = 2000
/** Run states a recall of its trigger message stops (unstarted ones the server voids itself). */
const STARTED: RunStatus[] = ['running', 'awaiting_approval', 'awaiting_answer']

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
  const banners = useRef<HTMLDivElement>(null)
  // The day separator sticks just below however many prompts are pinned above the messages.
  useHeightVar(banners, box, '--banners-h')
  const stick = useRef(true)
  const olderAnchor = useRef<{ id: string; height: number } | null>(null)
  /** What the view had shown at the last render, to count arrivals while scrolled up. */
  const seen = useRef({ first: '', seq: 0, runs: 0 })
  const [unseen, setUnseen] = useState(0)
  /** Scrolled away from the end: a button leads back down. */
  const [away, setAway] = useState(false)
  const dropFiles = useRef<((files: File[]) => void) | null>(null)
  const drag = useFileDrag()
  const navigate = useNavigate()
  const infoOpen = useInspector((s) => s.view === 'group-info')
  const infoView = useInspector((s) => s.payload as InfoView | null)
  const { open: inspect, close: closeInspector } = useInspector.getState()
  const benchTabs = useWorkbench((s) => s.benches[group.id]?.tabs.length ?? 0)
  const benchOpen = useWorkbench((s) => s.open)
  const [settings, setSettings] = useState<SettingsTab | null>(null)
  useGroupPlugins(group.id)
  const plugins = useEnabledPlugins(group.id)
  const isAdmin = group.members.some((m) => m.userId === me?.id && m.isAdmin)
  const [params, setParams] = useSearchParams()
  const linked = params.get('msg')
  useLinkedSync(group.id)
  const linkPages = useRef(0)
  /** Run located from the live runs bar: its process opens when the link target can't be found. */
  const linkRun = useRef<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  /** Unread count when entering; the divider stays where it was placed while new messages arrive. */
  const [entryUnread] = useState(group.unread)
  const [unreadAt, setUnreadAt] = useState<string | null | undefined>(undefined)
  if (unreadAt === undefined && tl.loaded) setUnreadAt(unreadStart(tl.messages, entryUnread, meId))

  // The workbench (run tabs, diffs) follows the shown group too, so it is the one to stream.
  useEffect(() => {
    setActiveGroup(group.id)
    realtime.focus(group.id)
    return () => {
      setActiveGroup(null)
      realtime.focus(null)
    }
  }, [group.id, setActiveGroup])

  const lastSeq = tl.messages.at(-1)?.seq ?? 0
  useMarkRead(group.id, lastSeq, !readOnly)

  const runCount = Object.keys(tl.runs).length
  // Runs grow cards too, so they must re-pin the view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: tl.runs is an intentional trigger
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
  }, [tl.messages, tl.runs])

  // Streamed text grows run cards without re-rendering this view: re-pin once the cards have committed.
  useEffect(
    () =>
      useRunDeltas.subscribe(() =>
        requestAnimationFrame(() => {
          const el = box.current
          if (el && stick.current) el.scrollTop = el.scrollHeight
        }),
      ),
    [],
  )

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
    setAway(!stick.current)
    if (stick.current) setUnseen(0)
    // After a failure only the retry row loads again, so scrolling doesn't hammer a failing server.
    if (el.scrollTop < LOAD_OLDER_PX && tl.hasMore && tl.older === 'idle') loadOlder()
  }

  const toBottom = () => {
    const el = box.current
    if (el) el.scrollTop = el.scrollHeight
    stick.current = true
    setAway(false)
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
    else if (linkRun.current) openTab({ kind: 'run', runId: linkRun.current, view: 'process', file: null })
    linkRun.current = null
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

  /**
   * Bot names per fan-out message (two or more runs). Keyed by content: runs and bots are replaced on every update,
   * and a new array would re-render the row.
   */
  const fanOutsKey = JSON.stringify(
    [...runsByTrigger]
      // A continuation is the same bot going on by itself, not another one the message reached.
      .map(([id, rs]) => [id, rs.filter((r) => !r.continuationOf)] as const)
      .filter(([, rs]) => rs.length > 1)
      .map(([id, rs]) => [id, rs.map((r) => botsById.get(r.botId)?.name ?? 'Bot')]),
  )
  const fanOuts = useMemo(() => new Map<string, string[]>(JSON.parse(fanOutsKey)), [fanOutsKey])

  /** Read-only view (no live runs bar): executing runs whose card is not in the timeline end it as a typing row. */
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

  const locateMessage = (id: string) =>
    setParams(
      (p) => {
        p.set('msg', id)
        return p
      },
      { replace: true },
    )
  // biome-ignore lint/correctness/useExhaustiveDependencies: reloaded per group and after a reconnect
  useEffect(() => {
    const load = () => void loadPins(group.id).catch(() => {})
    load()
    return realtime.onReconnect(load)
  }, [group.id])
  const locate = (r: RunDto) => {
    linkPages.current = 0
    linkRun.current = r.id
    setParams(
      (p) => {
        p.set('msg', replies.get(r.id)?.id ?? r.triggerMessageId)
        return p
      },
      { replace: true },
    )
  }
  const runList = useMemo(() => Object.values(tl.runs), [tl.runs])
  const liveRuns = useRef(runList)
  liveRuns.current = runList
  const startedRuns = useCallback(
    (messageId: string) =>
      liveRuns.current
        .filter((r) => r.triggerMessageId === messageId && STARTED.includes(r.status))
        .map((r) => r.id),
    [],
  )
  const branchable = useMemo(
    () => branchableRuns(runList, (id) => botsById.get(id)?.ownerId === me?.id),
    [runList, botsById, me?.id],
  )

  // Keyed by content: `group` is replaced after every /read and `bots` on every run start/end, and new names would
  // re-render every message and re-parse every Markdown reply.
  const namesKey = JSON.stringify([...bots.map((b) => b.name), ...group.members.map((m) => m.name)])
  const names = useMemo(() => JSON.parse(namesKey) as string[], [namesKey])
  const mentionNamesKey = JSON.stringify({
    members: group.members.map((m) => m.name),
    bots: bots.filter((b) => group.botIds.includes(b.id)).map((b) => b.name),
    me: me?.name,
  })
  const mentionNames = useMemo(
    () => JSON.parse(mentionNamesKey) as { members: string[]; bots: string[]; me?: string },
    [mentionNamesKey],
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
        trigger={
          r.triggerUserId ? userName(r.triggerUserId) : (byId.get(r.triggerMessageId)?.authorName ?? '—')
        }
        foldable={group.foldRuns}
        branchable={branchable.has(r.id)}
      />
    )
  }

  /** Each fold's events by its first index; stable slices keep the memoized folds from re-rendering. */
  const { folds, folded } = useMemo(() => {
    const folds = new Map<number, MessageDto[]>()
    const folded = new Set<number>()
    for (const [start, end] of eventFolds(tl.messages, unreadAt)) {
      folds.set(start, tl.messages.slice(start, end + 1))
      for (let i = start + 1; i <= end; i++) folded.add(i)
    }
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
    if (m.scheduleId)
      return <ScheduleCard scheduleId={m.scheduleId} groupId={m.groupId} fallback={eventText(m)} />
    if (m.syncConflict) return <ConflictEvent m={m} conflict={m.syncConflict} />
    if (m.mcpSecret) return <McpSecretCard m={m} card={m.mcpSecret} />
    if (m.secretCard) return <SecretCard m={m} card={m.secretCard} />
    if (m.progress) return <ProgressCard card={m.progress} />
    if (m.card?.type === 'creation-draft') return <CreationDraftView m={m} card={m.card} />
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
        startedRuns={startedRuns}
      />
    )
  }

  const { addMessage } = tl
  const onSent = useCallback(
    (m: MessageDto) => {
      stick.current = true
      addMessage(m)
    },
    [addMessage],
  )

  const botCount = group.botIds.length
  const dm = group.kind === 'dm'
  const pluginLabel = plugins.length ? (
    <>
      <Icon name="apps" size={12} />
      <span>{t('插件 · {n}', { n: plugins.length })}</span>
    </>
  ) : null
  const pluginBadge = !pluginLabel ? null : isAdmin && !readOnly ? (
    <button
      type="button"
      className="chat-view__plugins"
      title={t('管理本群插件')}
      onClick={() => setSettings('plugins')}
    >
      {pluginLabel}
    </button>
  ) : (
    <span className="chat-view__plugins">{pluginLabel}</span>
  )
  const sharer = dm ? bots.find((b) => b.id === group.botIds[0] && b.ownerId !== meId)?.ownerName : undefined
  // Its bot was unshared or deleted: the history stays, nothing can be asked any more.
  const closed = dm && !botCount
  return (
    <MentionNames.Provider value={mentionNames}>
      <div className="chat-view" {...(readOnly ? {} : drag.handlers)}>
        <ChatHeader
          group
          avatar={<GroupAvatar group={group} size={32} />}
          title={group.name}
          onBack={onBack}
          {...(readOnly
            ? {}
            : dm
              ? group.botIds[0]
                ? { avatarLabel: t('查看 Bot'), onAvatarClick: () => navigate(`/bot/${group.botIds[0]}`) }
                : {}
              : isAdmin
                ? { avatarLabel: t('打开群设置'), onAvatarClick: () => setSettings('basic') }
                : {
                    avatarLabel: t('打开群信息'),
                    onAvatarClick: () => inspect('group-info', 'main'),
                  })}
          badges={
            group.feishu || pluginBadge ? (
              <>
                {group.feishu ? <FeishuChatLink chat={group.feishu} /> : null}
                {pluginBadge}
              </>
            ) : null
          }
          subtitle={
            <>
              {group.muted ? (
                <Icon
                  name="bell-slash"
                  size={11}
                  label={t('消息免打扰#muted')}
                  className="chat-view__muted"
                />
              ) : null}
              {dm ? (
                sharer ? (
                  t('{owner} 共享的 Bot · ', { owner: sharer })
                ) : (
                  t('仅你和你的 Bot · ')
                )
              ) : (
                <>
                  <button
                    type="button"
                    className="pn-chathead__link"
                    onClick={() => inspect('group-info', 'members')}
                  >
                    {t('{n} 人', { n: group.members.length })}
                  </button>
                  {' · '}
                  {botCount ? (
                    <>
                      <button
                        type="button"
                        className="pn-chathead__link"
                        onClick={() => inspect('group-info', 'bots')}
                      >
                        {t('{n} Bot', { n: botCount })}
                      </button>
                      {' · '}
                    </>
                  ) : null}
                </>
              )}
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
                    onClick: () => inspect('group-info', 'members'),
                  },
                ]
              : []),
            {
              icon: 'dashboard' as const,
              label: t('工作台'),
              text: benchTabs || undefined,
              active: benchOpen,
              onClick: () => useWorkbench.getState().setOpen(!benchOpen),
            },
            ...(readOnly
              ? []
              : [
                  {
                    icon: 'cog' as const,
                    label: t('群设置'),
                    active: infoOpen,
                    onClick: () => (infoOpen ? closeInspector() : inspect('group-info', 'main')),
                  },
                ]),
          ]}
        />
        {dm || readOnly ? null : <GroupTabBar group={group} />}
        <InspectorPortal view="group-info">
          <GroupInfo
            key={String(infoView)}
            group={group}
            initialView={infoView ?? 'main'}
            readOnly={readOnly}
            onClose={closeInspector}
            onSettings={setSettings}
          />
        </InspectorPortal>
        <Presence>
          {settings ? (
            <Suspense fallback={null}>
              <GroupSettingsDialog group={group} tab={settings} onClose={() => setSettings(null)} />
            </Suspense>
          ) : null}
        </Presence>
        <SyncBar
          group={group}
          isAdmin={isAdmin}
          hidden={readOnly}
          onSettings={isAdmin ? () => setSettings('mode') : undefined}
        />
        <LinkedConflict groupId={group.id} />
        <LinkedGitOperation groupId={group.id} />
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
            <div className="chat-view__banners" ref={banners}>
              {readOnly ? <ReadOnlyBanner group={group} /> : null}
              {closed && !readOnly ? (
                <PinnedBanner
                  icon="eye"
                  title={t('只读')}
                  text={t('Bot 已取消共享或已删除，只能查看历史消息。')}
                />
              ) : null}
              <GroupNotice group={group} readOnly={readOnly} />
              <PinnedMessages groupId={group.id} onLocate={locateMessage} />
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
                  const fold = folds.get(i)
                  if (folded.has(i)) return null
                  return (
                    <Fragment key={m.id}>
                      {prev && sameDay(prev.createdAt, m.createdAt) ? null : (
                        <ChatNotice kind="date" day={dayLabel(m.createdAt)} />
                      )}
                      {m.id === unreadAt ? <ChatNotice kind="unread" /> : null}
                      {fold === undefined ? (
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
                        <EventFold events={fold} flash={flash} />
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
              {readOnly && working.length ? (
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
            ) : away ? (
              <button
                type="button"
                className="chat-scroll__bottom"
                aria-label={t('回到底部')}
                title={t('回到底部')}
                onClick={toBottom}
              >
                <Icon name="chevron-down" size={16} weight={2} />
              </button>
            ) : null}
          </div>
        </div>
        {readOnly || closed ? null : (
          <>
            <div className="chat-view__pins">
              <ScheduleTag groupId={group.id} onManage={() => inspect('group-info', 'schedules')} />
              <PreviewTags groupId={group.id} />
            </div>
            <TaskDock runs={runList} root={box} onLocate={locate} />
            <ProviderBanner group={group} />
            <MessageComposer group={group} dropFiles={dropFiles} onSent={onSent} />
            <CreationHost group={group} onSent={onSent} />
          </>
        )}
      </div>
    </MentionNames.Provider>
  )
}
