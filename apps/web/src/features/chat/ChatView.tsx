import type { GroupDto, MessageDto, RunDto } from '@aiws/protocol'
import { GitBranch, Megaphone, Users } from 'lucide-react'
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChatHeader } from '../../app/ChatLayout'
import { GROUP_MODE_LABEL } from '../../app/Sidebar'
import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { api } from '../../lib/api'
import { Badge, EmptyState, IconButton, Spinner } from '../../ui'
import { AGENT_LABEL } from '../bots/model'
import { GitBar } from './GitBar'
import { GroupRepoDialog } from './GroupRepoDialog'
import { MessageComposer } from './MessageComposer'
import { BotReply, EventRow, RunCard, UserMessage } from './TimelineItems'
import { useTimeline } from './useTimeline'
import './chat.css'

/** Distance from the bottom (px) within which new items keep the view pinned to the end. */
const STICK_PX = 80
const LOAD_OLDER_PX = 40

export function ChatView({ group, onBack }: { group: GroupDto; onBack?: () => void }) {
  const tl = useTimeline(group.id)
  const bots = useWorkspace((s) => s.bots)
  const setActiveGroup = useWorkspace((s) => s.setActiveGroup)
  const box = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const olderAnchor = useRef<{ id: string; height: number } | null>(null)
  const readSeq = useRef(0)
  const me = useSession((s) => s.user)
  const isAdmin = group.members.some((m) => m.userId === me?.id && m.isAdmin)
  const [repoOpen, setRepoOpen] = useState(false)

  useEffect(() => {
    setActiveGroup(group.id)
    return () => setActiveGroup(null)
  }, [group.id, setActiveGroup])

  const lastSeq = tl.messages.at(-1)?.seq ?? 0
  useEffect(() => {
    if (lastSeq <= readSeq.current) return
    readSeq.current = lastSeq
    api.post(`/groups/${group.id}/read`, { seq: lastSeq }).catch(() => {})
  }, [group.id, lastSeq])

  // Runs and streamed deltas grow cards too, so they must re-pin the view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: tl.runs / tl.deltas are intentional triggers
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const anchor = olderAnchor.current
    if (anchor && tl.messages[0]?.id !== anchor.id) {
      el.scrollTop += el.scrollHeight - anchor.height
      olderAnchor.current = null
    } else if (stick.current) el.scrollTop = el.scrollHeight
  }, [tl.messages, tl.runs, tl.deltas])

  const onScroll = () => {
    const el = box.current
    if (!el) return
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX
    if (el.scrollTop < LOAD_OLDER_PX && tl.hasMore && !olderAnchor.current && tl.messages[0]) {
      olderAnchor.current = { id: tl.messages[0].id, height: el.scrollHeight }
      tl.loadOlder().catch(() => {
        olderAnchor.current = null
      })
    }
  }

  const runsByTrigger = useMemo(() => {
    const map = new Map<string, RunDto[]>()
    for (const r of Object.values(tl.runs).sort((a, b) => a.queuedAt.localeCompare(b.queuedAt)))
      map.set(r.triggerMessageId, [...(map.get(r.triggerMessageId) ?? []), r])
    return map
  }, [tl.runs])

  const names = useMemo(
    () => [...bots.map((b) => b.name), ...group.members.map((m) => m.name)],
    [bots, group],
  )
  const userName = (id: string | null) => group.members.find((m) => m.userId === id)?.name ?? '—'

  const renderMessage = (m: MessageDto) =>
    m.kind === 'event' ? (
      <EventRow m={m} />
    ) : m.kind === 'bot' ? (
      <BotReply m={m} />
    ) : (
      <UserMessage m={m} names={names} fanOut={runsByTrigger.get(m.id)?.length} />
    )

  return (
    <>
      <ChatHeader
        title={group.name}
        badge={<Badge variant="secondary">{GROUP_MODE_LABEL[group.mode]}</Badge>}
        subtitle={group.repo ? `${group.repo.url} · ${group.repo.branch}` : '未绑定仓库 · 托管空工作区'}
        onBack={onBack}
        actions={
          <>
            {group.kind === 'group' ? (
              <span className="chat-header__members" title="群成员">
                <Users size={14} />
                {group.members.length + group.botIds.length}
              </span>
            ) : (
              <span className="chat-header__note">仅你和你的 bot</span>
            )}
            {isAdmin ? (
              <IconButton title="仓库与基准分支" onClick={() => setRepoOpen(true)}>
                <GitBranch size={14} />
              </IconButton>
            ) : null}
          </>
        }
      />
      {repoOpen ? <GroupRepoDialog group={group} onClose={() => setRepoOpen(false)} /> : null}
      {group.notice ? (
        <div className="chat-notice">
          <Megaphone size={13} className="muted-icon" />
          <span className="chat-notice__text">{group.notice}</span>
        </div>
      ) : null}
      <GitBar group={group} />
      <div className="timeline" ref={box} onScroll={onScroll}>
        {!tl.loaded ? (
          <div className="timeline__loading">
            <Spinner />
          </div>
        ) : tl.messages.length ? (
          tl.messages.map((m) => (
            <Fragment key={m.id}>
              {renderMessage(m)}
              {runsByTrigger.get(m.id)?.map((r) => {
                const bot = bots.find((b) => b.id === r.botId)
                return (
                  <RunCard
                    key={r.id}
                    run={r}
                    delta={tl.deltas[r.id]}
                    botName={bot?.name ?? 'bot'}
                    agent={bot ? AGENT_LABEL[bot.agentKind] : ''}
                    trigger={r.triggerUserId ? userName(r.triggerUserId) : m.authorName}
                  />
                )
              })}
            </Fragment>
          ))
        ) : (
          <EmptyState
            bare
            title="还没有消息"
            description="@ 一个 bot 让它开始工作，不 @ 的消息会作为上下文补送。"
          />
        )}
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
