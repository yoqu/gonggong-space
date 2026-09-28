import type { WorkbenchTab } from '../../app/workbench'
import type { IconName } from '../../ui'

/** How a tab presents itself in the tab bar. */
export interface TabMeta {
  icon: IconName
  title: string
  /** Replaces the icon with a live mark: a spinner while running, a dot for a preview's state. */
  status?: 'running' | 'done' | 'failed' | 'online' | 'offline'
}

/** Props every tab body receives; `active` is false while another tab is shown (bodies stay mounted). */
export interface TabProps<K extends WorkbenchTab['kind']> {
  tab: Extract<WorkbenchTab, { kind: K }>
  tabKey: string
  active: boolean
}
