import type { GitChange } from '@gonggong/protocol'
import { t } from '../../i18n'
import './git.css'

const MARK: Record<GitChange['change'], { letter: string; label: string }> = {
  added: { letter: 'A', label: t('新增') },
  modified: { letter: 'M', label: t('修改') },
  deleted: { letter: 'D', label: t('删除') },
  renamed: { letter: 'R', label: t('重命名#renamed') },
}

export function ChangeMark({ change }: { change: GitChange['change'] }) {
  return (
    <span className="git-mark" data-change={change} title={MARK[change].label}>
      {MARK[change].letter}
    </span>
  )
}

/** Changed files with their kind; renames show where they came from. */
export function ChangeList({
  changes,
  selected,
  onPick,
}: {
  changes: GitChange[]
  selected?: string | null
  onPick: (c: GitChange) => void
}) {
  return (
    <ul className="git-changes" aria-label={t('变更文件')}>
      {changes.map((c) => (
        <li key={c.path}>
          <button
            type="button"
            className="git-change"
            title={c.path}
            aria-current={c.path === selected || undefined}
            onClick={() => onPick(c)}
          >
            <ChangeMark change={c.change} />
            <span>{c.oldPath ? `${c.oldPath} → ${c.path}` : c.path}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}
