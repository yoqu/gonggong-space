import { NavLink } from 'react-router'
import { t } from '../../i18n'
import { ShortcutContent } from '../../ui'
import { useSaved, useSavedSync } from './store'

/** 稍后处理 in the sidebar: a count only once reminders have fired (plan 未读与通知). */
export function LaterRow() {
  useSavedSync()
  const { ids, due } = useSaved()
  const detail = due
    ? t('{n} 条提醒到期', { n: due })
    : ids.size
      ? t('{n} 条进行中', { n: ids.size })
      : t('收藏的消息与提醒')
  return (
    <NavLink to="/later" className="pn-shortcut" data-testid="later-item" title={detail} tabIndex={-1}>
      <ShortcutContent icon="bookmark" label={t('稍后处理')} detail={detail} count={due} bold={due > 0} />
    </NavLink>
  )
}
