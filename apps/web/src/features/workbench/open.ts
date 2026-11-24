import { staleTab, tabKey, useWorkbench, WORKBENCH_MAX_TABS, type WorkbenchTab } from '../../app/workbench'
import { t } from '../../i18n'
import { toast } from '../../ui'

/** Titles last shown in the tab bar (most need data loaded there), to name a tab closed for room. */
const titles = new Map<string, string>()
export const rememberTabTitle = (key: string, title: string) => titles.set(key, title)

const titleOf = (tab: WorkbenchTab) =>
  titles.get(tabKey(tab)) ?? ('title' in tab ? tab.title : t('标签页#one'))

/**
 * Opens or focuses a workbench tab from a chat entry point; when all tabs are taken, the least recently used inactive
 * read-only one makes room (and can be reopened from the toast), else the user is told there is no room.
 */
export function openTab(tab: WorkbenchTab, groupId = useWorkbench.getState().groupId): boolean {
  const s = useWorkbench.getState()
  const bench = groupId ? s.benches[groupId] : undefined
  const key = tabKey(tab)
  const stale =
    bench && bench.tabs.length >= WORKBENCH_MAX_TABS && !bench.tabs.some((x) => tabKey(x) === key)
      ? staleTab(bench)
      : undefined
  if (stale) s.closeTab(tabKey(stale), groupId ?? undefined)
  if (!groupId || !s.show(tab, groupId)) {
    toast({ type: 'error', message: t('标签页已满（最多 {n} 个），请先关闭一些', { n: WORKBENCH_MAX_TABS }) })
    return false
  }
  if (stale)
    toast({
      type: 'info',
      message: t('已关闭最久未用的「{title}」', { title: titleOf(stale) }),
      // Bound to this group: the user may have moved to another by the time they click.
      action: { label: t('重新打开'), onClick: () => openTab(stale, groupId) },
    })
  return true
}

/** 「在文件浏览器中定位」: the bot's files tab, opened at the file's folder with the file selected. */
export const locateFile = (botId: string, path: string) =>
  openTab({ kind: 'files', botId, dir: path.split('/').slice(0, -1).join('/'), selected: path })

/** 跳到源文件: the bot's file opened at a line. */
export const openFileAt = (botId: string, path: string, line: number) =>
  openTab({ kind: 'file', source: { botId, path, line: { from: line, to: line } } })
