import type { I18nText, MessageDto, RunDto } from '@gonggong/protocol'
import { memo, useState } from 'react'
import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { Button, ChatNotice, Icon, Presence } from '../../ui'
import { ConflictDialog } from './ConflictDialog'
import { reasonText } from './model'
import { SyncPanel } from './SyncPanel'
import { useSyncStatus } from './store'
import './sync.css'

/** Group admins and the bot's owner may settle its replica (F11, F12). */
export function useCanSettle(groupId: string, botId: string) {
  const me = useSession((s) => s.user?.id)
  return useWorkspace(
    (s) =>
      !!me &&
      (s.bots.find((b) => b.id === botId)?.ownerId === me ||
        !!s.groups.find((g) => g.id === groupId)?.members.some((m) => m.userId === me && m.isAdmin)),
  )
}

/**
 * 「处理」 for a replica waiting on a conflict (`held`, opens its conflict dialog) or local edits (`drift`, opens the
 * sync panel on it), for who may settle it; 「已处理」 once the replica no longer waits on it.
 */
function Settle({
  groupId,
  botId,
  issue,
  conflictId = null,
}: {
  groupId: string
  botId: string
  issue: 'held' | 'drift'
  conflictId?: string | null
}) {
  const allowed = useCanSettle(groupId, botId)
  const me = useSession((s) => s.user?.id)
  const isAdmin = useWorkspace(
    (s) => !!s.groups.find((g) => g.id === groupId)?.members.some((m) => m.userId === me && m.isAdmin),
  )
  const botName = useWorkspace((s) => s.bots.find((b) => b.id === botId)?.name ?? '')
  const status = useSyncStatus({ id: groupId, mode: 'force' })
  const [open, setOpen] = useState(false)
  if (!status) return null
  if (status.replicas.find((r) => r.botId === botId)?.issue !== issue)
    return <span className="sync-muted">{t('已处理')}</span>
  if (!allowed) return null
  return (
    <>
      <Button size="small" variant="plain" onClick={() => setOpen(true)}>
        {t('处理')}
      </Button>
      <Presence>
        {open ? (
          issue === 'held' ? (
            <ConflictDialog
              groupId={groupId}
              botId={botId}
              conflictId={conflictId}
              botName={botName}
              onClose={() => setOpen(false)}
            />
          ) : (
            <SyncPanel
              groupId={groupId}
              focusBotId={botId}
              isAdmin={isAdmin}
              onClose={() => setOpen(false)}
            />
          )
        ) : null}
      </Presence>
    </>
  )
}

/**
 * Some reasons say 同步 already (同步提交被拒绝：…); don't say it twice. Told by the Chinese source, so it holds in
 * every language; a legacy reason without one is checked as it reads.
 */
const failure = (s: { reason: string; reasonI18n?: I18nText | null }) => {
  const reason = reasonText(s)
  return (s.reasonI18n?.key ?? s.reason).startsWith('同步') ? reason : t('同步失败：{reason}', { reason })
}

/** How a force-group turn's changes went in (plan §4 运行卡片底部); nothing outside force groups. */
export function RunSyncLine({ run }: { run: Pick<RunDto, 'groupId' | 'botId' | 'sync'> }) {
  const s = run.sync
  // A stopped turn's changes are settled on its interrupt block.
  if (!s || s.outcome === 'stopped') return null
  const text =
    s.outcome === 'accepted'
      ? s.merged
        ? t('提交为 v{v}（自动合并）', { v: s.version })
        : t('提交为 v{v}', { v: s.version })
      : s.outcome === 'unchanged'
        ? t('无文件改动 · v{v}', { v: s.version })
        : s.outcome === 'held'
          ? t('冲突待处理 · {n} 个文件', { n: s.files })
          : s.outcome === 'waiting'
            ? s.issue === 'held'
              ? t('等待处理同步冲突')
              : t('等待处理本地改动')
            : failure(s)
  const settle = s.outcome === 'held' ? 'held' : s.outcome === 'waiting' ? s.issue : null
  return (
    <span className="sync-line" data-outcome={s.outcome} data-testid="run-sync">
      <Icon name="arrow-clockwise" size={12} />
      <span>{text}</span>
      {settle ? <Settle groupId={run.groupId} botId={run.botId} issue={settle} /> : null}
    </span>
  )
}

/** The group's conflict card (§3.3): 「@Bot 的改动与 v15 冲突：3 个文件」 with 处理. */
export const ConflictEvent = memo(function ConflictEvent({
  m,
  conflict,
}: {
  m: MessageDto
  conflict: { id: string; botId: string }
}) {
  return (
    <ChatNotice>
      <span className="tl-event sync-conflict-event" data-testid="sync-conflict-card">
        <Icon name="exclamation-circle" size={13} />
        <span className="tl-event__text">{m.i18n ? t.text(m.i18n) : m.body}</span>
        <Settle groupId={m.groupId} botId={conflict.botId} issue="held" conflictId={conflict.id} />
      </span>
    </ChatNotice>
  )
})
