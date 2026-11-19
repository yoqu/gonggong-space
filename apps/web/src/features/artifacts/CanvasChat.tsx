import { useLayoutEffect, useMemo, useRef } from 'react'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { Button, Spinner } from '../../ui'
import { PendingMessages } from '../chat/PendingMessages'
import { useThreadItem } from '../chat/ThreadView'
import { ThreadScope } from '../chat/threadSummary'
import { useTimeline } from '../chat/useTimeline'
import { useArtifactChatRoot } from './chatRoot'

const STICK_PX = 80
const LOAD_OLDER_PX = 40

/**
 * 画布 AI 对话: what members asked AI on this artifact's canvas (the composer floating over it, canvas commands,
 * annotations) and what AI answered, kept out of the group's messages.
 */
export function CanvasChat({ artifactId, groupId }: { artifactId: string; groupId: string }) {
  const rootId = useArtifactChatRoot(artifactId)
  const group = useWorkspace((s) => s.groups.find((g) => g.id === groupId))
  if (!rootId || !group)
    return (
      <p className="art-log__empty">
        <Spinner size={12} />
      </p>
    )
  return <ChatList group={group} rootId={rootId} />
}

function ChatList({
  group,
  rootId,
}: {
  group: NonNullable<ReturnType<typeof useWorkspace.getState>['groups'][number]>
  rootId: string
}) {
  const tl = useTimeline(group.id, rootId)
  const replies = useMemo(() => tl.messages.filter((m) => m.id !== rootId), [tl.messages, rootId])
  const item = useThreadItem(group, tl.messages, tl.runs)
  const scroll = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const olderAnchor = useRef<number | null>(null)

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

  return (
    <ThreadScope.Provider value={rootId}>
      <div className="art-rail__scroll art-chat" ref={scroll} onScroll={onScroll} data-testid="art-chat">
        {tl.failed ? (
          <p className="art-log__empty">
            {t('对话加载失败')}{' '}
            <Button size="small" variant="plain" onClick={tl.retry}>
              {t('重试')}
            </Button>
          </p>
        ) : !tl.loaded ? (
          <p className="art-log__empty">
            <Spinner size={12} />
          </p>
        ) : (
          <>
            {tl.older === 'loading' ? <Spinner /> : null}
            {replies.length ? null : (
              <p className="art-log__empty">{t('在下方输入框描述要怎么改，AI 的回复显示在这里')}</p>
            )}
            {replies.map(item)}
            <PendingMessages
              groupId={group.id}
              thread={rootId}
              messages={tl.messages}
              onSent={tl.addMessage}
            />
          </>
        )}
      </div>
    </ThreadScope.Provider>
  )
}
