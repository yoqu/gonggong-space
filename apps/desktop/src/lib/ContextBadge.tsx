import type { ContextUsage } from '@gonggong/protocol'
import { ContextRing, ContextSummary, contextGauge, contextTitle } from '@web/features/chat/ContextRing'
import { Popover } from '@web/ui'
import { t } from '../i18n'

/**
 * A bot's context occupancy in a group, read only: compacting or starting over is a group message, sent on the Web.
 * `inert` for inside another button (a run row): no popover, the tooltip only.
 */
export function ContextBadge({
  bot,
  context,
  inert,
}: {
  bot: string
  context: ContextUsage
  inert?: boolean
}) {
  const { level, detail } = contextGauge(context)
  const props = {
    className: 'ctx-meter',
    'data-level': level,
    'aria-label': t('{bot} 上下文 {detail}', { bot, detail }),
    title: contextTitle(context),
  }
  if (inert)
    return (
      <span role="img" {...props}>
        <ContextRing context={context} />
      </span>
    )
  return (
    <Popover
      portal
      placement="bottom-end"
      width={272}
      aria-label={t('{bot} 的上下文', { bot })}
      trigger={
        <button type="button" {...props}>
          <ContextRing context={context} />
        </button>
      }
    >
      <div className="ctx-pop">
        <ContextSummary context={context} />
        <p className="ctx-pop__hint">
          {t('在群里发 /compact @{bot} 压缩上下文，发 /new 开新会话。', { bot })}
        </p>
      </div>
    </Popover>
  )
}
