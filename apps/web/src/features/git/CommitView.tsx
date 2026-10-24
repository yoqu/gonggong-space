import type { GitChangesDto } from '@gonggong/protocol'
import { type KeyboardEvent, useState } from 'react'
import { t } from '../../i18n'
import { Alert, Button, EmptyState, Icon, type MenuItem, Spinner, Tooltip } from '../../ui'
import type { GitTarget } from './api'
import {
  type ChangeGroup,
  type ChangeTarget,
  ChangeTree,
  commitPaths,
  folderPaths,
  type TreeChange,
  useChangeLayout,
} from './ChangeTree'
import { CommitBox } from './CommitBox'
import { gitCommands, ongoingLabel } from './commands'
import { useCommitDraft } from './draft'

const MAC = /Mac|iPhone|iPad/.test(navigator.userAgent)
/** IDEA's keys for Show Diff, Rollback and Jump to Source, as the menu names them. */
const KEYS = { diff: MAC ? '⌘D' : 'Ctrl+D', rollback: MAC ? '⌘⌥Z' : 'Ctrl+Alt+Z', open: 'F4' }

/** The change list's groups: conflicts first, then tracked changes, then untracked files. */
export function changeGroups(data: GitChangesDto): ChangeGroup[] {
  return [
    {
      key: 'conflicts',
      label: t('合并冲突'),
      changes: data.conflicts.map((c) => ({ path: c.path, change: 'modified' as const, conflict: c })),
    },
    { key: 'changes', label: t('更改'), changes: data.changes.filter((c) => !c.untracked), checkable: true },
    {
      key: 'untracked',
      label: t('未跟踪的文件'),
      changes: data.changes.filter((c) => c.untracked),
      checkable: true,
    },
  ]
}

const tracked = (changes: TreeChange[]) => changes.filter((c) => !c.conflict && !c.untracked)
const unversioned = (changes: TreeChange[]) => changes.filter((c) => c.untracked).map((c) => c.path)

/**
 * IDEA's Commit window: the toolbar, the change tree with commit checkboxes and a context menu for the selected files or
 * a folder, and the message area, which stays while the changes load. `onSelect` shows a change (beside it when wide);
 * a double click, Enter or ⌘D opens it in its own tab.
 */
export function CommitView({
  target,
  data,
  error,
  selected,
  onSelect,
  onReload,
}: {
  target: GitTarget
  data: GitChangesDto | null
  error: string | null
  selected: string | null
  onSelect: (c: TreeChange) => void
  onReload: () => void
}) {
  const layout = useChangeLayout((s) => s.layout)
  const toggleLayout = useChangeLayout((s) => s.toggle)
  const { draft, check } = useCommitDraft(target)
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set())
  const [several, setSeveral] = useState<ReadonlySet<string>>(new Set())
  const cmd = gitCommands(target)
  const groups = data ? changeGroups(data) : []
  const all = data?.changes ?? []
  const rows = groups.flatMap((g) => g.changes)
  // Unversioned files stay out of a commit until picked (IDEA); what was picked or left out by hand stays so.
  const checked = new Set(all.filter((c) => draft.checks[c.path] ?? !c.untracked).map((c) => c.path))
  const picked = all.filter((c) => checked.has(c.path))
  const lead = rows.find((c) => c.path === selected) ?? null
  // Selected with the lead; once the lead moved elsewhere (its tab, a refresh) it is selected alone.
  const selection: ReadonlySet<string> =
    lead && several.has(lead.path) ? several : new Set(lead ? [lead.path] : [])
  const chosen = rows.filter((c) => selection.has(c.path))
  const toggleFolder = (key: string) =>
    setClosed((s) => {
      const next = new Set(s)
      if (!next.delete(key)) next.add(key)
      return next
    })
  const open = (c: TreeChange) => (c.conflict ? cmd.openMerge(c.path) : cmd.openChange(c.path))
  /** Untracked files have nothing to roll back to: they are deleted instead. */
  const rollback = (changes: TreeChange[]) => {
    const files = tracked(changes)
    if (files.length) cmd.rollback(files)
  }
  const keys = (e: KeyboardEvent<HTMLElement>) => {
    const mod = e.metaKey || e.ctrlKey
    // ⌥ changes the character typed (⌥Z is Ω on a Mac), so Z is read by its place.
    if (mod && e.altKey && e.code === 'KeyZ') rollback(chosen)
    else if (mod && !e.altKey && e.key.toLowerCase() === 'd') {
      if (lead) open(lead)
    } else if (e.key === 'F4') {
      if (lead && lead.change !== 'deleted') cmd.openFile(lead.path)
    } else return
    e.preventDefault()
  }
  const menu = (tg: ChangeTarget): MenuItem[] => {
    const f = tg.file
    if (f?.conflict)
      return [
        { value: 'merge', label: t('合并…'), icon: 'git-merge' },
        { value: 'ours', label: t('接受你的版本') },
        { value: 'theirs', label: t('接受他们的版本') },
        { separator: true },
        { value: 'copy', label: t('复制路径'), icon: 'copy' },
      ]
    const files = tg.changes.filter((c) => !c.conflict)
    return [
      ...(f
        ? ([
            { value: 'diff', label: t('显示差异'), icon: 'doc-text', shortcut: KEYS.diff },
            {
              value: 'open',
              label: t('打开文件'),
              icon: 'doc',
              shortcut: KEYS.open,
              disabled: f.change === 'deleted',
            },
            // git blames what HEAD has: nothing for a new or deleted file, nor an uncommitted rename.
            {
              value: 'annotate',
              label: t('注解'),
              icon: 'person',
              disabled: !!f.untracked || f.change !== 'modified',
            },
            { separator: true },
          ] as MenuItem[])
        : []),
      {
        value: 'rollback',
        label: t('回滚…'),
        icon: 'undo',
        shortcut: KEYS.rollback,
        destructive: true,
        disabled: !tracked(files).length,
      },
      ...(files.some((c) => c.untracked)
        ? ([
            { value: 'delete', label: t('删除…'), icon: 'trash', destructive: true },
            { value: 'add', label: t('加入版本控制'), icon: 'plus' },
            { value: 'ignore', label: t('加入 .gitignore…'), icon: 'eye-slash' },
          ] as MenuItem[])
        : []),
      { separator: true },
      { value: 'stash', label: t('贮藏所选文件…'), icon: 'archive', disabled: !files.length },
      { value: 'patch', label: t('复制为补丁'), icon: 'doc-code', disabled: !files.length },
      ...(f
        ? ([
            { separator: true },
            { value: 'history', label: t('显示历史'), icon: 'clock', disabled: !!f.untracked },
            { value: 'copy', label: t('复制路径'), icon: 'copy' },
          ] as MenuItem[])
        : []),
    ]
  }
  const onMenu = (value: string, tg: ChangeTarget) => {
    const f = tg.file
    const files = tg.changes.filter((c) => !c.conflict)
    if (value === 'diff' && f) open(f)
    else if (value === 'open' && f) cmd.openFile(f.path)
    else if (value === 'annotate' && f) cmd.openFile(f.path, true)
    else if (value === 'rollback') rollback(files)
    else if (value === 'delete') cmd.deleteFiles(unversioned(files))
    else if (value === 'add') cmd.addToVcs(unversioned(files))
    else if (value === 'ignore') cmd.ignore(unversioned(files))
    else if (value === 'stash') cmd.stash(commitPaths(files))
    else if (value === 'patch') void cmd.copyPatch(commitPaths(files))
    else if (value === 'history' && f) cmd.openLog({ path: f.path })
    else if (value === 'copy') cmd.copy(tg.changes.map((c) => c.path).join('\n'))
    else if (value === 'merge' && f) cmd.openMerge(f.path)
    else if ((value === 'ours' || value === 'theirs') && f) void cmd.resolve(f.path, value)
  }
  const ongoing = data?.ongoing ?? null
  return (
    <div className="gc">
      <div className="gc-bar" role="toolbar" aria-label={t('更改')}>
        <ToolIcon icon="arrow-clockwise" label={t('刷新')} onClick={onReload} />
        <ToolIcon
          icon="undo"
          label={t('回滚所选文件…')}
          disabled={!tracked(chosen).length}
          onClick={() => rollback(chosen)}
        />
        <ToolIcon icon="doc-text" label={t('显示差异')} disabled={!lead} onClick={() => lead && open(lead)} />
        <ToolIcon
          icon="archive"
          label={t('贮藏…')}
          disabled={!all.length}
          onClick={() => cmd.stash(picked.length === all.length ? null : commitPaths(picked))}
        />
        <span className="gc-bar__sep" />
        <ToolIcon
          icon={layout === 'tree' ? 'list' : 'folder'}
          label={layout === 'tree' ? t('平铺显示') : t('按目录分组')}
          onClick={toggleLayout}
        />
        <ToolIcon icon="plus" label={t('全部展开')} onClick={() => setClosed(new Set())} />
        <ToolIcon
          icon="minus"
          label={t('全部折叠')}
          onClick={() => setClosed(new Set(folderPaths(groups)))}
        />
        <span className="spacer" />
        {all.length ? (
          <button
            type="button"
            className="gc-bar__all"
            onClick={() =>
              check(
                all.map((c) => c.path),
                picked.length !== all.length,
              )
            }
          >
            {picked.length === all.length ? t('取消全选') : t('全选')}
          </button>
        ) : null}
      </div>
      {data?.limited ? (
        <Alert
          description={t('Bot 所在机器的客户端版本较旧：未跟踪文件、冲突与修改上一次提交需升级后使用')}
        />
      ) : null}
      <div className="gc-tree">
        {error ? (
          <Alert variant="error" description={t('读取改动失败：{error}', { error })} />
        ) : !data ? (
          <div className="git-refs__note">
            <Spinner size={14} />
          </div>
        ) : all.length || data.conflicts.length ? (
          <ChangeTree
            groups={groups}
            layout={layout}
            selected={lead?.path ?? null}
            selection={selection}
            onSelect={onSelect}
            onSelection={setSeveral}
            onOpen={open}
            checked={checked}
            onCheck={check}
            closed={closed}
            onToggleFolder={toggleFolder}
            menu={menu}
            onMenu={onMenu}
            onKeyDown={keys}
            label={t('要提交的文件')}
          />
        ) : (
          <EmptyState
            compact
            icon="checkmark-circle"
            title={ongoing ? t('冲突已全部解决') : t('没有未提交的改动')}
            description={ongoing ? t('完成{op}后提交', { op: ongoingLabel(ongoing.kind) }) : undefined}
          />
        )}
      </div>
      <CommitBox
        target={target}
        paths={commitPaths(picked)}
        count={picked.length}
        head={data?.head ?? null}
        total={all.length}
        ongoing={ongoing}
        conflicts={data?.conflicts.length ?? 0}
      />
    </div>
  )
}

export function ToolIcon({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: Parameters<typeof Icon>[0]['name']
  label: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <Tooltip content={label}>
      <button type="button" className="gc-tool" aria-label={label} disabled={disabled} onClick={onClick}>
        <Icon name={icon} size={14} />
      </button>
    </Tooltip>
  )
}

/**
 * What stopped midway (IDEA's "Merging" / "Rebasing" state): the conflicts left and the ways out — resolve them,
 * continue (a merge commits with git's message), skip the commit, or abort.
 */
export function OngoingBanner({ target, data }: { target: GitTarget; data: GitChangesDto | null }) {
  const ongoing = data?.ongoing ?? null
  const conflicts = data?.conflicts ?? []
  if (!ongoing && !conflicts.length) return null
  const cmd = gitCommands(target)
  const subject = ongoing?.subject ?? ''
  const title = !ongoing
    ? t('有未解决的冲突')
    : ongoing.kind === 'merge'
      ? t('正在合并 {subject}', { subject })
      : ongoing.kind === 'rebase'
        ? ongoing.step && ongoing.total
          ? t('正在变基 {subject}（第 {step} / {total} 个提交）', {
              subject,
              step: ongoing.step,
              total: ongoing.total,
            })
          : t('正在变基 {subject}', { subject })
        : ongoing.kind === 'cherry-pick'
          ? t('正在优选 {subject}', { subject })
          : t('正在还原 {subject}', { subject })
  const [first] = conflicts
  return (
    <div className="gc-ongoing" role="status">
      <Icon name={conflicts.length ? 'warning' : 'git-merge'} size={15} />
      <div className="gc-ongoing__text">
        <span className="gc-ongoing__title">{title}</span>
        <span className="gc-ongoing__detail">
          {conflicts.length
            ? t('{n} 个文件有冲突，解决后才能继续', { n: conflicts.length })
            : t('冲突已全部解决，可以继续')}
        </span>
      </div>
      <span className="spacer" />
      {first ? (
        <Button size="small" variant="primary" onClick={() => cmd.openMerge(first.path)}>
          {t('解决冲突')}
        </Button>
      ) : ongoing ? (
        <Button size="small" variant="primary" onClick={() => cmd.continueOngoing(ongoing)}>
          {ongoing.kind === 'merge' ? t('提交合并…') : t('继续{op}', { op: ongoingLabel(ongoing.kind) })}
        </Button>
      ) : null}
      {ongoing && ongoing.kind !== 'merge' ? (
        <Button size="small" onClick={cmd.skipCommit}>
          {t('跳过此提交')}
        </Button>
      ) : null}
      <Button size="small" variant="plain" onClick={() => cmd.abortOngoing(ongoing)}>
        {ongoing ? t('中止{op}', { op: ongoingLabel(ongoing.kind) }) : t('放弃')}
      </Button>
    </div>
  )
}
