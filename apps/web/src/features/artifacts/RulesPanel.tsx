import type { PageRule } from '@gonggong/protocol'
import { t } from '../../i18n'
import { isWholePage, type RuleTarget, ruleStats, splitRefs, WHOLE_PAGE } from './rules'

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

/** A rule's sentence with its `S<n>` references as links to the shared rules. */
export function RuleText({ text, onShared }: { text: string; onShared: (id: string) => void }) {
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

export interface RulesAdding {
  /** Picked yet (a click in the page or 挂到整页); before that only the banner shows. */
  picked: boolean
  target: RuleTarget | null
  scriptMade: boolean
}
