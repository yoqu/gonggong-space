import type { RunStatus } from '@gonggong/protocol'
import type { MascotAction } from '../../ui'

/** What 共字君 acts out in a run card's step line; null keeps the status icon. */
export function runMascot(
  status: RunStatus,
  streaming: boolean,
  step: string,
): { action: MascotAction; label: string } | null {
  switch (status) {
    case 'running':
      if (streaming) return { action: 'type', label: '正在回复' }
      return step ? { action: 'carry', label: '执行工具' } : { action: 'run', label: '正在工作' }
    case 'queued':
      return { action: 'wait', label: '排队中' }
    case 'awaiting_approval':
      return { action: 'raise', label: '等待审批' }
    case 'awaiting_answer':
      return { action: 'ask', label: '等待回答' }
    default:
      return null
  }
}
