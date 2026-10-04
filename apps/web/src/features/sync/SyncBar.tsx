import type { GroupDto } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { GROUP_MODE_LABEL } from '../../app/Sidebar'
import { t } from '../../i18n'
import { Icon, Presence } from '../../ui'
import { ConflictDialog } from './ConflictDialog'
import { issues, STATE } from './model'
import { SyncPanel } from './SyncPanel'
import { closeSyncPanel, openSyncPanel, useSyncPanel, useSyncStatus } from './store'
import './sync.css'

/** `?sync=<botId>` (a local-changes notification) opens the group's sync panel on that bot, then leaves the URL. */
export function useLinkedSync(groupId: string) {
  const [params, setParams] = useSearchParams()
  const botId = params.get('sync')
  useEffect(() => {
    if (!botId) return
    openSyncPanel(groupId, botId)
    setParams(
      (p) => {
        p.delete('sync')
        return p
      },
      { replace: true },
    )
  }, [botId, groupId, setParams])
}

/** `?conflict=<conflictId>` (a sync conflict notification) opens that conflict, then leaves the URL. */
export function LinkedConflict({ groupId }: { groupId: string }) {
  const [params, setParams] = useSearchParams()
  const linked = params.get('conflict')
  const [open, setOpen] = useState<{ groupId: string; conflictId: string } | null>(null)
  useEffect(() => {
    if (!linked) return
    setOpen({ groupId, conflictId: linked })
    setParams(
      (p) => {
        p.delete('conflict')
        return p
      },
      { replace: true },
    )
  }, [linked, groupId, setParams])
  return (
    <Presence>
      {open?.groupId === groupId ? (
        <ConflictDialog groupId={groupId} conflictId={open.conflictId} onClose={() => setOpen(null)} />
      ) : null}
    </Presence>
  )
}

/**
 * Force groups' persistent line under the header (plan §4): head version, consistency, issues; opens the panel,
 * which also opens from elsewhere through `openSyncPanel`. `hidden` keeps only the panel.
 */
export function SyncBar({
  group,
  isAdmin = false,
  hidden = false,
  onSettings,
}: {
  group: Pick<GroupDto, 'id' | 'mode'>
  isAdmin?: boolean
  hidden?: boolean
  /** Admins: opens the mode settings from the panel. */
  onSettings?: () => void
}) {
  const status = useSyncStatus(group)
  const panel = useSyncPanel()
  const open = panel.groupId === group.id
  return (
    <>
      {status && !hidden ? (
        <div className="sync-bar">
          <button type="button" className="sync-bar__btn" onClick={() => openSyncPanel(group.id)}>
            <Icon name="arrow-clockwise" size={12} />
            <span>
              {GROUP_MODE_LABEL.force} · v{status.headVersion} ·{' '}
              {t('{a}/{b} 一致', { a: status.consistent, b: status.total })}
            </span>
            {status.switching ? <span className="sync-bar__issue sync-tone--blue">{t('切换中')}</span> : null}
            {issues(status).map((x) => (
              <span key={x.state} className={`sync-bar__issue sync-tone--${STATE[x.state].tone}`}>
                {x.text}
              </span>
            ))}
            <Icon name="chevron-right" size={11} />
          </button>
        </div>
      ) : null}
      <Presence>
        {open ? (
          <SyncPanel
            groupId={group.id}
            focusBotId={panel.botId}
            isAdmin={isAdmin}
            onSettings={
              onSettings &&
              (() => {
                closeSyncPanel()
                onSettings()
              })
            }
            onClose={closeSyncPanel}
          />
        ) : null}
      </Presence>
    </>
  )
}
