import { feishuErrorHint, type FeishuIssueEvent as Issue, type MessageDto } from '@gonggong/protocol'
import { memo, useState } from 'react'
import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { locale, t } from '../../i18n'
import { api } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { Button, ChatNotice, Icon } from '../../ui'
import './feishu.css'

/** A Feishu error code in plain words: what happened, then what to do. */
export function feishuHintText(code: number) {
  const h = feishuErrorHint(code)
  return [t.text({ key: h.what }), t.text({ key: h.todo })].join(locale === 'en' ? ' ' : '')
}

const AUTO_PULL_FAILED = '{bot} 没能自动拉入飞书群：{what}{todo}'

/**
 * A group event about a failed Feishu call: plain words first, Feishu's code second. When pulling the bot into the chat
 * fixes it (its app is not there, or adding it failed), group admins get a one-click 拉入.
 */
export const FeishuIssueEventRow = memo(function FeishuIssueEventRow({
  m,
  issue,
}: {
  m: MessageDto
  issue: Issue
}) {
  const me = useSession((s) => s.user?.id)
  const isAdmin = useWorkspace(
    (s) => !!s.groups.find((g) => g.id === m.groupId)?.members.some((x) => x.userId === me && x.isAdmin),
  )
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle')
  const text = m.i18n ? t.text(m.i18n) : m.body
  const retry = m.i18n?.key === AUTO_PULL_FAILED
  const pullable = !!issue.botId && isAdmin && (retry || feishuErrorHint(issue.code).pullIn)

  const pull = async () => {
    setState('busy')
    try {
      await api.post(`/groups/${m.groupId}/feishu/bots/${issue.botId}`, {})
      setState('done')
    } catch (e) {
      toastError(e)
      setState('idle')
    }
  }

  return (
    <ChatNotice>
      <span className="tl-event feishu-issue-event" title={text}>
        <Icon name="exclamation-circle" size={13} />
        <span className="tl-event__text">{text}</span>
        <span className="feishu-issue__code" title={issue.message}>
          {t('飞书错误码 {code}', { code: issue.code })}
        </span>
        {!pullable ? null : state === 'done' ? (
          <span className="feishu-issue__code">{t('已拉入飞书群')}</span>
        ) : (
          <Button size="small" variant="plain" disabled={state === 'busy'} onClick={() => void pull()}>
            {retry ? t('重试') : t('一键拉入')}
          </Button>
        )}
      </span>
    </ChatNotice>
  )
})
