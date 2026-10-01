import { useWorkbench, WORKBENCH_MAX_TABS, type WorkbenchTab } from '../../app/workbench'
import { t } from '../../i18n'
import { toast } from '../../ui'

/** Opens or focuses a workbench tab from a chat entry point; tells the user when there is no room. */
export function openTab(tab: WorkbenchTab): boolean {
  if (useWorkbench.getState().show(tab)) return true
  toast({ type: 'error', message: t('标签页已满（最多 {n} 个），请先关闭一些', { n: WORKBENCH_MAX_TABS }) })
  return false
}
