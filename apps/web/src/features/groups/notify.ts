import type { NotifyLevel } from '@gonggong/protocol'
import { t } from '../../i18n'

/** 通知 per conversation (plan 未读与通知). */
export const NOTIFY_LEVELS: { value: NotifyLevel; label: string; description: string }[] = [
  { value: 'all', label: t('全部'), description: t('每条新消息都提醒') },
  { value: 'mentions', label: t('仅@'), description: t('只提醒 @我 和 @所有人') },
  { value: 'off', label: t('关闭#notify'), description: t('连 @ 也不提醒；待审批和向我提问仍提醒') },
]
