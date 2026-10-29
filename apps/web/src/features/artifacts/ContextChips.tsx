import type { BotDto } from '@gonggong/protocol'
import { t } from '../../i18n'
import { Icon, MenuButton } from '../../ui'
import { offlineHint } from './actions'
import { type CanvasContext, removeContextItem } from './context'
import './chips.css'

/**
 * The canvas selection above the group composer: `产物 · 屏` or `屏 › 元素`, each removable. `bot`: who a message
 * without an @ goes to (the artifact's bot); 换 Bot puts an @ of one of the `others` in front of the draft.
 */
export function ContextChips({
  context,
  bot,
  others,
  onSwitch,
}: {
  context: CanvasContext
  bot: BotDto | null
  others: BotDto[]
  onSwitch: (name: string) => void
}) {
  const offline = offlineHint(bot)
  return (
    <div className="art-chips" data-testid="art-context-chips">
      {context.items.map((i) => {
        const label = i.element
          ? `${i.screenTitle} › ${i.element.label}`
          : `${context.title} · ${i.screenTitle}`
        return (
          <span key={i.key} className="art-chip" title={label}>
            <Icon name={i.element ? 'cursor' : 'smartphone'} size={13} className="art-chip__icon" />
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
