import { useWorkbench, WORKBENCH_MAX_TABS, type WorkbenchTab } from '../../app/workbench'
import { t } from '../../i18n'
import { toast } from '../../ui'

/** Opens or focuses a workbench tab from a chat entry point; tells the user when there is no room. */
export function openTab(tab: WorkbenchTab): boolean {
  if (useWorkbench.getState().show(tab)) return true
  toast({ type: 'error', message: t('标签页已满（最多 {n} 个），请先关闭一些', { n: WORKBENCH_MAX_TABS }) })
  return false
}

/** 「在文件浏览器中定位」: the bot's files tab, opened at the file's folder with the file selected. */
export const locateFile = (botId: string, path: string) =>
  openTab({ kind: 'files', botId, dir: path.split('/').slice(0, -1).join('/'), selected: path })

/** 跳到源文件: the bot's file opened at a line. */
export const openFileAt = (botId: string, path: string, line: number) =>
  openTab({ kind: 'file', source: { botId, path, line: { from: line, to: line } } })
