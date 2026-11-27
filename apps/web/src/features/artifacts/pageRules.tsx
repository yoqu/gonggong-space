import { useEffect, useRef, useState } from 'react'
import { t } from '../../i18n'
import { cx } from '../../lib/cx'
import { Button, Checkbox, Input, Textarea } from '../../ui'
import { type RulesAdding, RuleText, ruleLabel } from './RulesPanel'
import type { ScreenRules } from './rules'

/** What the canvas hands a 页面文档 of one page's rules (canvasRules `pageRules`). */
export interface PageRulesProps {
  page: ScreenRules | null
  /** The rule picked (on the page's numbered marks or here), by index. */
  selected: number | null
  select: (i: number) => void
  adding: (RulesAdding & { screenId: string }) | null
  add: () => void
  create: (label: string, text: string, pending: boolean) => Promise<boolean>
  cancelAdd: () => void
  saveMd: (md: string) => Promise<boolean>
  complete: () => void
  /** Why AI 补全 cannot go now; null when it can. */
  ai: string | null
  /** The rule's element is no longer on the page (its anchor reported gone). */
  gone: (i: number) => boolean
  /** `S1`… in a rule: the shared rules at that section. */
  openShared: (id: string) => void
}

/**
 * The page's rules in its 页面文档 (the 规则 panel is gone, 蒋庆 2026-11-27): numbered as the marks on the page, so
 * each block's rule is found by its number; a click outlines its block. Their Markdown is editable as a whole.
 */
export function PageRulesSection({ rules, canEdit }: { rules: PageRulesProps; canEdit: boolean }) {
  const list = rules.page?.rules ?? []
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(rules.page?.md ?? '')
  const items = useRef<(HTMLLIElement | null)[]>([])
  useEffect(() => {
    if (rules.selected !== null) items.current[rules.selected]?.scrollIntoView?.({ block: 'nearest' })
  }, [rules.selected])
  const done = async () => {
    setEditing(false)
    if (draft !== (rules.page?.md ?? '')) await rules.saveMd(draft)
  }
  return (
    <section className="art-pagedoc__rules" aria-label={t('页面规则')}>
      <header>
        <h4>{t('页面规则（{n}）', { n: list.length })}</h4>
        {canEdit && !editing ? (
          <span className="art-pagedoc__acts">
            <Button size="small" variant="plain" icon="plus" onClick={rules.add}>
              {t('添加规则')}
            </Button>
            <Button
              size="small"
              variant="plain"
              icon="sparkle"
              disabled={!!rules.ai}
              title={rules.ai ?? undefined}
              onClick={rules.complete}
            >
              {t('AI 补全')}
            </Button>
            {list.length ? (
              <Button
                size="small"
                variant="plain"
                icon="pencil"
                onClick={() => {
                  setDraft(rules.page?.md ?? '')
                  setEditing(true)
                }}
              >
                {t('编辑')}
              </Button>
            ) : null}
          </span>
        ) : null}
      </header>
      {editing ? (
        <Textarea
          aria-label={t('页面规则')}
          className="art-pagedoc__input"
          value={draft}
          rows={10}
          // biome-ignore lint/a11y/noAutofocus: opened on purpose to edit the rules
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void done()}
        />
      ) : list.length ? (
        <ol className="art-pagedoc__rule-list">
          {list.map((r, i) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: a rule is its place in the file, as its number is
              key={i}
              ref={(el) => {
                items.current[i] = el
              }}
              className={cx('art-pagedoc__rule', rules.selected === i && 'art-pagedoc__rule--on')}
              data-testid={`art-pagedoc-rule-${i + 1}`}
            >
              <button
                type="button"
                className={cx('art-rule-mark', 'art-pagedoc__num', r.pending && 'art-rule-mark--pending')}
                aria-label={t('第 {n} 条规则', { n: i + 1 })}
                onClick={() => rules.select(i)}
              >
                {i + 1}
              </button>
              <div>
                <button type="button" className="art-pagedoc__rule-label" onClick={() => rules.select(i)}>
                  {ruleLabel(r)}
                </button>
                {r.pending ? <em className="art-pagedoc__pending">{t('待确认')}</em> : null}
                {rules.gone(i) ? <em className="art-pagedoc__gone">{t('元素已不存在')}</em> : null}
                <RuleText text={r.text} onShared={rules.openShared} />
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="art-pagedoc__empty">{t('还没有规则。点「添加规则」后在页面上点选模块')}</p>
      )}
      {rules.adding ? <AddRule rules={rules} n={list.length + 1} /> : null}
    </section>
  )
}

function AddRule({ rules, n }: { rules: PageRulesProps; n: number }) {
  const adding = rules.adding
  const [label, setLabel] = useState(adding?.target?.label ?? '')
  const [text, setText] = useState('')
  const [pending, setPending] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => setLabel(adding?.target?.label ?? ''), [adding?.target?.label])
  if (!adding) return null
  return (
    <div className="art-pagedoc__add" data-testid="art-pagedoc-add-rule">
      {adding.picked ? (
        <>
          <div className="art-pagedoc__add-head">
            <span className="art-rule-mark art-rule-mark--draft">{n}</span>
            {adding.target ? (
              <Input
                size="sm"
                aria-label={t('规则挂在')}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            ) : (
              <strong>{adding.scriptMade ? t('脚本生成的元素只能挂整页') : t('整页')}</strong>
            )}
          </div>
          <Textarea
            aria-label={t('规则说明')}
            value={text}
            rows={3}
            // biome-ignore lint/a11y/noAutofocus: the rule is being written
            autoFocus
            placeholder={t('例如：库存为 0 时置灰并提示已售罄')}
            onChange={(e) => setText(e.target.value)}
          />
          <Checkbox label={t('待确认')} checked={pending} onChange={setPending} />
          <span className="art-pagedoc__acts">
            <Button size="small" onClick={rules.cancelAdd}>
              {t('取消')}
            </Button>
            <Button
              size="small"
              variant="primary"
              loading={busy}
              disabled={!text.trim()}
              onClick={async () => {
                setBusy(true)
                await rules.create(label, text.trim(), pending)
                setBusy(false)
              }}
            >
              {t('添加')}
            </Button>
          </span>
        </>
      ) : (
        <p className="art-pagedoc__empty">
          {t('在页面上点选这条规则挂的模块，或在上方提示条里选「挂到整页」')}
          <Button size="small" variant="plain" onClick={rules.cancelAdd}>
            {t('取消')}
          </Button>
        </p>
      )}
    </div>
  )
}
