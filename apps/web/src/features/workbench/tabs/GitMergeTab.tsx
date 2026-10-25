import type { GitChangesDto, GitConflict, GitConflictDto } from '@gonggong/protocol'
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useWorkbench } from '../../../app/workbench'
import { useWorkspace } from '../../../app/workspace'
import { t } from '../../../i18n'
import { Alert, AlertDialog, Button, EmptyState, Icon, MenuButton, Spinner } from '../../../ui'
import { useGitStamp } from '../../diff/useWorkspaceDiff'
import { gitActionTaken, gitBase, gitUrls, repoStatus, runGitAction, useGitGet } from '../../git/api'
import { ToolIcon } from '../../git/CommitView'
import { inTarget, ongoingLabel } from '../../git/commands'
import {
  applySide,
  ignoreSide,
  initialState,
  isResolved,
  joinText,
  magic,
  mergeDraftKey,
  openState,
  type Piece,
  type PieceState,
  splitTexts,
  threeWay,
  useMergeDrafts,
} from '../../git/merge'
import { useOwner } from '../../git/owner'
import type { TabMeta, TabProps } from '../types'
import '../../git/merge.css'

type Side = 'ours' | 'theirs'

/**
 * What each side is. In a rebase git's "ours" is the branch rebased onto (with the commits replayed so far) and
 * "theirs" the commit being replayed, as IDEA names them.
 */
function sides(data: GitChangesDto | null, branch: string | null) {
  const ongoing = data?.ongoing ?? null
  const subject = ongoing?.subject ?? ''
  const ours = t('你的 · {branch}', { branch: branch ?? t('当前 HEAD') })
  if (!ongoing) return { ours, theirs: t('要并入的改动（贮藏或 squash 合并）') }
  if (ongoing.kind === 'rebase') {
    const head = data?.head?.shortHash
    return {
      ours: head ? t('已变基的提交 · {head}', { head }) : t('已变基的提交'),
      theirs: subject ? t('正在重放的提交 · {subject}', { subject }) : t('正在重放的提交'),
    }
  }
  if (ongoing.kind === 'cherry-pick') return { ours, theirs: t('正在优选的提交 · {subject}', { subject }) }
  if (ongoing.kind === 'revert') return { ours, theirs: t('还原 {subject} 的改动', { subject }) }
  return { ours, theirs: t('他们的 · {subject}', { subject: subject || t('合并进来的分支') }) }
}

const SIDE: Record<GitConflict['ours'], string> = {
  modified: t('修改了文件'),
  added: t('新增了文件'),
  deleted: t('删除了文件'),
}

/**
 * IDEA's Merge Revisions for one conflicted file: yours | result | theirs, worked out from the three versions, changes
 * of one side already taken, each conflict settled with » / « / × or by typing into the result; applying writes the
 * result and marks it resolved, then moves on to the next conflicted file. A delete, add or binary conflict can only
 * take a whole side.
 */
export function GitMergeTab({ tab, tabKey }: TabProps<'git-merge'>) {
  const groupId = useWorkbench((s) => s.groupId) ?? ''
  const patch = useWorkbench((s) => s.patch)
  const closeTab = useWorkbench((s) => s.closeTab)
  const git = useWorkspace((s) => s.botStates[groupId]?.[tab.botId]?.git ?? null)
  const { owner } = useOwner(tab.botId)
  const target = { groupId, botId: tab.botId, repo: tab.repo ?? null }
  const stamp = useGitStamp(groupId, tab.botId)
  const base = gitBase(groupId, tab.botId)
  const draftKey = mergeDraftKey(tab.botId, target.repo, tab.path)
  const saveDraft = useMergeDrafts((s) => s.save)
  // Read once per file: a status change while resolving must not throw the choices away.
  const read = useGitGet<GitConflictDto>(gitUrls.conflict(base, tab.path, target.repo))
  const changes = useGitGet<GitChangesDto>(gitUrls.changes(base, target.repo), stamp)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const conflicts = changes.data?.conflicts ?? []
  const mine = conflicts.find((c) => c.path === tab.path) ?? null
  const at = conflicts.findIndex((c) => c.path === tab.path)
  const status = git ? repoStatus(git, target.repo) : null
  const label = sides(changes.data, status?.branch ?? null)
  const go = (path: string) => {
    setError(null)
    patch(tabKey, { path })
  }

  const finish = async (req: { side?: Side; content?: string }) => {
    setBusy(true)
    setError(null)
    const op = await runGitAction(
      groupId,
      tab.botId,
      inTarget(target, { action: 'resolve', path: tab.path, ...req }),
    )
    setBusy(false)
    if (!gitActionTaken(op)) return setError(op?.error ?? null)
    if (op?.status !== 'succeeded') return
    saveDraft(draftKey, null)
    const left = conflicts.filter((c) => c.path !== tab.path)
    const next = left[at] ?? left[0]
    if (next) go(next.path)
    else closeTab(tabKey)
  }

  if (changes.data && !mine)
    return (
      <div className="gm">
        <EmptyState
          compact
          icon="checkmark-circle"
          title={t('{path} 的冲突已解决', { path: tab.path })}
          description={conflicts.length ? t('还有 {n} 个文件有冲突', { n: conflicts.length }) : undefined}
          action={
            conflicts[0] ? (
              <Button onClick={() => go(conflicts[0]?.path ?? '')}>{t('下一个冲突')}</Button>
            ) : (
              <Button onClick={() => closeTab(tabKey)}>{t('关闭')}</Button>
            )
          }
        />
      </div>
    )
  if (read.error) return <Alert variant="error" description={read.error} />
  if (!read.data)
    return (
      <div className="gm gm--loading">
        <Spinner />
      </div>
    )

  const data = read.data
  const header = (
    <div className="gm-bar">
      <Icon name="git-merge" size={15} />
      <span className="gm-bar__path" title={tab.path}>
        {tab.path}
      </span>
      <span className="spacer" />
      {conflicts.length > 1 ? (
        <span className="gm-nav">
          <button
            type="button"
            className="gc-tool"
            aria-label={t('上一个冲突文件')}
            onClick={() => go(conflicts[(at - 1 + conflicts.length) % conflicts.length]?.path ?? tab.path)}
          >
            <Icon name="chevron-left" size={13} />
          </button>
          {t('第 {i} / {n} 个文件', { i: at + 1, n: conflicts.length })}
          <button
            type="button"
            className="gc-tool"
            aria-label={t('下一个冲突文件')}
            onClick={() => go(conflicts[(at + 1) % conflicts.length]?.path ?? tab.path)}
          >
            <Icon name="chevron-right" size={13} />
          </button>
        </span>
      ) : null}
      <ToolIcon
        icon="arrow-clockwise"
        label={t('重新读取冲突')}
        onClick={() => {
          saveDraft(draftKey, null)
          read.reload()
        }}
      />
    </div>
  )
  const footer = (apply: ReactNode) => (
    <>
      {owner ? null : <Alert description={t('解决冲突需要 Bot 主人批准后才会写入')} />}
      {error ? <Alert variant="error" description={error} /> : null}
      <div className="gm-foot">
        <Button size="small" disabled={busy} onClick={() => void finish({ side: 'ours' })}>
          {t('全部接受你的')}
        </Button>
        <Button size="small" disabled={busy} onClick={() => void finish({ side: 'theirs' })}>
          {t('全部接受他们的')}
        </Button>
        <span className="spacer" />
        {apply}
      </div>
    </>
  )

  // A side deleted the file, a side added it as something else, or it is binary: only a whole side can be taken.
  if (data.merged == null || data.ours == null || data.theirs == null)
    return (
      <div className="gm">
        {header}
        <div className="gm-pick">
          <p className="gm-pick__note">
            {data.binary
              ? t('二进制文件无法逐处合并，请选择保留哪一方')
              : t('两边对这个文件的处理不同，请选择保留哪一方')}
          </p>
          <div className="gm-pick__sides">
            <SideCard
              title={t('你的版本')}
              who={label.ours}
              did={mine ? SIDE[mine.ours] : ''}
              text={data.ours}
              action={busy ? <Spinner size={12} /> : t('保留你的版本')}
              onPick={() => void finish({ side: 'ours' })}
              tone="ours"
            />
            <SideCard
              title={t('他们的版本')}
              who={label.theirs}
              did={mine ? SIDE[mine.theirs] : ''}
              text={data.theirs}
              action={busy ? <Spinner size={12} /> : t('保留他们的版本')}
              onPick={() => void finish({ side: 'theirs' })}
              tone="theirs"
            />
          </div>
          {owner ? null : <Alert description={t('解决冲突需要 Bot 主人批准后才会写入')} />}
          {error ? <Alert variant="error" description={error} /> : null}
        </div>
      </div>
    )

  return (
    <MergeView
      key={draftKey}
      texts={[data.base ?? '', data.ours, data.theirs]}
      draftKey={draftKey}
      labels={label}
      header={header}
      footer={footer}
      busy={busy}
      applyLabel={owner ? t('应用') : t('提交申请')}
      onApply={(content) => void finish({ content })}
    />
  )
}

/** The three panes, their tools, and the result written on 应用. */
function MergeView({
  texts,
  draftKey,
  labels,
  header,
  footer,
  busy,
  applyLabel,
  onApply,
}: {
  texts: [string, string, string]
  draftKey: string
  labels: { ours: string; theirs: string }
  header: ReactNode
  footer: (apply: ReactNode) => ReactNode
  busy: boolean
  applyLabel: string
  onApply: (content: string) => void
}) {
  const [baseText, oursText, theirsText] = texts
  const split = useMemo(() => splitTexts([baseText, oursText, theirsText]), [baseText, oursText, theirsText])
  const source = `${baseText}\0${oursText}\0${theirsText}`
  const stored = useMergeDrafts((s) => s.drafts[draftKey])
  const saveDraft = useMergeDrafts((s) => s.save)
  // A draft of other contents (the file was merged again since) is stale.
  const draft = stored?.source === source ? stored : null
  const ignoreWhitespace = draft?.ignoreWhitespace ?? false
  const compute = (ws: boolean) => {
    const [b = [], o = [], th = []] = split.sides
    return threeWay(b, o, th, ws)
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: recomputed only when the texts or the option change
  const pieces = useMemo(() => compute(ignoreWhitespace), [split, ignoreWhitespace])
  const fresh = useMemo(() => pieces.map(initialState), [pieces])
  const states = draft?.states.length === pieces.length ? draft.states : fresh
  const save = (next: PieceState[], ws = ignoreWhitespace) =>
    saveDraft(draftKey, { source, ignoreWhitespace: ws, states: next })
  const update = (i: number, s: PieceState) => save(states.map((x, k) => (k === i ? s : x)))

  const [showBase, setShowBase] = useState(false)
  const [current, setCurrent] = useState<number | null>(() => {
    const at = pieces.findIndex((p, i) => p.kind === 'conflict' && !isResolved(states[i] as PieceState))
    return at < 0 ? null : at
  })
  const [confirming, setConfirming] = useState(false)
  const doc = useRef<HTMLDivElement>(null)

  const conflictAt = pieces.flatMap((p, i) => (p.kind === 'conflict' ? [i] : []))
  const open = conflictAt.filter((i) => !isResolved(states[i] as PieceState))
  const canMagic = pieces.some((p, i) => magic(p, states[i] as PieceState))
  const nonConflict = (side: Side | 'all') =>
    pieces.flatMap((p, i) =>
      (p.kind === 'ours' || p.kind === 'theirs') &&
      (side === 'all' || side === p.kind) &&
      states[i]?.[p.kind] === 'open'
        ? [i]
        : [],
    )

  const jump = (i: number) => {
    setCurrent(i)
    doc.current?.querySelector(`[data-piece="${i}"]`)?.scrollIntoView?.({ block: 'center' })
  }
  /** F7 / ⇧F7: the next (previous) unresolved conflict, any conflict once all are resolved. */
  const step = (dir: 1 | -1) => {
    const list = open.length ? open : conflictAt
    if (!list.length) return
    const from = current ?? (dir === 1 ? -1 : pieces.length)
    const next =
      dir === 1 ? (list.find((i) => i > from) ?? list[0]) : (list.findLast((i) => i < from) ?? list.at(-1))
    if (next != null) jump(next)
  }
  const result = joinText(
    states.flatMap((s) => s.lines),
    split.eol,
    split.trailing,
  )
  const keys = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'F7') return
    e.preventDefault()
    step(e.shiftKey ? -1 : 1)
  }

  const no = { base: 1, ours: 1, result: 1, theirs: 1 }
  let changeNo = 0
  let conflictNo = 0
  const rows = pieces.map((p, i) => {
    const s = states[i] as PieceState
    const from = { ...no }
    no.base += p.base.length
    no.ours += p.ours.length
    no.result += s.lines.length
    no.theirs += p.theirs.length
    if (p.kind === 'same')
      return (
        // biome-ignore lint/suspicious/noArrayIndexKey: pieces are worked out anew only with the texts
        <div key={i} className="gm3-row" data-piece={i}>
          {showBase ? <Cell col="base" lines={p.base} from={from.base} /> : null}
          <Cell col="ours" lines={p.ours} from={from.ours} />
          <span className="gm3-gutter" />
          <ResultCell
            lines={s.lines}
            from={from.result}
            label={t('第 {line} 行起的合并结果', { line: from.result })}
            onEdit={(lines) => update(i, { ...s, lines })}
          />
          <span className="gm3-gutter" />
          <Cell col="theirs" lines={p.theirs} from={from.theirs} />
        </div>
      )
    changeNo++
    const n = p.kind === 'conflict' ? ++conflictNo : changeNo
    const done = isResolved(s)
    const touched = s.edited || s.ours !== openState(p).ours || s.theirs !== openState(p).theirs
    const tone = (side: Side) =>
      p.kind === 'conflict'
        ? 'conflict'
        : p.kind !== side && p.kind !== 'both'
          ? undefined
          : !p.base.length
            ? 'inserted'
            : !p[side].length
              ? 'deleted'
              : 'modified'
    const name = p.kind === 'conflict' ? t('冲突 {n}#nth', { n }) : t('改动 {n}#nth', { n })
    return (
      // biome-ignore lint/a11y/useSemanticElements: a row of the three panes, not a form fieldset
      // biome-ignore lint/suspicious/noArrayIndexKey: pieces are worked out anew only with the texts
      <div
        key={i}
        className="gm3-row"
        role="group"
        aria-label={name}
        data-piece={i}
        data-kind={p.kind}
        data-done={done || undefined}
        data-current={current === i || undefined}
      >
        {showBase ? <Cell col="base" lines={p.base} from={from.base} tone="base" /> : null}
        <Cell col="ours" lines={p.ours} from={from.ours} tone={tone('ours')} />
        <Gutter
          side="ours"
          state={s.ours}
          onApply={() => update(i, applySide(p, s, 'ours'))}
          onIgnore={() => update(i, ignoreSide(s, 'ours'))}
          onUndo={touched ? () => update(i, openState(p)) : undefined}
        />
        <ResultCell
          lines={s.lines}
          from={from.result}
          tone={p.kind === 'conflict' && !done ? 'conflict' : 'merged'}
          label={
            p.kind === 'conflict'
              ? t('冲突 {n} 的合并结果', { n })
              : t('第 {line} 行起的合并结果', { line: from.result })
          }
          onEdit={(lines) => update(i, { ...s, lines, edited: true })}
        />
        <Gutter
          side="theirs"
          state={s.theirs}
          onApply={() => update(i, applySide(p, s, 'theirs'))}
          onIgnore={() => update(i, ignoreSide(s, 'theirs'))}
        />
        <Cell col="theirs" lines={p.theirs} from={from.theirs} tone={tone('theirs')} />
      </div>
    )
  })

  const applyAll = (side: Side | 'all') => {
    const at = new Set(nonConflict(side))
    save(
      states.map((s, i) =>
        at.has(i) ? applySide(pieces[i] as Piece, s, (pieces[i] as Piece).kind as Side) : s,
      ),
    )
  }
  return (
    <section className="gm" aria-label={t('合并工具')} onKeyDown={keys}>
      {header}
      <div className="gm-tools" role="toolbar">
        <span className="gm-tools__count">
          {t('{n} 处冲突，已解决 {done} 处', { n: conflictAt.length, done: conflictAt.length - open.length })}
        </span>
        <span className="gm-tools__sep" />
        <ToolIcon
          icon="arrow-up"
          label={t('上一处冲突')}
          disabled={!conflictAt.length}
          onClick={() => step(-1)}
        />
        <ToolIcon
          icon="arrow-down"
          label={t('下一处冲突')}
          disabled={!conflictAt.length}
          onClick={() => step(1)}
        />
        <MenuButton
          className="gtb-btn"
          aria-label={t('应用非冲突改动')}
          disabled={!nonConflict('all').length}
          items={[
            { value: 'ours', label: t('应用左侧的非冲突改动'), disabled: !nonConflict('ours').length },
            { value: 'all', label: t('应用所有非冲突改动') },
            { value: 'theirs', label: t('应用右侧的非冲突改动'), disabled: !nonConflict('theirs').length },
          ]}
          onSelect={(v) => applyAll(v as Side | 'all')}
        >
          <span className="gm3-arrows">»«</span>
        </MenuButton>
        <ToolIcon
          icon="bolt"
          label={t('解决简单冲突')}
          disabled={!canMagic}
          onClick={() => save(states.map((s, i) => magic(pieces[i] as Piece, s) ?? s))}
        />
        <span className="spacer" />
        <Button
          size="small"
          variant="plain"
          aria-pressed={ignoreWhitespace}
          onClick={() => save(compute(!ignoreWhitespace).map(initialState), !ignoreWhitespace)}
        >
          {t('忽略空白')}
        </Button>
        <Button size="small" variant="plain" aria-pressed={showBase} onClick={() => setShowBase(!showBase)}>
          {t('显示基准')}
        </Button>
      </div>
      <div className="gm3" ref={doc} data-base={showBase || undefined}>
        <div className="gm3-row gm3-head">
          {showBase ? <span className="gm3-title">{t('基准')}</span> : null}
          <span className="gm3-title gm-ours">{labels.ours}</span>
          <span />
          <span className="gm3-title">{t('结果')}</span>
          <span />
          <span className="gm3-title gm-theirs">{labels.theirs}</span>
        </div>
        {rows}
      </div>
      {footer(
        <Button
          size="small"
          variant="primary"
          disabled={busy}
          onClick={() => (open.length ? setConfirming(true) : onApply(result))}
        >
          {busy ? <Spinner size={12} /> : null}
          {applyLabel}
        </Button>,
      )}
      <AlertDialog
        open={confirming}
        title={t('还有未解决的冲突')}
        message={t('还有 {n} 处冲突未解决，仍然应用并标记为已解决？', { n: open.length })}
        onClose={() => setConfirming(false)}
        actions={[
          { label: t('取消'), onClick: () => setConfirming(false) },
          {
            label: t('仍然应用'),
            variant: 'destructive',
            onClick: () => {
              setConfirming(false)
              onApply(result)
            },
          },
        ]}
      />
    </section>
  )
}

const numbers = (from: number, n: number) => Array.from({ length: n }, (_, k) => from + k).join('\n')
const height = (n: number) => ({ '--n': n }) as CSSProperties

function Cell({ col, lines, from, tone }: { col: string; lines: string[]; from: number; tone?: string }) {
  return (
    <div className="gm3-cell" data-col={col} data-tone={tone} data-empty={!lines.length || undefined}>
      <pre className="gm3-no" aria-hidden="true" style={height(lines.length)}>
        {numbers(from, lines.length)}
      </pre>
      <pre className="gm3-code" style={height(lines.length)}>
        {lines.join('\n')}
      </pre>
    </div>
  )
}

/** The result's lines of a piece, typed into directly. */
function ResultCell({
  lines,
  from,
  tone,
  label,
  onEdit,
}: {
  lines: string[]
  from: number
  tone?: string
  label: string
  onEdit: (lines: string[]) => void
}) {
  return (
    <div className="gm3-cell" data-col="result" data-tone={tone} data-empty={!lines.length || undefined}>
      <pre className="gm3-no" aria-hidden="true" style={height(lines.length)}>
        {numbers(from, lines.length)}
      </pre>
      {lines.length ? (
        <textarea
          className="gm3-code gm3-edit"
          aria-label={label}
          wrap="off"
          spellCheck={false}
          style={height(lines.length)}
          value={lines.join('\n')}
          onChange={(e) => onEdit(e.target.value.split('\n'))}
        />
      ) : null}
    </div>
  )
}

/** IDEA's » / « (take this side) and × (leave it out) beside a side's change; ↺ puts the change back as it was. */
function Gutter({
  side,
  state,
  onApply,
  onIgnore,
  onUndo,
}: {
  side: Side
  state: PieceState['ours']
  onApply: () => void
  onIgnore: () => void
  onUndo?: () => void
}) {
  const ours = side === 'ours'
  return (
    <span className="gm3-gutter" data-side={side}>
      {state === 'open' ? (
        <>
          <button
            type="button"
            className="gm3-act"
            aria-label={ours ? t('接受你的') : t('接受他们的')}
            title={ours ? t('接受你的') : t('接受他们的')}
            onClick={onApply}
          >
            {ours ? '»' : '«'}
          </button>
          <button
            type="button"
            className="gm3-act gm3-act--x"
            aria-label={ours ? t('忽略你的') : t('忽略他们的')}
            title={ours ? t('忽略你的') : t('忽略他们的')}
            onClick={onIgnore}
          >
            ×
          </button>
        </>
      ) : null}
      {onUndo ? (
        <button
          type="button"
          className="gm3-act"
          aria-label={t('撤销此处')}
          title={t('撤销此处')}
          onClick={onUndo}
        >
          <Icon name="undo" size={11} />
        </button>
      ) : null}
    </span>
  )
}

function SideCard({
  title,
  who,
  did,
  text,
  action,
  onPick,
  tone,
}: {
  title: string
  who: string
  did: string
  text: string | null
  action: ReactNode
  onPick: () => void
  tone: Side
}) {
  return (
    <section className="gm-side" data-tone={tone} aria-label={title}>
      <header className="gm-side__head">
        <span className="gm-side__title">{title}</span>
        <span className="gm-side__who">{who}</span>
      </header>
      <p className="gm-side__did">{did}</p>
      {text != null ? (
        <pre className="gm-side__text">{text.length > 4000 ? `${text.slice(0, 4000)}…` : text}</pre>
      ) : null}
      <Button size="small" variant="primary" onClick={onPick}>
        {action}
      </Button>
    </section>
  )
}

export function useGitMergeTabMeta(tab: TabProps<'git-merge'>['tab']): TabMeta {
  const groupId = useWorkbench((s) => s.groupId) ?? ''
  const ongoing = useWorkspace((s) => s.botStates[groupId]?.[tab.botId]?.git?.ongoing)
  const name = tab.path.slice(tab.path.lastIndexOf('/') + 1)
  return {
    icon: 'git-merge',
    title: ongoing
      ? t('{op}冲突 · {name}', { op: ongoingLabel(ongoing), name })
      : t('合并 · {name}', { name }),
  }
}
