import { useState } from 'react'
import { t } from '../../i18n'
import { Disclosure } from '../../ui'
import type { ToolOp } from './useAgentTools'

/** The live output of an install / upgrade, open while it runs and after. */
export function ToolLog({ op }: { op: ToolOp }) {
  const [open, setOpen] = useState(true)
  const doing = op.which === 'upgrade'
  const title = op.running
    ? doing
      ? t('正在升级…')
      : t('正在安装…')
    : op.failed
      ? doing
        ? t('升级失败')
        : t('安装失败')
      : doing
        ? t('升级完成')
        : t('安装完成')
  return (
    <div className="mx-row mx-toollog">
      <Disclosure title={title} summary={op.lines.at(-1)} open={open} onToggle={setOpen}>
        <div className="mx-logpane" role="log" aria-label={t('安装日志')}>
          {op.lines.length ? null : <div className="mx-log mx-sub">{t('等待机器输出…')}</div>}
          {op.lines.map((l, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: an append-only log
            <div key={i} className="mx-log">
              {l}
            </div>
          ))}
        </div>
      </Disclosure>
    </div>
  )
}
