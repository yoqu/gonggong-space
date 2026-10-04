import type { ScheduleDto } from '@gonggong/protocol'
import { t } from '../../i18n'
import { at } from './store'

const RESULT: Partial<Record<NonNullable<ScheduleDto['lastStatus']>, string>> = {
  queued: t('排队中'),
  offline_wait: t('等待 Bot 上线'),
  running: t('运行中'),
  awaiting_approval: t('等待审批'),
  awaiting_answer: t('等待回答'),
  completed: t('完成'),
  interrupted: t('中断'),
  forbidden: t('无权触发'),
  expired: t('离线作废'),
}

/** 下次… while on; why it is off otherwise. */
export const stateText = (s: ScheduleDto) =>
  s.enabled
    ? s.nextRunAt
      ? t('下次 {at}', { at: at(s.nextRunAt, s) })
      : t('已启用')
    : s.pausedReason
      ? t('已停用：{reason}', { reason: t.text(s.pausedReason) })
      : t('已暂停')

/** The last firing and how its run went; null before the first one. */
export const lastText = (s: ScheduleDto, botName: (id: string) => string) =>
  s.lastFiredAt
    ? t('最近 {at} · {bot} {result}', {
        at: at(s.lastFiredAt, s),
        bot: s.lastBotId ? botName(s.lastBotId) : '',
        result: s.lastStatus ? (RESULT[s.lastStatus] ?? '') : t('跳过'),
      })
    : null
