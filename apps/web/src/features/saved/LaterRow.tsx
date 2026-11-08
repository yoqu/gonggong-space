import { NavLink } from 'react-router'
import { t } from '../../i18n'
import { ConversationContent, Icon } from '../../ui'
import { useSaved, useSavedSync } from './store'

/** 稍后处理 in the sidebar: a count only once reminders have fired (plan 未读与通知). */
export function LaterRow() {
  useSavedSync()
  const { ids, due } = useSaved()
  return (
    <NavLink to="/later" className="pn-conv" data-testid="later-item" tabIndex={-1}>
      <ConversationContent
        item={{
          id: 'later',
          name: t('稍后处理'),
          group: true,
          avatarNode: (
            <span className="sidebar-terminal">
              <Icon name="bookmark" size={18} />
            </span>
          ),
          preview: due
            ? t('{n} 条提醒到期', { n: due })
            : ids.size
              ? t('{n} 条进行中', { n: ids.size })
              : t('收藏的消息与提醒'),
          unread: due || undefined,
          bold: due > 0,
        }}
      />
    </NavLink>
  )
}
