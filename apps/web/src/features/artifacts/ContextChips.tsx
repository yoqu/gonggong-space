import type { BotDto } from '@gonggong/protocol'
import { t } from '../../i18n'
import { Icon, MenuButton } from '../../ui'
import { offlineHint } from './actions'
import { type CanvasContext, removeContextItem, requestDesignPanel } from './context'
import { selectedScreenIds } from './slash'
import './chips.css'

export const VARIATION_COUNTS = [1, 2, 3, 4, 5]
export const DEFAULT_VARIATIONS = 3

/**
 * The canvas selection above the group composer: `产物 · 屏` or `屏 › 元素`, each removable. `bot`: who a message
 * without an @ goes to (the artifact's bot); 换 Bot puts an @ of one of the `others` in front of the draft.
 */
export function ContextChips({
  context,
  bot,
  others,
  onSwitch,
  variations,
  onVariations,
}: {
  context: CanvasContext
  bot: BotDto | null
  others: BotDto[]
  onSwitch: (name: string) => void
  /** Stitch's Variations ×3: the next message asks for this many variations of the selected screens; null = off. */
  variations: number | null
  onVariations: (count: number | null) => void
}) {
  const offline = offlineHint(bot)
  const noScreens = !selectedScreenIds(context).length
  const count = variations ?? DEFAULT_VARIATIONS
  return (
    <div className="art-chips" data-testid="art-context-chips">
      {context.items.map((i) => {
        const label = i.ref
          ? t('参考 · {name}', { name: i.ref.title })
          : i.element
            ? `${i.screenTitle} › ${i.element.label}`
            : `${context.title} · ${i.screenTitle}`
        const icon = i.ref
          ? i.ref.kind === 'image'
            ? 'image'
            : 'doc-text'
          : i.element
            ? 'cursor'
            : 'smartphone'
        return (
          <span key={i.key} className="art-chip" title={label}>
            <Icon name={icon} size={13} className="art-chip__icon" />
            <span className="art-chip__text">{label}</span>
            <button
              type="button"
              className="art-chip__x"
              aria-label={t('移除 {name}', { name: label })}
              onClick={() => removeContextItem(i.key)}
            >
              <Icon name="xmark" size={10} weight={2} />
            </button>
          </span>
        )
      })}
      <span className={variations ? 'art-var art-var--on' : 'art-var'} data-testid="art-variations">
        <button
          type="button"
          className="art-var__toggle"
          aria-pressed={!!variations}
          disabled={noScreens}
          title={noScreens ? t('先在画布上选屏') : t('开启后，发送的描述会生成所选屏幕的变体')}
          onClick={() => onVariations(variations ? null : count)}
        >
          <Icon name="sparkle" size={12} />
          {t('变体')}
        </button>
        <MenuButton
          className="art-var__count"
          aria-label={t('变体数量')}
          disabled={noScreens}
          items={VARIATION_COUNTS.map((n) => ({ label: `×${n}`, value: String(n), checked: n === count }))}
          onSelect={(v) => onVariations(Number(v))}
          placement="above"
        >
          {`×${count}`}
        </MenuButton>
      </span>
      <button
        type="button"
        className="art-chips__ds"
        title={t('打开画布的设计系统')}
        onClick={() => requestDesignPanel(context.artifactId)}
      >
        <Icon name="palette" size={12} />
        {t('设计系统')}
      </button>
      {bot ? (
        <span
          className={offline ? 'art-chips__to art-chips__to--offline' : 'art-chips__to'}
          data-testid="art-context-to"
        >
          {offline ? <i className="art-chips__dot" aria-hidden="true" /> : <Icon name="at" size={12} />}
          {offline ?? t('发给 @{name}', { name: bot.name })}
          {others.length ? (
            <MenuButton
              className="art-chips__switch"
              items={others.map((b) => ({ label: `@${b.name}`, value: b.name }))}
              onSelect={onSwitch}
              placement="above"
            >
              {t('换 Bot')}
            </MenuButton>
          ) : null}
        </span>
      ) : null}
    </div>
  )
}
