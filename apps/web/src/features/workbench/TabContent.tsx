import type { ReactNode } from 'react'
import { tabKey, type WorkbenchTab } from '../../app/workbench'
import { DiffTab, useDiffTabMeta } from './tabs/DiffTab'
import { FilesTab, useFilesTabMeta } from './tabs/FilesTab'
import { FileTab, useFileTabMeta } from './tabs/FileTab'
import { MiniprogramTab, useMiniprogramTabMeta } from './tabs/MiniprogramTab'
import { RunTab, useRunTabMeta } from './tabs/RunTab'
import { useWebTabMeta, WebTab } from './tabs/WebTab'
import type { TabMeta } from './types'

/** One tab's body, by kind. */
export function TabContent({ tab, active }: { tab: WorkbenchTab; active: boolean }) {
  const key = tabKey(tab)
  switch (tab.kind) {
    case 'web':
      return <WebTab tab={tab} tabKey={key} active={active} />
    case 'miniprogram':
      return <MiniprogramTab tab={tab} tabKey={key} active={active} />
    case 'run':
      return <RunTab tab={tab} tabKey={key} active={active} />
    case 'diff':
      return <DiffTab tab={tab} tabKey={key} active={active} />
    case 'files':
      return <FilesTab tab={tab} tabKey={key} active={active} />
    case 'file':
      return <FileTab tab={tab} tabKey={key} active={active} />
  }
}

type Render = (meta: TabMeta) => ReactNode

/** A tab's title and icon, by kind (each kind reads its own data). */
export function TabLabel({ tab, children }: { tab: WorkbenchTab; children: Render }) {
  switch (tab.kind) {
    case 'web':
      return <WebMeta tab={tab}>{children}</WebMeta>
    case 'miniprogram':
      return <MiniprogramMeta tab={tab}>{children}</MiniprogramMeta>
    case 'run':
      return <RunMeta tab={tab}>{children}</RunMeta>
    case 'diff':
      return <DiffMeta tab={tab}>{children}</DiffMeta>
    case 'files':
      return <FilesMeta tab={tab}>{children}</FilesMeta>
    case 'file':
      return <FileMeta tab={tab}>{children}</FileMeta>
  }
}

type MetaProps<K extends WorkbenchTab['kind']> = { tab: Extract<WorkbenchTab, { kind: K }>; children: Render }
const WebMeta = ({ tab, children }: MetaProps<'web'>) => children(useWebTabMeta(tab))
const MiniprogramMeta = ({ tab, children }: MetaProps<'miniprogram'>) => children(useMiniprogramTabMeta(tab))
const RunMeta = ({ tab, children }: MetaProps<'run'>) => children(useRunTabMeta(tab))
const DiffMeta = ({ tab, children }: MetaProps<'diff'>) => children(useDiffTabMeta(tab))
const FilesMeta = ({ tab, children }: MetaProps<'files'>) => children(useFilesTabMeta(tab))
const FileMeta = ({ tab, children }: MetaProps<'file'>) => children(useFileTabMeta(tab))
