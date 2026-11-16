import { MIN_NODE, type RuntimeState, type ToolKind } from '@gonggong/protocol'
import { t } from '../../i18n'
import { Button, Tag } from '../../ui'
import { canUpgrade, nodeStatus } from './model'
import type { ToolOpKind } from './source'
import { ToolLog } from './ToolLog'
import type { ToolOp } from './useAgentTools'

/** Node.js, which the adapters and managed agents run on: one line while fine, an install button when missing or too old. */
export function NodeBar({
  node,
  op,
  busy,
  canRun,
  onRun,
}: {
  node: RuntimeState
  op: ToolOp | null
  busy: boolean
  /** The client installs tools (`tools`). */
  canRun: boolean
  onRun: (kind: ToolKind, which: ToolOpKind) => void
}) {
  const status = nodeStatus(node)
  const text =
    status === 'missing'
      ? t('未安装 Node.js，Agent 需要 Node.js ≥ {min}', { min: MIN_NODE })
      : status === 'old'
        ? t('Node.js {version} 版本过低，Agent 需要 ≥ {min}', { version: node.version ?? '', min: MIN_NODE })
        : [`Node.js ${node.version ?? ''}`.trim(), node.managed ? t('共工空间托管') : t('自行安装')].join(
            ' · ',
          )
  const action = !canRun ? null : status !== 'ok' ? (
    <Button size="small" variant="primary" disabled={busy} onClick={() => onRun('node', 'install')}>
      {t('安装 Node.js')}
    </Button>
  ) : canUpgrade(node) ? (
    <Button size="small" disabled={busy} onClick={() => onRun('node', 'upgrade')}>
      {t('升级到 {version}', { version: node.latest ?? '' })}
    </Button>
  ) : null
  return (
    <section className="ag-node" aria-label="Node.js" data-status={status}>
      <div className="ag-node__line">
        {status === 'ok' ? <Tag tone="green">{t('运行环境')}</Tag> : <Tag tone="red">{t('运行环境')}</Tag>}
        <span className="ag-node__text">{text}</span>
        {action}
      </div>
      {op?.kind === 'node' ? <ToolLog op={op} /> : null}
    </section>
  )
}
