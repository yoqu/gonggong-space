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

const TITLE_MAX = 40

/** A thread's name: the one a member set, else the root's first line with text, cut at 40 characters. */
export function threadTitle(root: MessageDto) {
  if (root.threadTitle) return root.threadTitle
  if (root.hidden || root.recalled) return t('话题')
  const line = root.body
    .split('\n')
    .map((l) => plainText(l).replace(/\s+/g, ' ').trim())
    .find(Boolean)
  if (!line) return root.attachments.length ? t('[附件]') : t('话题')
  return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX)}…` : line
}
