import { t } from '../../i18n'

/** A bot's live run on an artifact, shown as 「{name} · {status}」 in the tab and the group works list. */
export const RUNNER = {
  running: t('运行中'),
  awaiting_approval: t('等待审批'),
  awaiting_answer: t('等待回答'),
}

export const runnerText = (status: keyof typeof RUNNER, name: string | undefined) =>
  `${name ?? 'Bot'} · ${RUNNER[status]}`
