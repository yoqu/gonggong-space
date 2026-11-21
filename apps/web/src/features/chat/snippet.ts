import type { MessageDto } from '@gonggong/protocol'
import { t } from '../../i18n'
import { plainText } from '../../lib/plain'

const MAX = 140

/** A message's one-line preview in inbox-style lists; `plainText` works per line, so lines are stripped before joining. */
export const messageSnippet = (m: MessageDto) =>
  m.hidden
    ? t('你已删除这条消息')
    : m.recalled
      ? t('该消息已撤回')
      : m.body.split('\n').map(plainText).join(' ').replace(/\s+/g, ' ').trim().slice(0, MAX) ||
        (m.attachments.length ? t('[附件]') : '')
