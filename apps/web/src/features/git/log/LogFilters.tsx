import type { GitRefsDto } from '@gonggong/protocol'
import { Fragment, type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { GitLogTabFilter } from '../../../app/workbench'
import { t } from '../../../i18n'
import { pad } from '../../../lib/time'
import {
  Button,
  Icon,
  Input,
  MenuButton,
  type MenuItem,
  Popover,
  PopUpButton,
  type PopUpOption,
  TextField,
} from '../../../ui'
import { type GitTarget, shortRev } from '../api'
import { BranchesPane } from './BranchesPane'
import type { LogColumn } from './CommitTable'
import { baseName, type LogTab, type LogView, narrowed } from './query'
import { Tool } from './Tool'

/** What the filter bar and the branches pane change in the log tab. */
export interface LogControl {
  setFilter: (fields: Partial<GitLogTabFilter>) => void
  /** The ref listed: a branch, tag or commit; null = HEAD, or every branch with `all`. */
  setRef: (ref: string | null, all: boolean) => void
  setPath: (path: string | null) => void
  setRepo: (repo: string | null) => void
  /** Goes to the commit a hash (or ref) names, clearing the text filter; resolves whether it was found. */
  goTo: (rev: string) => Promise<boolean>
  /** Clears the filters, keeping the graph options. */
  clear: () => void
  refresh: () => void
}

const TYPING_MS = 400
const DAY_MS = 86_400_000
const HASH = /^[0-9a-f]{7,40}$/i

/** A local day as git takes it (YYYY-MM-DD). */
export const isoDay = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const PRESETS = [
  { days: 1, label: t('最近 24 小时') },
  { days: 7, label: t('最近 7 天') },
  { days: 30, label: t('最近 30 天') },
  { days: 365, label: t('最近一年') },
]
const presetSince = (days: number) => isoDay(Date.now() - days * DAY_MS)

/** The message filter: applied once typing pauses (or on Enter), with IDEA's regexp and match-case toggles. */
function TextFilter({
  filter,
  onText,
  onFlags,
  onGoTo,
}: {
  filter: GitLogTabFilter
  onText: (text: string) => void
  onFlags: (fields: Partial<GitLogTabFilter>) => void
  onGoTo: (rev: string) => Promise<boolean>
}) {
  const [text, setText] = useState(filter.text ?? '')
  const applied = useRef(filter.text ?? '')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Cancel typing before a text set elsewhere replaces it, so the old value cannot come back from its timer.
  useLayoutEffect(() => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    const now = filter.text ?? ''
    if (now === applied.current) return
    applied.current = now
    setText(now)
  }, [filter.text])
  const apply = (value: string) => {
    const next = value.trim()
    if (next === applied.current) return
    applied.current = next
    onText(next)
  }
  const latest = useRef(apply)
  latest.current = apply
  useEffect(() => {
    if (text.trim() === applied.current) return
    const id = setTimeout(() => {
      if (timer.current === id) timer.current = null
      latest.current(text)
    }, TYPING_MS)
    timer.current = id
    return () => {
      clearTimeout(id)
      if (timer.current === id) timer.current = null
    }
  }, [text])
  const hash = text.trim()
  return (
    <>
      <span className="glf-search">
        <Icon name="search" size={13} weight={1.7} />
        <input
          type="search"
          className="glf-search__input"
          placeholder={t('文本或哈希')}
          aria-label={t('文本或哈希')}
          value={text}
          onChange={(e) => {
            if (timer.current) {
              clearTimeout(timer.current)
              timer.current = null
            }
            setText(e.target.value)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              if (timer.current) {
                clearTimeout(timer.current)
                timer.current = null
              }
              apply(text)
            }
            else if (e.key === 'Escape' && text) {
              e.stopPropagation()
              if (timer.current) {
                clearTimeout(timer.current)
                timer.current = null
              }
              setText('')
              apply('')
            }
          }}
        />
        <button
          type="button"
          className="glf-flag"
          aria-label={t('正则表达式')}
          title={t('正则表达式')}
          aria-pressed={!!filter.regexp}
          onClick={() => onFlags({ regexp: !filter.regexp })}
        >
          .*
        </button>
        <button
          type="button"
          className="glf-flag"
          aria-label={t('区分大小写')}
          title={t('区分大小写')}
          aria-pressed={!!filter.matchCase}
          onClick={() => onFlags({ matchCase: !filter.matchCase })}
        >
          Aa
        </button>
      </span>
      {HASH.test(hash) ? (
        <button
          type="button"
          className="glf-goto"
          onClick={() => {
            if (timer.current) {
              clearTimeout(timer.current)
              timer.current = null
            }
            void onGoTo(hash).then((found) => {
              if (!found) {
                apply(hash)
                return
              }
              applied.current = ''
              setText('')
            })
          }}
        >
          <Icon name="git-commit" size={12} />
          {t('转到提交 {hash}', { hash })}
        </button>
      ) : null}
    </>
  )
}

/** One of IDEA's filter pop-ups: its label, the value set (with a way to clear it), and its panel. */
function FilterMenu({
  label,
  value,
  title,
  panel,
  width,
  onClear,
  children,
}: {
  label: string
  value: string | null
  title?: string
  panel: string
  width: number
  onClear: () => void
  children: (close: () => void) => ReactNode
}) {
  // Each opening starts the panel afresh, also when it reopens while still fading out.
  const [opened, setOpened] = useState(0)
  return (
    <span className="glf-item" data-on={value != null || undefined}>
      <Popover
        portal
        placement="bottom-start"
        width={width}
        aria-label={panel}
        onOpenChange={(open) => open && setOpened((n) => n + 1)}
        trigger={
          <button type="button" className="glf-btn" title={title}>
            {value == null ? label : t('{label}：{value}', { label, value })}
            <Icon name="chevron-down" size={9} weight={2} />
          </button>
        }
      >
        {(close) => <Fragment key={opened}>{children(close)}</Fragment>}
      </Popover>
      {value != null ? (
        <button
          type="button"
          className="glf-clear"
          aria-label={t('清除{label}筛选', { label })}
          onClick={onClear}
        >
          <Icon name="xmark" size={8} weight={2.4} />
        </button>
      ) : null}
    </span>
  )
}

function UserPanel({
  authors,
  me,
  value,
  onPick,
}: {
  authors: string[]
  /** The user's identities as an author filter; null when none is known. */
  me: string | null
  value: string | null
  onPick: (author: string) => void
}) {
  const [text, setText] = useState(value ?? '')
  const q = text.trim().toLowerCase()
  const shown = authors.filter((a) => !q || a.toLowerCase().includes(q))
  return (
    <div className="glf-panel">
      <Input
        type="text"
        aria-label={t('用户名或邮箱')}
        placeholder={t('用户名或邮箱')}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && text.trim()) onPick(text.trim())
        }}
      />
      {me && !q ? (
        <div className="glf-options">
          <button type="button" className="glf-option" aria-pressed={me === value} onClick={() => onPick(me)}>
            <Icon name="person" size={12} />
            {t('我')}
          </button>
        </div>
      ) : null}
      {shown.length ? (
        <div className="glf-options">
          {shown.map((a) => (
            <button
              key={a}
              type="button"
              className="glf-option"
              aria-pressed={a === value}
              onClick={() => onPick(a)}
            >
              <Icon name="person" size={12} />
              {a}
            </button>
          ))}
        </div>
      ) : (
        <div className="glf-hint">{t('按回车筛选这个用户')}</div>
      )}
    </div>
  )
}

function DatePanel({
  since,
  until,
  onPick,
}: {
  since: string | null
  until: string | null
  onPick: (since: string | null, until: string | null) => void
}) {
  const preset = !until && since ? PRESETS.find((p) => presetSince(p.days) === since) : undefined
  const [custom, setCustom] = useState(!!until || (!!since && !preset))
  const [from, setFrom] = useState(since ?? '')
  const [to, setTo] = useState(until ?? '')
  return (
    <div className="glf-panel">
      <div className="glf-options">
        <button
          type="button"
          className="glf-option"
          aria-pressed={!since && !until}
          onClick={() => onPick(null, null)}
        >
          {t('全部')}
        </button>
        {PRESETS.map((p) => (
          <button
            key={p.days}
            type="button"
            className="glf-option"
            aria-pressed={preset === p}
            onClick={() => onPick(presetSince(p.days), null)}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          className="glf-option"
          aria-expanded={custom}
          onClick={() => setCustom(!custom)}
        >
          {t('自定义…')}
        </button>
      </div>
      {custom ? (
        <div className="glf-dates">
          <label className="glf-date">
            <span>{t('起始日期')}</span>
            <input
              type="date"
              className="ui-input"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="glf-date">
            <span>{t('截止日期')}</span>
            <input
              type="date"
              className="ui-input"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <Button size="small" variant="primary" onClick={() => onPick(from || null, to || null)}>
            {t('应用')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function PathPanel({ value, onApply }: { value: string; onApply: (path: string | null) => void }) {
  const [text, setText] = useState(value)
  const apply = () =>
    onApply(
      text
        .trim()
        .replace(/^\.?\/+/, '')
        .replace(/\/+$/, '') || null,
    )
  return (
    <div className="glf-panel">
      <TextField
        label={t('路径')}
        placeholder={t('文件或文件夹，如 src/app.ts')}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') apply()
        }}
      />
      <div className="glf-panel__actions">
        {value ? (
          <Button size="small" variant="plain" onClick={() => onApply(null)}>
            {t('清除')}
          </Button>
        ) : null}
        <Button size="small" variant="primary" onClick={apply}>
          {t('应用')}
        </Button>
      </div>
    </div>
  )
}

const COLUMNS: { col: LogColumn; label: string }[] = [
  { col: 'author', label: t('作者') },
  { col: 'date', label: t('日期') },
  { col: 'hash', label: t('哈希') },
]

/** IDEA's View Options: the graph, 高亮 the user's commits, and the columns shown. */
function viewItems(f: GitLogTabFilter, view: LogView, me: boolean): MenuItem[] {
  return [
    { value: 'first-parent', label: t('仅第一父提交'), checked: !!f.firstParent },
    { value: 'no-merges', label: t('不显示合并提交'), checked: !!f.noMerges },
    { separator: true },
    { value: 'date', label: t('按日期排序'), checked: f.order !== 'topo' },
    { value: 'topo', label: t('按拓扑排序'), checked: f.order === 'topo' },
    { separator: true },
    { header: t('高亮') },
    { value: 'mine', label: t('我的提交'), checked: !!view.mine, disabled: !me },
    { separator: true },
    { header: t('列') },
    ...COLUMNS.map(({ col, label }) => ({
      value: `col:${col}`,
      label,
      checked: !view.hidden?.includes(col),
    })),
  ]
}

const MAX_TARGETS = 30

/** IDEA's Go to Hash/Branch/Tag: a typed hash or a matching branch or tag, ↑↓ to pick, Enter to go. */
function GoToPanel({
  refs,
  onGo,
  close,
}: {
  refs: GitRefsDto | null
  onGo: (rev: string) => Promise<boolean>
  close: () => void
}) {
  const [text, setText] = useState('')
  const [active, setActive] = useState(0)
  const id = useId()
  const q = text.trim()
  const names = [
    ...(refs?.branches.filter((b) => !b.name.endsWith('/HEAD')).map((b) => ({ name: b.name, tag: false })) ??
      []),
    ...(refs?.tags.map((tag) => ({ name: tag.name, tag: true })) ?? []),
  ]
  const lower = q.toLowerCase()
  const targets = [
    ...(HASH.test(q) ? [{ name: q, hash: true, tag: false }] : []),
    ...names
      .filter((n) => !lower || n.name.toLowerCase().includes(lower))
      .slice(0, MAX_TARGETS)
      .map((n) => ({ ...n, hash: false })),
  ]
  const at = Math.min(active, targets.length - 1)
  const go = (rev: string) =>
    void onGo(rev).then((found) => {
      if (found) close()
    })
  return (
    <div className="glf-panel">
      <Input
        type="text"
        role="combobox"
        aria-label={t('转到哈希、分支或标签')}
        placeholder={t('哈希、分支或标签')}
        aria-expanded={targets.length > 0}
        aria-controls={`${id}-list`}
        aria-activedescendant={targets.length ? `${id}-${at}` : undefined}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setActive(0)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            const n = targets.length
            if (n) setActive((at + (e.key === 'ArrowDown' ? 1 : n - 1)) % n)
          } else if (e.key === 'Enter') {
            e.preventDefault()
            const pick = targets[at]?.name ?? q
            if (pick) go(pick)
          }
        }}
      />
      {targets.length ? (
        <div className="glf-options" role="listbox" id={`${id}-list`} aria-label={t('转到哈希、分支或标签')}>
          {targets.map((x, i) => (
            <div
              key={`${x.hash}:${x.tag}:${x.name}`}
              id={`${id}-${i}`}
              role="option"
              tabIndex={-1}
              aria-selected={i === at}
              className="glf-option"
              data-active={i === at || undefined}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                // The focus stays in the field, as in a combo box.
                e.preventDefault()
                go(x.name)
              }}
            >
              <Icon name={x.hash ? 'git-commit' : x.tag ? 'tag' : 'git-branch'} size={12} />
              {x.hash ? t('提交 {hash}', { hash: x.name }) : x.name}
            </div>
          ))}
        </div>
      ) : q ? (
        <div className="glf-hint">{t('没有匹配的分支或标签')}</div>
      ) : null}
    </div>
  )
}

/**
 * IDEA's log filter bar: the branches pane toggle, the repo, text (regexp, match case, or a hash to go to), branch,
 * user, date and path filters, 清除筛选, go to a hash, branch or tag (`finding`, ⌘F in the table), refresh and the
 * view options.
 */
export function LogFilters({
  tab,
  target,
  refs,
  refsError,
  authors,
  repos,
  pane,
  onPane,
  control,
  me,
  view,
  onView,
  finding,
  onFinding,
}: {
  tab: LogTab
  target: GitTarget
  refs: GitRefsDto | null
  refsError: string | null
  /** Authors seen in the log so far, most commits first. */
  authors: () => string[]
  repos: PopUpOption<string>[]
  pane: boolean
  onPane: () => void
  control: LogControl
  /** The user's identities as an author filter (see UserPanel). */
  me: string | null
  view: LogView
  onView: (view: LogView) => void
  finding: boolean
  onFinding: (open: boolean) => void
}) {
  const f = tab.filter ?? {}
  const author = f.author == null ? null : f.author === me ? t('我') : f.author.replace(/\n/g, ', ')
  const date =
    f.since && f.until
      ? `${f.since} ~ ${f.until}`
      : f.since
        ? t('{date} 之后', { date: f.since })
        : f.until
          ? t('{date} 之前', { date: f.until })
          : null
  return (
    <div className="glf" role="toolbar" aria-label={t('提交历史筛选')}>
      <Tool icon="sidebar" label={t('分支面板')} pressed={pane} onClick={onPane} />
      {repos.length ? (
        <PopUpButton
          size="small"
          aria-label={t('仓库')}
          value={target.repo ?? ''}
          onChange={(v) => control.setRepo(v || null)}
          options={repos}
        />
      ) : null}
      <TextFilter
        filter={f}
        onText={(text) => control.setFilter({ text: text || undefined })}
        onFlags={control.setFilter}
        onGoTo={control.goTo}
      />
      <FilterMenu
        label={t('分支')}
        value={tab.ref ? shortRev(tab.ref) : null}
        title={tab.ref ?? undefined}
        panel={t('按分支筛选')}
        width={300}
        onClear={() => control.setRef(null, true)}
      >
        {(close) => (
          <BranchesPane
            picker
            target={target}
            refs={refs}
            error={refsError}
            selected={{ all: !!f.all, ref: tab.ref }}
            onFilter={(ref, all) => {
              control.setRef(ref, all)
              close()
            }}
          />
        )}
      </FilterMenu>
      <FilterMenu
        label={t('用户')}
        value={author}
        panel={t('按用户筛选')}
        width={260}
        onClear={() => control.setFilter({ author: undefined })}
      >
        {(close) => (
          <UserPanel
            authors={authors()}
            me={me}
            value={f.author ?? null}
            onPick={(author) => {
              control.setFilter({ author })
              close()
            }}
          />
        )}
      </FilterMenu>
      <FilterMenu
        label={t('日期')}
        value={date}
        panel={t('按日期筛选')}
        width={260}
        onClear={() => control.setFilter({ since: undefined, until: undefined })}
      >
        {(close) => (
          <DatePanel
            since={f.since ?? null}
            until={f.until ?? null}
            onPick={(since, until) => {
              control.setFilter({ since: since ?? undefined, until: until ?? undefined })
              close()
            }}
          />
        )}
      </FilterMenu>
      <FilterMenu
        label={t('路径')}
        value={tab.path ? baseName(tab.path) : null}
        title={tab.path ?? undefined}
        panel={t('按路径筛选')}
        width={300}
        onClear={() => control.setPath(null)}
      >
        {(close) => (
          <PathPanel
            value={tab.path ?? ''}
            onApply={(path) => {
              control.setPath(path)
              close()
            }}
          />
        )}
      </FilterMenu>
      {narrowed(tab) ? (
        <button type="button" className="glf-reset" onClick={control.clear}>
          <Icon name="xmark" size={9} weight={2.4} />
          {t('清除筛选')}
        </button>
      ) : null}
      <span className="spacer" />
      <Popover
        portal
        placement="bottom-end"
        width={300}
        aria-label={t('转到哈希、分支或标签')}
        open={finding}
        onOpenChange={onFinding}
        trigger={
          <button
            type="button"
            className="glog-tool"
            aria-label={t('转到哈希、分支或标签')}
            title={t('转到哈希、分支或标签')}
          >
            <Icon name="git-commit" size={14} />
          </button>
        }
      >
        {(close) => <GoToPanel refs={refs} onGo={control.goTo} close={close} />}
      </Popover>
      <Tool icon="arrow-clockwise" label={t('刷新')} onClick={control.refresh} />
      <MenuButton
        className="glog-tool"
        aria-label={t('视图选项')}
        title={t('视图选项')}
        align="end"
        items={viewItems(f, view, !!me)}
        onSelect={(v) => {
          if (v === 'mine') return onView({ ...view, mine: !view.mine })
          if (v.startsWith('col:')) {
            const col = v.slice(4) as LogColumn
            const hidden = view.hidden ?? []
            return onView({
              ...view,
              hidden: hidden.includes(col) ? hidden.filter((c) => c !== col) : [...hidden, col],
            })
          }
          control.setFilter(
            v === 'first-parent'
              ? { firstParent: !f.firstParent }
              : v === 'no-merges'
                ? { noMerges: !f.noMerges }
                : { order: v === 'topo' ? 'topo' : undefined },
          )
        }}
      >
        <Icon name="slider-horizontal" size={14} />
      </MenuButton>
    </div>
  )
}
