import type { GitChange } from '@gonggong/protocol'
import { type ReactNode, useState } from 'react'
import { t } from '../../../i18n'
import { EmptyState, type MenuItem, Spinner } from '../../../ui'
import { useDiffLayout } from '../../diff/store'
import type { GitTarget } from '../api'
import { type ChangeGroup, type ChangeTarget, ChangeTree, folderPaths, type TreeChange } from '../ChangeTree'
import { gitCommands } from '../commands'
import { Tool } from './Tool'

/** The folder all of `changes` sit in ('' = the root). */
function commonDir(changes: TreeChange[]) {
  const [first = [], ...rest] = changes.map((c) => c.path.split('/').slice(0, -1))
  let n = first.length
  for (const dir of rest) {
    let i = 0
    while (i < n && dir[i] === first[i]) i++
    n = i
  }
  return first.slice(0, n).join('/')
}

/** The file a version opens on: `path` (a file followed through renames, or one in a folder), else the first. */
export function defaultChange(changes: GitChange[], path: string | null) {
  const hit = path
    ? (changes.find((c) => c.path === path || c.oldPath === path) ??
      changes.find((c) => c.path.startsWith(`${path}/`)))
    : undefined
  return hit ?? changes[0]
}

/**
 * The files two versions differ in, as IDEA's changes tree (flat or by folder): `fileItems` lead a file's menu, then
 * its history and path; a folder offers its history and path.
 */
export function ChangesPane({
  target,
  changes,
  error,
  selected,
  onSelect,
  onOpen,
  fileItems,
  onFileItem,
  group,
  extra,
  history,
}: {
  target: GitTarget
  /** null while loading. */
  changes: GitChange[] | null
  error: string | null
  selected: string | null
  onSelect: (c: TreeChange) => void
  onOpen?: (c: TreeChange) => void
  fileItems: (file: TreeChange) => MenuItem[]
  onFileItem: (value: string, file: TreeChange) => void
  /** The group's label. */
  group: string
  /** Before the tools, e.g. a merge's parent to compare against. */
  extra?: ReactNode
  /** In place of 显示历史 (a path's whole history), e.g. its history up to a commit. */
  history?: { label: string; open: (path: string) => void }
}) {
  const layout = useDiffLayout((s) => s.layout)
  const toggleLayout = useDiffLayout((s) => s.toggle)
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set())
  const cmd = gitCommands(target)
  const groups: ChangeGroup[] = [{ key: 'files', label: group, changes: changes ?? [] }]
  const menu = (tg: ChangeTarget): MenuItem[] => {
    const path = tg.file?.path ?? commonDir(tg.changes)
    const common: MenuItem[] = [
      { value: 'history', label: history?.label ?? t('显示历史'), icon: 'clock' },
      { value: 'copy', label: t('复制路径'), icon: 'copy' },
    ]
    if (tg.file) return [...fileItems(tg.file), { separator: true }, ...common]
    return path
      ? common
      : [
          { value: 'expand', label: t('全部展开'), icon: 'plus' },
          { value: 'collapse', label: t('全部折叠'), icon: 'minus' },
        ]
  }
  const onMenu = (value: string, tg: ChangeTarget) => {
    const path = tg.file?.path ?? commonDir(tg.changes)
    if (value === 'history') (history?.open ?? ((p: string) => cmd.openLog({ path: p })))(path)
    else if (value === 'copy') cmd.copy(path)
    else if (value === 'expand') setClosed(new Set())
    else if (value === 'collapse') setClosed(new Set(folderPaths(groups)))
    else if (tg.file) onFileItem(value, tg.file)
  }
  return (
    <div className="glog-files">
      <div className="glog-files__bar">
        {extra}
        <span className="spacer" />
        <Tool
          icon={layout === 'tree' ? 'list' : 'folder'}
          label={layout === 'tree' ? t('平铺显示') : t('按目录分组')}
          onClick={toggleLayout}
        />
        <Tool icon="plus" label={t('全部展开')} onClick={() => setClosed(new Set())} />
        <Tool icon="minus" label={t('全部折叠')} onClick={() => setClosed(new Set(folderPaths(groups)))} />
      </div>
      {error ? (
        <EmptyState compact icon="warning" title={t('无法读取变更')} description={error} />
      ) : !changes ? (
        <div className="glog-note">
          <Spinner size={14} />
        </div>
      ) : changes.length ? (
        <ChangeTree
          groups={groups}
          layout={layout}
          selected={selected}
          onSelect={onSelect}
          onOpen={onOpen}
          closed={closed}
          onToggleFolder={(key) =>
            setClosed((s) => {
              const next = new Set(s)
              if (!next.delete(key)) next.add(key)
              return next
            })
          }
          menu={menu}
          onMenu={onMenu}
          label={t('变更文件')}
        />
      ) : (
        <EmptyState compact icon="doc" title={t('没有文件变化')} />
      )}
    </div>
  )
}
