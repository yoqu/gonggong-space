import type { NotifyLevel } from '@gonggong/protocol'
import { t } from '../../i18n'

/** 通知 per conversation (plan 未读与通知). */
export const NOTIFY_LEVELS: { value: NotifyLevel; label: string }[] = [
  { value: 'all', label: t('全部') },
  { value: 'mentions', label: t('仅@') },
  { value: 'off', label: t('关闭#notify') },
]
