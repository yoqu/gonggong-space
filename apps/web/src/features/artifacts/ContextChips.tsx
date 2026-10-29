import { t } from '../../i18n'
import { Icon } from '../../ui'
import { type CanvasContext, removeContextItem } from './context'
import './chips.css'

/** The canvas selection above the group composer: `产物 · 屏` or `屏 › 元素`, each removable. */
export function ContextChips({ context }: { context: CanvasContext }) {
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
    </div>
  )
}
