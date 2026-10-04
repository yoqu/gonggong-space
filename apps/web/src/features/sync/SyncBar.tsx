import type { GroupDto } from '@gonggong/protocol'
import { useState } from 'react'
import { GROUP_MODE_LABEL } from '../../app/Sidebar'
import { t } from '../../i18n'
import { Icon, Presence } from '../../ui'
import { issues, STATE } from './model'
import { SyncPanel } from './SyncPanel'
import { useSyncStatus } from './store'
import './sync.css'

/** Force groups' persistent line under the header (plan §4): head version, consistency, issues; opens the panel. */
export function SyncBar({ group }: { group: Pick<GroupDto, 'id' | 'mode'> }) {
  const status = useSyncStatus(group)
  const [open, setOpen] = useState(false)
  if (!status) return null
  return (
    <>
      <div className="sync-bar">
        <button type="button" className="sync-bar__btn" onClick={() => setOpen(true)}>
          <Icon name="arrow-clockwise" size={12} />
          <span>
            {GROUP_MODE_LABEL.force} · v{status.headVersion} ·{' '}
            {t('{a}/{b} 一致', { a: status.consistent, b: status.total })}
          </span>
          {issues(status).map((x) => (
            <span key={x.state} className={`sync-bar__issue sync-tone--${STATE[x.state].tone}`}>
              {x.text}
            </span>
          ))}
          <Icon name="chevron-right" size={11} />
        </button>
      </div>
      <Presence>{open ? <SyncPanel groupId={group.id} onClose={() => setOpen(false)} /> : null}</Presence>
    </>
  )
}
