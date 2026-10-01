import { t } from '../../i18n'
import type { MenuItem } from '../menu'

/** Standard message context menu; destructive actions come last: own messages 编辑/撤回, others 删除. */
export function messageMenuItems({ self = false }: { self?: boolean } = {}): MenuItem[] {
  return [
    { label: t('回复'), value: 'reply', icon: 'reply' },
    { label: t('回复话题'), value: 'thread', icon: 'thread' },
    { label: t('转发'), value: 'forward', icon: 'forward' },
    { separator: true },
    { label: t('拷贝'), value: 'copy', shortcut: '⌘C' },
    { label: t('置顶'), value: 'pin' },
    { label: t('标记为待办'), value: 'todo' },
    { label: t('多选'), value: 'select' },
    { separator: true },
    ...(self
      ? [
          { label: t('编辑'), value: 'edit' },
          { label: t('撤回'), value: 'recall', destructive: true },
        ]
      : [{ label: t('删除'), value: 'delete', destructive: true }]),
  ]
}
