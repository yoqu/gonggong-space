import type { RunDto } from '@gonggong/protocol'
import { t } from '../../i18n'
import { stepText } from './mcp'

export interface RunIssue {
  /** error: the run failed or was voided; info: stopped on purpose or still waiting. */
  tone: 'error' | 'info'
  /** Structured issue category when specialized recovery UI is available. */
  kind?: 'auth'
  title: string
  /** The reason as the server or the agent reported it, in full. */
  detail: string
  /** True only for raw error/log output (shown in monospace); prose explanations use body font. */
  mono?: boolean
  hint?: string
}

const AGENT_ERRORS = new Set(['运行出错：{error}', 'agent 异常：{error}'])
const AUTH_ERROR_KEY = '运行出错：{agent} 尚未登录或登录已过期'
const AUTH_ERROR_RE = /Authentication required|"category"\s*:\s*"auth"|尚未登录|登录已过期/i

/** True when a run failed because the agent's official CLI account is not logged in or expired. */
export function isAuthRunError(run: Pick<RunDto, 'errorKind' | 'step' | 'stepI18n'>): boolean {
  if (run.errorKind === 'auth') return true
  if (run.stepI18n?.key === AUTH_ERROR_KEY) return true
  return AUTH_ERROR_RE.test(run.step)
}

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

export function authErrorIssue(agent: string, detail: string, mono = false): RunIssue {
  return {
    tone: 'error',
    kind: 'auth',
    title: t('{agent} 尚未登录', { agent }),
    detail,
    mono,
    hint: t('请先登录官方账号或在供应商中配置 API Key，完成后重新运行。'),
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
export function runIssue(run: RunDto, agentName?: string): RunIssue | null {
  const detail = stepText(run)
  switch (run.status) {
    case 'interrupted': {
      if (run.stoppedBy) return { tone: 'info', title: t('运行已停止'), detail }
      if (isAuthRunError(run)) {
        const paramAgent = run.stepI18n?.params?.agent
        const agent =
          agentName ||
          (paramAgent !== undefined
            ? typeof paramAgent === 'object'
              ? t.text(paramAgent)
              : String(paramAgent)
            : 'Agent')
        return authErrorIssue(agent, detail, !run.stepI18n)
      }
      if (run.stepI18n && AGENT_ERRORS.has(run.stepI18n.key)) {
        const error = run.stepI18n.params?.error
        return agentErrorIssue(
          error === undefined ? detail : typeof error === 'object' ? t.text(error) : String(error),
        )
      }
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
