import type { DiffScope } from '@gonggong/protocol'
import type { CSSProperties } from 'react'
import { cx } from '../../lib/cx'
import { Icon, SegmentedControl } from '../../ui'
import { type DiffFile, diffCells } from './patch'
import './diff.css'

/** Five cells split between added and deleted lines (GitHub style); the numbers stay as text beside it. */
export function DiffBar({ add, del }: { add: number; del: number }) {
  const label = `新增 ${add} 行，删除 ${del} 行`
  return (
    <span className="diff-bar" role="img" aria-label={label} title={label}>
      {diffCells(add, del).map((c, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the five cells are positional
        <span key={i} className="diff-bar__cell" data-cell={c} style={{ '--i': i } as CSSProperties} />
      ))}
    </span>
  )
}

export function DiffFileList({
  files,
  active,
  onPick,
}: {
  files: DiffFile[]
  active?: DiffFile
  onPick: (path: string) => void
}) {
  return (
    <div className="diff__files">
      {files.map((f) => (
        <button
          key={f.path}
          type="button"
          className={cx('diff__file', f === active && 'diff__file--active')}
          title={f.path}
          onClick={() => onPick(f.path)}
        >
          <Icon name="doc-code" size={13} />
          <span className="diff__path">
            <span className="diff__base">{f.path.split('/').at(-1)}</span>
            <span className="diff__dir">{f.path.split('/').slice(0, -1).join('/')}</span>
          </span>
          <span className="diff__add">+{f.add}</span>
          <span className="diff__del">−{f.del}</span>
          {f.binary ? null : <DiffBar add={f.add} del={f.del} />}
        </button>
      ))}
    </div>
  )
}

const lineClass = (l: string) =>
  l.startsWith('+')
    ? 'add'
    : l.startsWith('-')
      ? 'del'
      : l.startsWith('@@')
        ? 'hunk'
        : l.startsWith(' ')
          ? ''
          : 'note'

export function DiffView({ file }: { file: DiffFile }) {
  return (
    <div className="diff">
      <div className="diff__name">{file.path}</div>
      <div className="diff__lines">
        {file.lines.map((l, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: diff lines are positional and never reorder
          <div key={i} className={cx('diff__line', lineClass(l) && `diff__line--${lineClass(l)}`)}>
            {l || ' '}
          </div>
        ))}
      </div>
    </div>
  )
}

export function DiffScopeBar({
  scope,
  turn,
  onChange,
}: {
  scope: DiffScope
  /** Offer 本轮 (the view belongs to a run). */
  turn: boolean
  onChange: (scope: DiffScope) => void
}) {
  const items: { value: DiffScope; label: string }[] = [
    ...(turn ? [{ value: 'turn' as const, label: '本轮' }] : []),
    { value: 'uncommitted', label: '未提交' },
    { value: 'base', label: '对比主分支' },
  ]
  return (
    <SegmentedControl size="small" aria-label="改动范围" items={items} value={scope} onChange={onChange} />
  )
}

/** What the scope compares, e.g. feat/x → main. */
export function scopeNote(scope: DiffScope, branch: string | null, base: string | null) {
  if (scope === 'base' && base) return `${branch ?? 'HEAD'} → ${base}`
  return branch
}

/** Why a scope is empty, in the user's terms. */
export function emptyText(scope: DiffScope, branch: string | null, base: string | null) {
  if (scope === 'turn') return '本轮没有文件改动'
  if (scope === 'uncommitted') return '没有未提交的改动'
  return base ? `${branch ?? '当前分支'} 相对 ${base} 没有改动` : '当前就在主分支，没有可对比的改动'
}
