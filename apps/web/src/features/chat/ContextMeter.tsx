import type { ContextUsage } from '@gonggong/protocol'
import { Button, LevelIndicator, Popover, toast } from '../../ui'
import { postMessage, uuid } from './MessageComposer'

const WARNING = 70
const CRITICAL = 90
const R = 5
const ARC = 2 * Math.PI * R

export const fmtTokens = (n: number) =>
  n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)

/** A bot's context window occupancy in this group, with /compact and /new at hand (both sent as group messages). */
export function ContextMeter({
  groupId,
  bot,
  context,
}: {
  groupId: string
  bot: string
  context: ContextUsage
}) {
  const pct = Math.min(100, Math.round((context.used / Math.max(1, context.size)) * 100))
  const level = pct >= CRITICAL ? 'critical' : pct >= WARNING ? 'warning' : 'normal'
  const detail = `${fmtTokens(context.used)} / ${fmtTokens(context.size)}`
  const send = (command: string) =>
    postMessage(groupId, {
      body: `/${command} @${bot}`,
      clientId: uuid(),
      attachmentIds: [],
      quote: null,
      appendTo: null,
    }).catch((e: Error) => toast({ type: 'error', message: e.message }))
  return (
    <Popover
      portal
      placement="bottom-end"
      width={272}
      aria-label={`${bot} 的上下文`}
      trigger={
        <button
          type="button"
          className="ctx-meter"
          data-level={level}
          aria-label={`${bot} 上下文 ${detail}`}
          title={`上下文 ${detail}`}
        >
          <svg viewBox="0 0 14 14" width={14} height={14} aria-hidden="true">
            <circle className="ctx-meter__track" cx={7} cy={7} r={R} />
            <circle
              className="ctx-meter__arc"
              cx={7}
              cy={7}
              r={R}
              strokeDasharray={`${(pct / 100) * ARC} ${ARC}`}
              transform="rotate(-90 7 7)"
            />
          </svg>
          {pct}%
        </button>
      }
    >
      {(close) => (
        <div className="ctx-pop">
          <LevelIndicator
            value={pct}
            warning={WARNING}
            critical={CRITICAL}
            aria-label="上下文占用"
            label={
              <>
                <span>上下文</span>
                <span className="ctx-pop__detail">{detail}</span>
              </>
            }
          />
          <p className="ctx-pop__hint">
            {level === 'critical' ? '即将用满，Agent 会自动压缩。' : null}
            压缩会把此前的对话总结后保留；开新对话则不再带上此前的对话。
          </p>
          <div className="ctx-pop__actions">
            <Button
              size="small"
              variant="plain"
              onClick={() => {
                close()
                send('new')
              }}
            >
              开新对话
            </Button>
            <Button
              size="small"
              variant="primary"
              onClick={() => {
                close()
                send('compact')
              }}
            >
              压缩上下文
            </Button>
          </div>
        </div>
      )}
    </Popover>
  )
}
