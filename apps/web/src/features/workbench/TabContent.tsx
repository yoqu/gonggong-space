import { memo, type ReactNode } from 'react'
import { tabKey, type WorkbenchTab } from '../../app/workbench'
import { ArtifactTab, useArtifactTabMeta } from '../artifacts/ArtifactTab'
import { DiffTab, useDiffTabMeta } from './tabs/DiffTab'
import { FilesTab, useFilesTabMeta } from './tabs/FilesTab'
import { FileTab, useFileTabMeta } from './tabs/FileTab'
import { GitCompareTab, useGitCompareTabMeta } from './tabs/GitCompareTab'
import { GitLogTab, useGitLogTabMeta } from './tabs/GitLogTab'
import { GitMergeTab, useGitMergeTabMeta } from './tabs/GitMergeTab'
import { GitTab, useGitTabMeta } from './tabs/GitTab'
import { KnowledgeTab, useKnowledgeTabMeta } from './tabs/KnowledgeTab'
import { LinkTab, useLinkTabMeta } from './tabs/LinkTab'
import { PageTab, usePageTabMeta } from './tabs/PageTab'
import { RunTab, useRunTabMeta } from './tabs/RunTab'
import { TerminalTab, useTerminalTabMeta } from './tabs/TerminalTab'
import { useWebTabMeta, WebTab } from './tabs/WebTab'
import type { TabMeta } from './types'

/** One tab's body, by kind; memoized so switching between other tabs leaves it alone. */
export const TabContent = memo(function TabContent({ tab, active }: { tab: WorkbenchTab; active: boolean }) {
  const key = tabKey(tab)
  switch (tab.kind) {
    case 'web':
      return <WebTab tab={tab} tabKey={key} active={active} />
    case 'run':
      return <RunTab tab={tab} tabKey={key} active={active} />
    case 'diff':
      return <DiffTab tab={tab} tabKey={key} active={active} />
    case 'files':
      return <FilesTab tab={tab} tabKey={key} active={active} />
    case 'file':
      return <FileTab tab={tab} tabKey={key} active={active} />
    case 'git-log':
      return <GitLogTab tab={tab} tabKey={key} active={active} />
    case 'git':
      return <GitTab tab={tab} tabKey={key} active={active} />
    case 'git-compare':
      return <GitCompareTab tab={tab} tabKey={key} active={active} />
    case 'git-merge':
      return <GitMergeTab tab={tab} tabKey={key} active={active} />
    case 'link':
      return <LinkTab tab={tab} tabKey={key} active={active} />
    case 'knowledge':
      return <KnowledgeTab tab={tab} tabKey={key} active={active} />
    case 'terminal':
      return <TerminalTab tab={tab} tabKey={key} active={active} />
    case 'artifact':
      return <ArtifactTab tab={tab} tabKey={key} active={active} />
    case 'page':
      return <PageTab tab={tab} tabKey={key} active={active} />
  }
})

type Render = (meta: TabMeta) => ReactNode

/** A tab's title and icon, by kind (each kind reads its own data). */
export function TabLabel({ tab, children }: { tab: WorkbenchTab; children: Render }) {
  switch (tab.kind) {
    case 'web':
      return <WebMeta tab={tab}>{children}</WebMeta>
    case 'run':
      return <RunMeta tab={tab}>{children}</RunMeta>
    case 'diff':
      return <DiffMeta tab={tab}>{children}</DiffMeta>
    case 'files':
      return <FilesMeta tab={tab}>{children}</FilesMeta>
    case 'file':
      return <FileMeta tab={tab}>{children}</FileMeta>
    case 'git-log':
      return <GitLogMeta tab={tab}>{children}</GitLogMeta>
    case 'git':
      return <GitMeta tab={tab}>{children}</GitMeta>
    case 'git-compare':
      return <GitCompareMeta tab={tab}>{children}</GitCompareMeta>
    case 'git-merge':
      return <GitMergeMeta tab={tab}>{children}</GitMergeMeta>
    case 'link':
      return <LinkMeta tab={tab}>{children}</LinkMeta>
    case 'knowledge':
      return <KnowledgeMeta tab={tab}>{children}</KnowledgeMeta>
    case 'terminal':
      return <TerminalMeta tab={tab}>{children}</TerminalMeta>
    case 'artifact':
      return <ArtifactMeta tab={tab}>{children}</ArtifactMeta>
    case 'page':
      return <PageMeta tab={tab}>{children}</PageMeta>
  }
}

type MetaProps<K extends WorkbenchTab['kind']> = { tab: Extract<WorkbenchTab, { kind: K }>; children: Render }
const WebMeta = ({ tab, children }: MetaProps<'web'>) => children(useWebTabMeta(tab))
const RunMeta = ({ tab, children }: MetaProps<'run'>) => children(useRunTabMeta(tab))
const DiffMeta = ({ tab, children }: MetaProps<'diff'>) => children(useDiffTabMeta(tab))
const FilesMeta = ({ tab, children }: MetaProps<'files'>) => children(useFilesTabMeta(tab))
const FileMeta = ({ tab, children }: MetaProps<'file'>) => children(useFileTabMeta(tab))
const GitLogMeta = ({ tab, children }: MetaProps<'git-log'>) => children(useGitLogTabMeta(tab))
const GitMeta = ({ tab, children }: MetaProps<'git'>) => children(useGitTabMeta(tab))
const GitCompareMeta = ({ tab, children }: MetaProps<'git-compare'>) => children(useGitCompareTabMeta(tab))
const GitMergeMeta = ({ tab, children }: MetaProps<'git-merge'>) => children(useGitMergeTabMeta(tab))
const LinkMeta = ({ tab, children }: MetaProps<'link'>) => children(useLinkTabMeta(tab))
const KnowledgeMeta = ({ tab, children }: MetaProps<'knowledge'>) => children(useKnowledgeTabMeta(tab))
const TerminalMeta = ({ tab, children }: MetaProps<'terminal'>) => children(useTerminalTabMeta(tab))
const ArtifactMeta = ({ tab, children }: MetaProps<'artifact'>) => children(useArtifactTabMeta(tab))
const PageMeta = ({ tab, children }: MetaProps<'page'>) => children(usePageTabMeta(tab))
