import type { RunDto } from '@gonggong/protocol'
import { t } from '../../i18n'
import { stepText } from './mcp'

export interface RunIssue {
  /** error: the run failed or was voided; info: stopped on purpose or still waiting. */
  tone: 'error' | 'info'
  title: string
  /** The reason as the server or the agent reported it, in full. */
  detail: string
  /** True only for raw error/log output (shown in monospace); prose explanations use body font. */
  mono?: boolean
  hint?: string
}

const AGENT_ERROR = 'agent 异常：{error}'

/** Shared with the desktop app, which reads the agent's error from the local daemon. */
export function agentErrorIssue(detail: string): RunIssue {
  return {
    tone: 'error',
    title: t('运行失败：Agent 异常'),
    detail: detail || t('未知错误'),
    mono: !!detail,
    hint: t('看完错误信息后重新 @ Bot 再试；反复出现时检查 Bot 所在电脑上 Agent 的登录、额度与网络。'),
  }
}

export function interruptedIssue(detail: string): RunIssue {
  return {
    tone: 'error',
    title: t('运行已中断'),
    detail: detail || t('未记录原因'),
    hint: t('重新 @ Bot 再试一次；已改的文件见「改动」。'),
  }
}

/** Why a run did not (yet) do its work, from its status and its card step; null while it works or once it completed. */
export function runIssue(run: RunDto): RunIssue | null {
  const detail = stepText(run)
  switch (run.status) {
    case 'interrupted': {
      if (run.stepI18n?.key === AGENT_ERROR) {
        const error = run.stepI18n.params?.error
        return agentErrorIssue(
          error === undefined ? detail : typeof error === 'object' ? t.text(error) : String(error),
        )
      }
      if (run.stoppedBy) return { tone: 'info', title: t('运行已停止'), detail }
      return interruptedIssue(detail)
    }
    case 'expired':
      return {
        tone: 'error',
        title: t('运行已失效'),
        detail: detail || t('未记录原因'),
        hint: t('确认 Bot 所在电脑在线、共工客户端正在运行后重新 @ Bot。'),
      }
    case 'forbidden':
      return { tone: 'error', title: t('没有运行权限'), detail }
    case 'offline_wait':
      return {
        tone: 'info',
        title: t('等待 Bot 上线'),
        detail,
        hint: t('Bot 所在电脑离线；超过 {n} 分钟仍未上线本次请求将失效。', { n: run.offlineWaitMin }),
      }
    case 'queued':
      return { tone: 'info', title: t('排队中'), detail: detail || t('等待开始') }
    default:
      return null
  }
}
