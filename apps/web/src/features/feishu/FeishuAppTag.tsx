import type { FeishuAppDto } from '@gonggong/protocol'
import { t } from '../../i18n'
import { Tag, type TagTone } from '../../ui'

/** Where a bot's Feishu app stands, in one word: what the bot page and the admin overview show. */
export function feishuAppState(app: FeishuAppDto | null): { label: string; tone: TagTone } {
  if (!app) return { label: t('未接入'), tone: 'gray' }
  if (app.status === 'error') return { label: t('连接失败'), tone: 'red' }
  if (app.status === 'connecting') return { label: t('连接中'), tone: 'blue' }
  if (app.review === 'pending') return { label: t('等待审核'), tone: 'orange' }
  return { label: t('已接通'), tone: 'green' }
}

export function FeishuAppTag({ app }: { app: FeishuAppDto | null }) {
  const s = feishuAppState(app)
  return <Tag tone={s.tone}>{s.label}</Tag>
}
