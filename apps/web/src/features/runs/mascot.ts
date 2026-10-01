import type { RunStatus } from '@gonggong/protocol'
import { t } from '../../i18n'
import type { MascotAction } from '../../ui'

/** What 共字君 acts out in a run card's step line; null keeps the status icon. */
export function runMascot(
  status: RunStatus,
  streaming: boolean,
): { action: MascotAction; label: string } | null {
  switch (status) {
    case 'running':
      return streaming ? { action: 'type', label: t('正在回复') } : { action: 'carry', label: t('正在工作') }
    case 'queued':
      return { action: 'wait', label: t('排队中') }
    case 'awaiting_approval':
      return { action: 'raise', label: t('等待审批') }
    case 'awaiting_answer':
      return { action: 'ask', label: t('等待回答') }
    default:
      return null
  }
}
