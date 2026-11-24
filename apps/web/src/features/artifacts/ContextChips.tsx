import type { BotDto } from '@gonggong/protocol'
import { t } from '../../i18n'
import { Icon, MenuButton } from '../../ui'
import { offlineHint } from './actions'
import { type CanvasContext, isScreenItem, removeContextItem, requestDesignPanel } from './context'
import { selectedScreenIds } from './slash'
import './chips.css'

const VARIATION_COUNTS = [1, 2, 3, 4, 5]
const DEFAULT_VARIATIONS = 3
/** More whole screens than this fold into one 「N 个屏幕」 chip: a marquee of many screens keeps the input in view. */
const SCREEN_CHIPS_MAX = 2

/** An @Bot message without a canvas selection names the artifact open in front: a hint the member may remove. */
export function ForegroundChip({ title, onRemove }: { title: string; onRemove: () => void }) {
  return (
    <div className="art-chips" data-testid="art-foreground">
      <span className="art-chip art-chip--editing" title={t('Bot 会知道你正在看「{name}」', { name: title })}>
        <Icon name="grid" size={13} className="art-chip__icon" />
        <span className="art-chip__text">{t('正在看 · {name}', { name: title })}</span>
        <button
          type="button"
          className="art-chip__x"
          aria-label={t('不带上 {name}', { name: title })}
          onClick={onRemove}
        >
          <Icon name="xmark" size={10} weight={2} />
        </button>
      </span>
    </div>
  )
}

/**
 * The canvas selection above the group composer: `产物 · 屏` or `屏 › 元素`, each removable. `bot`: who a message
 * without an @ goes to (the artifact's bot); 换 Bot puts an @ of one of the `others` in front of the draft.
 */
export function ContextChips({
  context,
  bot,
  others,
  onSwitch,
  onDismissBot,
  bypassedBot,
  onRestoreBot,
  variations,
  onVariations,
  onEnd,
}: {
  context: CanvasContext
  bot: BotDto | null
  others: BotDto[]
  onSwitch: (name: string) => void
  /** Dismisses implicit canvas Bot targeting (omitted in canvasChat mode). */
  onDismissBot?: () => void
  /** Original canvas Bot that was dismissed for this message; offers a one-click restore bar. */
  bypassedBot?: BotDto | null
  onRestoreBot?: () => void
  /** Stitch's Variations ×3: the next message asks for this many variations of the selected screens; null = off. */
  variations: number | null
  onVariations: (count: number | null) => void
  /** 正在编辑 (no selection, the whole artifact): its chip ends it. */
  onEnd?: () => void
}) {
  const offline = offlineHint(bot)
  const noScreens = !selectedScreenIds(context).length
  const count = variations ?? DEFAULT_VARIATIONS
  const screens = context.items.filter(isScreenItem)
  const folded = screens.length > SCREEN_CHIPS_MAX
  return (
    <div className="art-chips-block">
      <div className="art-chips" data-testid="art-context-chips">
        {bot ? (
          <span
            className={
              offline
                ? 'art-chips__to art-chips__to--offline'
                : !others.length && !onDismissBot
                  ? 'art-chips__to art-chips__to--plain'
                  : 'art-chips__to'
            }
            title={offline ?? t('将针对当前画布发送给 @{name}', { name: bot.name })}
            data-testid="art-context-to"
          >
            {offline ? <i className="art-chips__dot" aria-hidden="true" /> : <Icon name="at" size={12} />}
            <span className="art-chips__to-label">{offline ?? t('发给 @{name}', { name: bot.name })}</span>
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
            {onDismissBot ? (
              <button
                type="button"
                className="art-chip__x art-chips__dismiss"
                aria-label={t('改为仅发给群成员，不触发 Bot')}
                title={t('改为仅发给群成员，不触发 Bot')}
                onClick={onDismissBot}
              >
                <Icon name="xmark" size={10} weight={2} />
              </button>
            ) : null}
          </span>
        ) : null}
        {onEnd ? (
          <span className="art-chip art-chip--editing" title={context.title} data-testid="art-editing">
            <Icon name="grid" size={13} className="art-chip__icon" />
            <span className="art-chip__text">{t('正在编辑 · {name}', { name: context.title })}</span>
            <button
              type="button"
              className="art-chip__x"
              aria-label={t('结束编辑 {name}', { name: context.title })}
              onClick={onEnd}
            >
              <Icon name="xmark" size={10} weight={2} />
            </button>
          </span>
        ) : null}
        {folded ? (
          <span
            className="art-chip"
            title={`${context.title} · ${screens.map((i) => i.screenTitle).join('、')}`}
            data-testid="art-context-screens"
          >
            <Icon name="smartphone" size={13} className="art-chip__icon" />
            <span className="art-chip__text">{t('{n} 个屏幕', { n: screens.length })}</span>
            <button
              type="button"
              className="art-chip__x"
              aria-label={t('移除 {name}', { name: t('{n} 个屏幕', { n: screens.length }) })}
              onClick={() => {
                for (const i of screens) removeContextItem(i.key)
              }}
            >
              <Icon name="xmark" size={10} weight={2} />
            </button>
          </span>
        ) : null}
        {(folded ? context.items.filter((i) => !isScreenItem(i)) : context.items).map((i) => {
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
        {onEnd ? null : (
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
              items={VARIATION_COUNTS.map((n) => ({
                label: `×${n}`,
                value: String(n),
                checked: n === count,
              }))}
              onSelect={(v) => onVariations(Number(v))}
              placement="above"
            >
              {`×${count}`}
            </MenuButton>
          </span>
        )}
        <button
          type="button"
          className="art-chips__ds"
          title={t('打开画布的设计系统')}
          onClick={() => requestDesignPanel(context.artifactId)}
        >
          <Icon name="palette" size={12} />
          {t('设计系统')}
        </button>
      </div>
      {bypassedBot && onRestoreBot ? (
        <div className="art-chips__bypass" data-testid="art-context-bypass">
          <span>{t('本次仅发给群成员，不触发 Bot')}</span>
          <button type="button" className="art-chips__restore" onClick={onRestoreBot}>
            {t('恢复发给 @{name}', { name: bypassedBot.name })}
          </button>
        </div>
      ) : null}
    </div>
  )
}
