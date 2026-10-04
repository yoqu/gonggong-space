import type { MessageDto, RunDto } from '@gonggong/protocol'
import { useState } from 'react'
import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { Button, ChatNotice, Icon, Presence } from '../../ui'
import { ConflictDialog } from './ConflictDialog'
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

/** 「处理」 opening the bot's conflict dialog, for who may settle it. */
function Settle({ groupId, botId }: { groupId: string; botId: string }) {
  const allowed = useCanSettle(groupId, botId)
  const botName = useWorkspace((s) => s.bots.find((b) => b.id === botId)?.name ?? '')
  const [open, setOpen] = useState(false)
  if (!allowed) return null
  return (
    <>
      <Button size="small" variant="plain" onClick={() => setOpen(true)}>
        {t('处理')}
      </Button>
      <Presence>
        {open ? (
          <ConflictDialog groupId={groupId} botId={botId} botName={botName} onClose={() => setOpen(false)} />
        ) : null}
      </Presence>
    </>
  )
}

/** How a force-group turn's changes went in (plan §4 运行卡片底部); nothing outside force groups. */
export function RunSyncLine({ run }: { run: Pick<RunDto, 'groupId' | 'botId' | 'sync'> }) {
  const s = run.sync
  // A stopped turn's changes are settled on its interrupt block.
  if (!s || s.outcome === 'waiting' || s.outcome === 'stopped') return null
  const text =
    s.outcome === 'accepted'
      ? s.merged
        ? t('提交为 v{v}（自动合并）', { v: s.version })
        : t('提交为 v{v}', { v: s.version })
      : s.outcome === 'unchanged'
        ? t('无文件改动 · v{v}', { v: s.version })
        : s.outcome === 'held'
          ? t('冲突待处理 · {n} 个文件', { n: s.files })
          : t('同步失败：{reason}', { reason: s.reason })
  return (
    <span className="sync-line" data-outcome={s.outcome} data-testid="run-sync">
      <Icon name="arrow-clockwise" size={12} />
      <span>{text}</span>
      {s.outcome === 'held' ? <Settle groupId={run.groupId} botId={run.botId} /> : null}
    </span>
  )
}

/** The group's conflict card (§3.3): 「@Bot 的改动与 v15 冲突：3 个文件」 with 处理. */
export function ConflictEvent({ m }: { m: MessageDto & { syncConflict: { botId: string } } }) {
  return (
    <ChatNotice>
      <span className="tl-event sync-conflict-event" data-testid="sync-conflict-card">
        <Icon name="exclamation-circle" size={13} />
        <span className="tl-event__text">{m.i18n ? t.text(m.i18n) : m.body}</span>
        <Settle groupId={m.groupId} botId={m.syncConflict.botId} />
      </span>
    </ChatNotice>
  )
}
