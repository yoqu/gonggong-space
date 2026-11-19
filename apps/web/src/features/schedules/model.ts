import type { ScheduleDto } from '@gonggong/protocol'
import { t } from '../../i18n'
import { STATUS_LABEL } from '../chat/RunGraphics'
import { at } from './store'

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
        result: s.lastStatus ? STATUS_LABEL[s.lastStatus] : t('跳过#schedule'),
      })
    : null
