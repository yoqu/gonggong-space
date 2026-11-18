import type { PageRule } from '@gonggong/protocol'
import { type KeyboardEvent, useEffect, useState } from 'react'
import { t } from '../../i18n'
import { cx } from '../../lib/cx'
import {
  Button,
  Checkbox,
  CloseButton,
  EmptyState,
  IconButton,
  Input,
  SegmentedControl,
  Select,
  Tag,
  Textarea,
} from '../../ui'
import { isWholePage, type RuleTarget, ruleStats, type ScreenRules, splitRefs, WHOLE_PAGE } from './rules'

/** How a rule names what it hangs on: its element, or 整页. */
export const ruleLabel = (r: PageRule) =>
  isWholePage(r) && (!r.label || r.label === WHOLE_PAGE) ? t('整页') : (r.label ?? r.anchor ?? '')

/** 规则 N · 待确认 M beside a screen's title (on the canvas, in the prototype preview's bar); nothing without rules. */
export function RulesBadge({
  rules,
  testId,
  onClick,
}: {
  rules: readonly PageRule[] | undefined
  testId?: string
  onClick: () => void
}) {
  if (!rules?.length) return null
  const { total, pending } = ruleStats(rules)
  return (
    <button
      type="button"
      className="art-title__rules"
      data-testid={testId}
      aria-label={
        pending ? t('规则 {n} · 待确认 {m}', { n: total, m: pending }) : t('规则 {n}', { n: total })
      }
      onClick={onClick}
    >
      {t('规则 {n}', { n: total })}
      {pending ? (
        <>
          <span aria-hidden="true">·</span>
          <em>{t('待确认 {n}', { n: pending })}</em>
        </>
      ) : null}
    </button>
  )
}

const saveKey = (e: KeyboardEvent<HTMLElement>, save: () => void) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
    e.preventDefault()
    save()
  }
}

/** A rule's sentence with its `S<n>` references as links to the shared rules. */
function RuleText({ text, onShared }: { text: string; onShared: (id: string) => void }) {
  return (
    <p className="art-rule__text">
      {splitRefs(text).map((part, i) =>
        i % 2 ? (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one fixed text
            key={i}
            type="button"
            className="art-rule__ref"
            onClick={(e) => {
              e.stopPropagation()
              onShared(part)
            }}
          >
            {part}
          </button>
        ) : (
          part
        ),
      )}
    </p>
  )
}

function RuleItem({
  n,
  rule,
  on,
  gone,
  canEdit,
  onPick,
  onSave,
  onDelete,
  onShared,
}: {
  n: number
  rule: PageRule
  on: boolean
  /** Its anchor is no longer in the screen. */
  gone: boolean
  canEdit: boolean
  onPick: () => void
  onSave: (next: PageRule) => Promise<boolean>
  onDelete: () => void
  onShared: (id: string) => void
}) {
  const [draft, setDraft] = useState<{ text: string; pending: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (!draft?.text.trim()) return
    setBusy(true)
    const ok = await onSave({ ...rule, text: draft.text.trim(), pending: draft.pending })
    setBusy(false)
    if (ok) setDraft(null)
  }
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the canvas's marks pick rules from the keyboard too
    <li
      className={cx('art-rule', on && 'art-rule--on')}
      data-testid={`art-rule-${n}`}
      onClick={draft ? undefined : onPick}
    >
      <span className={cx('art-rule__no', rule.pending && 'art-rule__no--pending')}>{n}</span>
      <div className="art-rule__main">
        <div className="art-rule__anchor">
          <span>{ruleLabel(rule)}</span>
          {rule.pending ? <Tag tone="orange">{t('待确认')}</Tag> : null}
          {gone ? <Tag tone="red">{t('元素已不存在')}</Tag> : null}
        </div>
        {draft ? (
          <div className="art-rule__edit">
            <Textarea
              aria-label={t('规则')}
              value={draft.text}
              rows={3}
              maxLength={2000}
              autoFocus
              onChange={(e) => setDraft({ ...draft, text: e.target.value })}
              onKeyDown={(e) => saveKey(e, () => void save())}
            />
            <Checkbox
              label={t('标记为待确认')}
              checked={draft.pending}
              onChange={(pending) => setDraft({ ...draft, pending })}
            />
            <div className="art-rule__actions">
              <Button size="small" variant="plain" onClick={() => setDraft(null)}>
                {t('取消')}
              </Button>
              <Button
                size="small"
                variant="primary"
                disabled={busy || !draft.text.trim()}
                onClick={() => void save()}
              >
                {t('保存')}
              </Button>
            </div>
          </div>
        ) : (
          <RuleText text={rule.text} onShared={onShared} />
        )}
      </div>
      {canEdit && !draft ? (
        <span className="art-rule__ops">
          <IconButton
            size="small"
            title={t('编辑')}
            onClick={(e) => {
              e.stopPropagation()
              setDraft({ text: rule.text, pending: rule.pending })
            }}
          >
            {'pencil' as const}
          </IconButton>
          <IconButton
            size="small"
            title={t('删除')}
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
          >
            {'trash' as const}
          </IconButton>
        </span>
      ) : null}
    </li>
  )
}

/** A new rule being written: what it hangs on (renamable; a click in the page picks again), its sentence. */
function NewRule({
  n,
  target,
  scriptMade,
  onSave,
  onCancel,
}: {
  n: number
  target: RuleTarget | null
  scriptMade: boolean
  onSave: (label: string, text: string, pending: boolean) => Promise<boolean>
  onCancel: () => void
}) {
  const [label, setLabel] = useState(target?.label ?? '')
  const [text, setText] = useState('')
  const [pending, setPending] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => setLabel(target?.label ?? ''), [target])
  const save = async () => {
    if (!text.trim() || busy) return
    setBusy(true)
    await onSave(label, text, pending)
    setBusy(false)
  }
  const title = t('新规则 {n}', { n })
  return (
    <fieldset className="art-rule-new" aria-label={title}>
      <div className="art-rule-new__head">
        <strong>{title}</strong>
        <span>·</span>
        <span>{t('挂在')}</span>
        {target ? (
          <Input
            className="art-rule-new__label"
            aria-label={t('挂载元素名')}
            value={label}
            maxLength={40}
            onChange={(e) => setLabel(e.target.value)}
          />
        ) : (
          <strong>{t('整页')}</strong>
        )}
        <span className="art-rule-new__hint">{t('（点页面重选）')}</span>
      </div>
      {scriptMade ? <p className="art-rule-new__note">{t('脚本生成的元素只能挂整页')}</p> : null}
      <Textarea
        aria-label={t('规则')}
        placeholder={t('一句话写清这条规则')}
        value={text}
        rows={3}
        maxLength={2000}
        autoFocus
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => saveKey(e, () => void save())}
      />
      <Checkbox label={t('标记为待确认')} checked={pending} onChange={setPending} />
      <div className="art-rule__actions">
        <Button size="small" variant="plain" onClick={onCancel}>
          {t('取消')}
        </Button>
        <Button size="small" variant="primary" disabled={busy || !text.trim()} onClick={() => void save()}>
          {t('保存 ⌘↵')}
        </Button>
      </div>
    </fieldset>
  )
}

export interface RulesAdding {
  /** Picked yet (a click in the page or 挂到整页); before that only the banner shows. */
  picked: boolean
  target: RuleTarget | null
  scriptMade: boolean
}

/** 页面规则 (design/app-screens-fzvz rules-view): one screen's rules as a list or its Markdown, like prototype notes. */
export function RulesPanel({
  screens,
  screenId,
  onScreen,
  data,
  gone,
  canEdit,
  selected,
  onSelect,
  onSaveRules,
  onSaveSource,
  adding,
  onAdd,
  onCreate,
  onCancelAdd,
  onShared,
  ai,
  onComplete,
  onClose,
}: {
  screens: { id: string; title: string }[]
  screenId: string
  onScreen: (id: string) => void
  data: ScreenRules | undefined
  /** A rule whose anchor the screen reported without it. */
  gone: (r: PageRule) => boolean
  canEdit: boolean
  selected: number | null
  onSelect: (i: number) => void
  onSaveRules: (rules: PageRule[]) => Promise<boolean>
  onSaveSource: (md: string) => Promise<boolean>
  adding: RulesAdding | null
  onAdd: () => void
  onCreate: (label: string, text: string, pending: boolean) => Promise<boolean>
  onCancelAdd: () => void
  onShared: (id: string) => void
  /** Why AI 补全 is off or waits (no bot, bot offline); null when it goes now. */
  ai: { disabled: boolean; hint: string | null }
  onComplete: () => void
  onClose: () => void
}) {
  const [view, setView] = useState<'list' | 'md'>('list')
  const [source, setSource] = useState<string | null>(null)
  const rules = data?.rules ?? []
  const stats = ruleStats(rules)
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new screen or file drops the unsaved source
  useEffect(() => setSource(null), [screenId, data])
  const replace = (i: number, next: PageRule | null) =>
    onSaveRules(rules.flatMap((r, k) => (k === i ? (next ? [next] : []) : [r])))
  return (
    <aside className="art-panel art-rules" aria-label={t('页面规则')}>
      <header className="art-panel__head">
        <h3>{t('页面规则')}</h3>
        <CloseButton onClick={onClose} />
      </header>
      <div className="art-rules__bar">
        <Select
          label={t('屏幕')}
          value={screenId}
          onChange={onScreen}
          options={screens.map((s) => ({ value: s.id, label: s.title }))}
        />
        <span className="art-rules__count">
          {stats.pending
            ? t('{n} 条 · 待确认 {m}', { n: stats.total, m: stats.pending })
            : t('{n} 条', { n: stats.total })}
        </span>
        <SegmentedControl<'list' | 'md'>
          size="small"
          aria-label={t('视图')}
          items={[
            { value: 'list', label: t('列表') },
            { value: 'md', label: 'Markdown' },
          ]}
          value={view}
          onChange={setView}
        />
      </div>
      <div className="art-panel__body art-rules__body">
        {view === 'md' ? (
          canEdit ? (
            <>
              <Textarea
                className="art-rules__source"
                aria-label="Markdown"
                spellCheck={false}
                placeholder={t('还没有规则，保存后创建')}
                value={source ?? data?.md ?? ''}
                onChange={(e) => setSource(e.target.value)}
              />
              <Button
                size="small"
                disabled={source === null || source === (data?.md ?? '')}
                onClick={() => void onSaveSource(source ?? '').then((ok) => ok && setSource(null))}
              >
                {t('保存')}
              </Button>
            </>
          ) : (
            <pre className="art-rules__source">{data?.md ?? ''}</pre>
          )
        ) : rules.length || adding?.picked ? (
          <ol className="art-rules__list">
            {rules.map((r, i) => (
              <RuleItem
                // biome-ignore lint/suspicious/noArrayIndexKey: rules are numbered by their place
                key={`${screenId}:${i}`}
                n={i + 1}
                rule={r}
                on={selected === i}
                gone={gone(r)}
                canEdit={canEdit}
                onPick={() => onSelect(i)}
                onSave={(next) => replace(i, next)}
                onDelete={() => void replace(i, null)}
                onShared={onShared}
              />
            ))}
          </ol>
        ) : (
          <EmptyState compact icon="checklist" title={t('还没有规则')} />
        )}
        {adding?.picked && view === 'list' ? (
          <NewRule
            n={rules.length + 1}
            target={adding.target}
            scriptMade={adding.scriptMade}
            onSave={onCreate}
            onCancel={onCancelAdd}
          />
        ) : null}
      </div>
      {canEdit ? (
        <footer className="art-rules__foot">
          {adding ? (
            <p className="art-rules__tip">{t('也可以在页面元素上点「编辑」→「添加规则」')}</p>
          ) : (
            <>
              <Button size="small" icon="plus" onClick={onAdd}>
                {t('添加规则')}
              </Button>
              <Button
                size="small"
                variant="primary"
                icon="sparkle"
                disabled={ai.disabled}
                title={ai.hint ?? undefined}
                onClick={onComplete}
              >
                {t('AI 补全')}
              </Button>
            </>
          )}
        </footer>
      ) : null}
    </aside>
  )
}
