import type { GroupVisibility } from '@gonggong/protocol'
import { t } from '../../i18n'

/** Slack's marks: # for a public channel anyone in the team may join, a lock for a private group. */
export const channelKind = (visibility: GroupVisibility | undefined) =>
  visibility === 'public'
    ? { icon: 'hashtag' as const, label: t('公开频道') }
    : { icon: 'lock' as const, label: t('私有群') }
