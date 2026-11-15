import type { GroupDto } from '@gonggong/protocol'
import { NavLink } from 'react-router'
import { GroupAvatar } from '../features/groups/GroupAvatar'
import { t } from '../i18n'
import { cx } from '../lib/cx'
import { Badge, Icon } from '../ui'
import { byPin } from './Sidebar'
import { useWorkbench } from './workbench'
import { rowCount } from './workspace'

/** The conversation list folded to avatars and unread badges (workbench 专注 mode). */
export function ConversationStrip({ groups }: { groups: GroupDto[] }) {
  const rows = byPin(groups)
  return (
    <nav aria-label={t('会话列表')} className="conv-strip">
      <button
        type="button"
        className="conv-strip__item"
        title={t('展开会话列表')}
        aria-label={t('展开会话列表')}
        onClick={() => useWorkbench.getState().setMode('split')}
      >
        <Icon name="sidebar" size={18} />
      </button>
      {rows.map((g) => (
        <NavLink
          key={g.id}
          to={`/g/${g.id}`}
          // Its bot was unshared or deleted, as .pn-conv--closed in the full list.
          className={cx(
            'conv-strip__item',
            g.kind === 'dm' && !g.botIds.length && 'conv-strip__item--closed',
          )}
          title={g.name}
          aria-label={g.name}
        >
          <GroupAvatar group={g} size={32} />
          <Badge count={rowCount(g)} muted={g.notifyLevel === 'off'} />
        </NavLink>
      ))}
    </nav>
  )
}
