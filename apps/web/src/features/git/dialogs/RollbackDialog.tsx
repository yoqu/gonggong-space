import { useState } from 'react'
import { t } from '../../../i18n'
import { Checkbox, Dialog } from '../../../ui'
import type { GitTarget } from '../api'
import { ChangeTree, commitPaths, type TreeChange, useChangeLayout } from '../ChangeTree'
import { GitError, OwnerNote, useActionLabel, useGitRun } from './common'

/**
 * IDEA's Rollback Changes: the tracked files back to HEAD, each listed and ticked; files added to git lose their local
 * copy too unless 删除新增文件的本地副本 is unticked, which only unstages them.
 */
export function RollbackDialog({
  target,
  changes,
  onClose,
}: {
  target: GitTarget
  changes: TreeChange[]
  onClose: () => void
}) {
  const layout = useChangeLayout((s) => s.layout)
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set())
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set())
  const [selected, setSelected] = useState<string | null>(null)
  const [deleteAdded, setDeleteAdded] = useState(true)
  const { busy, error, submit } = useGitRun(target, onClose)
  const label = useActionLabel(target.botId)
  const picked = changes.filter((c) => !skipped.has(c.path))
  const added = (c: TreeChange) => c.change === 'added'
  const check = (paths: string[], on: boolean) =>
    setSkipped((s) => {
      const next = new Set(s)
      for (const p of paths) {
        if (on) next.delete(p)
        else next.add(p)
      }
      return next
    })
  const fold = (key: string) =>
    setClosed((s) => {
      const next = new Set(s)
      if (!next.delete(key)) next.add(key)
      return next
    })
  return (
    <Dialog
      open
      title={t('回滚改动')}
      message={t('将 {n} 个文件恢复到上次提交的状态', { n: picked.length })}
      width={520}
      onClose={onClose}
      closeOnBackdrop={false}
      actions={[
        { label: t('取消'), onClick: onClose, autoFocus: true },
        {
          label: label(t('回滚')),
          variant: 'destructive',
          disabled: busy || !picked.length,
          onClick: () =>
            void submit({
              action: 'discard',
              paths: commitPaths(picked),
              ...(!deleteAdded && picked.some(added) && { keepAdded: true }),
            }),
        },
      ]}
    >
      <div className="git-form">
        <OwnerNote botId={target.botId} />
        <div className="git-rollback__files">
          <ChangeTree
            groups={[{ key: 'changes', label: t('更改'), changes, checkable: true }]}
            layout={layout}
            selected={selected}
            onSelect={(c) => setSelected(c.path)}
            checked={new Set(picked.map((c) => c.path))}
            onCheck={check}
            closed={closed}
            onToggleFolder={fold}
            label={t('要回滚的文件')}
          />
        </div>
        {changes.some(added) ? (
          <Checkbox label={t('删除新增文件的本地副本')} checked={deleteAdded} onChange={setDeleteAdded} />
        ) : null}
        <GitError error={error} />
      </div>
    </Dialog>
  )
}
