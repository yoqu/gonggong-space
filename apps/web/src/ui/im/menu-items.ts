import type { MenuItem } from '../menu'

/** Standard message context menu; destructive actions come last: own messages 编辑/撤回, others 删除. */
export function messageMenuItems({ self = false }: { self?: boolean } = {}): MenuItem[] {
  return [
    { label: '回复', value: 'reply', icon: 'reply' },
    { label: '回复话题', value: 'thread', icon: 'thread' },
    { label: '转发', value: 'forward', icon: 'forward' },
    { separator: true },
    { label: '拷贝', value: 'copy', shortcut: '⌘C' },
    { label: '置顶', value: 'pin' },
    { label: '标记为待办', value: 'todo' },
    { label: '多选', value: 'select' },
    { separator: true },
    ...(self
      ? [
          { label: '编辑', value: 'edit' },
          { label: '撤回', value: 'recall', destructive: true },
        ]
      : [{ label: '删除', value: 'delete', destructive: true }]),
  ]
}
