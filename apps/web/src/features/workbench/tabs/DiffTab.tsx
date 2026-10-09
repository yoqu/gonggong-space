import { useMemo } from 'react'
import { useWorkbench } from '../../../app/workbench'
import { useWorkspace } from '../../../app/workspace'
import { t } from '../../../i18n'
import { DiffPane } from '../../diff/DiffPane'
import { useWorkspaceDiff } from '../../diff/useWorkspaceDiff'
import { openTab } from '../open'
import type { TabMeta, TabProps } from '../types'

/** 「在文件浏览器中定位」: the bot's files tab, opened at the file's folder with the file selected. */
export const locateFile = (botId: string, path: string) =>
  openTab({ kind: 'files', botId, dir: path.split('/').slice(0, -1).join('/'), selected: path })

/** A bot workspace's changes in this group: uncommitted work or the branch against main (design §4.4). */
export function DiffTab({ tab, tabKey }: TabProps<'diff'>) {
  const groupId = useWorkbench((s) => s.groupId)
  const patch = useWorkbench((s) => s.patch)
  const source = useMemo(
    () => (groupId ? { groupId, botId: tab.botId, runId: null } : null),
    [groupId, tab.botId],
  )
  const diff = useWorkspaceDiff(source, tab.scope)
  return (
    <div className="wb-diff">
      <DiffPane
        diff={diff}
        scope={tab.scope}
        turn={false}
        file={tab.file}
        repo={tab.repo}
        onScope={(scope) => patch(tabKey, { scope, file: null })}
        onFile={(file) => patch(tabKey, { file })}
        onLocate={(path) => locateFile(tab.botId, path)}
      />
    </div>
  )
}

export function useDiffTabMeta(tab: TabProps<'diff'>['tab']): TabMeta {
  const name = useWorkspace((s) => s.bots.find((b) => b.id === tab.botId)?.name) ?? 'Bot'
  return { icon: 'git-branch', title: t('改动 · {name}', { name }) }
}
