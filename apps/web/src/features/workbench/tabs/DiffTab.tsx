import { useMemo } from 'react'
import { useWorkbench } from '../../../app/workbench'
import { useWorkspace } from '../../../app/workspace'
import { t } from '../../../i18n'
import { DiffPane } from '../../diff/DiffPane'
import { useWorkspaceDiff } from '../../diff/useWorkspaceDiff'
import { gitBase, gitUrls } from '../../git/api'
import { openTab } from '../open'
import type { TabMeta, TabProps } from '../types'

/** 「在文件浏览器中定位」: the bot's files tab, opened at the file's folder with the file selected. */
export const locateFile = (botId: string, path: string) =>
  openTab({ kind: 'files', botId, dir: path.split('/').slice(0, -1).join('/'), selected: path })

/** 跳到源文件: the bot's file opened at a line. */
export const openFileAt = (botId: string, path: string, line: number) =>
  openTab({ kind: 'file', source: { botId, path, line: { from: line, to: line } } })

/** A bot workspace's changes in this group: uncommitted work or the branch against main (design §4.4). */
export function DiffTab({ tab, tabKey, active }: TabProps<'diff'>) {
  const groupId = useWorkbench((s) => s.groupId)
  const patch = useWorkbench((s) => s.patch)
  const source = useMemo(
    () => (groupId ? { groupId, botId: tab.botId, runId: null } : null),
    [groupId, tab.botId],
  )
  // Each read runs git diff on the bot's machine: a hidden tab reads nothing and catches up once shown.
  const diff = useWorkspaceDiff(active ? source : null, tab.scope)
  const base = gitBase(groupId ?? '', tab.botId)
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
        // 未提交 is the work tree against HEAD, which git reads again with the toolbar's settings; against main's
        // merge base it can't be asked for, so that scope shows its patch.
        read={
          tab.scope === 'uncommitted'
            ? (repo, path) => gitUrls.diff(base, 'HEAD', null, path, repo || null)
            : undefined
        }
        revert={
          tab.scope === 'uncommitted' && groupId
            ? (repo) => ({ groupId, botId: tab.botId, repo: repo || null })
            : undefined
        }
        onOpenLine={(path, line) => openFileAt(tab.botId, path, line)}
      />
    </div>
  )
}

export function useDiffTabMeta(tab: TabProps<'diff'>['tab']): TabMeta {
  const name = useWorkspace((s) => s.bots.find((b) => b.id === tab.botId)?.name) ?? 'Bot'
  return { icon: 'git-branch', title: t('改动 · {name}', { name }) }
}
