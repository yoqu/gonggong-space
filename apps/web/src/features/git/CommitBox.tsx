import type { GitActionInput, GitHeadCommit, GitOngoing } from '@gonggong/protocol'
import { type KeyboardEvent, useState } from 'react'
import { t } from '../../i18n'
import { Button, Checkbox, Icon, Popover, Spinner, Tooltip, toast } from '../../ui'
import { type GitTarget, gitActionTaken, runGitAction } from './api'
import { gitCommands, inTarget, ongoingLabel } from './commands'
import { useCommitDraft } from './draft'
import { useOwner } from './owner'

const HISTORY = 'gg.git.messages'
const HISTORY_MAX = 20

const loadHistory = (botId: string): string[] => {
  try {
    return (JSON.parse(localStorage.getItem(HISTORY) ?? '{}') as Record<string, string[]>)[botId] ?? []
  } catch {
    return []
  }
}
const remember = (botId: string, message: string) => {
  try {
    const all = JSON.parse(localStorage.getItem(HISTORY) ?? '{}') as Record<string, string[]>
    all[botId] = [message, ...(all[botId] ?? []).filter((m) => m !== message)].slice(0, HISTORY_MAX)
    localStorage.setItem(HISTORY, JSON.stringify(all))
  } catch {
    // storage unavailable: no history this time
  }
}

/** IDEA's commit message inspections: a subject line of at most 72 characters, then a blank line before the body. */
function inspect(message: string): string[] {
  const [subject = '', second] = message.split('\n')
  return [
    ...([...subject].length > 72 ? [t('首行超过 72 个字符')] : []),
    ...(second?.trim() ? [t('首行与正文之间应空一行')] : []),
  ]
}

/**
 * IDEA's commit message area: the message (a draft kept until it is committed, with the ones committed before), Amend
 * of the last commit, and Commit / Commit and Push; ⌘↩ commits. `paths` are the picked files (a rename's both sides);
 * none with Amend rewords only. A merge, pick or revert in progress is finished instead, with git's message.
 */
export function CommitBox({
  target,
  paths,
  count,
  head,
  total,
  ongoing,
  conflicts,
}: {
  target: GitTarget
  paths: string[]
  /** Files picked (a rename is one file with two paths). */
  count: number
  head: GitHeadCommit | null
  /** Files in the change list, to tell "nothing picked" from "nothing changed". */
  total: number
  ongoing: GitOngoing | null
  /** Conflicts left: git commits nothing in progress until they are resolved. */
  conflicts: number
}) {
  const { owner } = useOwner(target.botId)
  const { draft, update, clear } = useCommitDraft(target)
  const [busy, setBusy] = useState(false)
  const message = draft.message ?? ongoing?.message ?? ''
  const amend = draft.amend && !ongoing
  const text = message.trim()
  const ready = !busy && (ongoing ? !conflicts : !!text && (paths.length > 0 || amend))
  const commit = async (push: boolean) => {
    if (!ready) return
    setBusy(true)
    // git takes no partial commit while something is in progress: finishing it commits what it staged.
    const req: GitActionInput = ongoing
      ? { action: 'continue', ...(text && { message: text }) }
      : { action: 'commit', message: text, paths, amend, ...(amend && head && { expectHead: head.hash }) }
    const subject = text.split('\n')[0] ?? ''
    const committed = () =>
      toast({
        type: 'success',
        message: count
          ? t('已提交 {n} 个文件：{subject}', { n: count, subject })
          : t('已修改提交说明：{subject}', { subject }),
        action: { label: t('编辑说明'), onClick: () => void gitCommands(target).rewordLast() },
      })
    const op = await runGitAction(
      target.groupId,
      target.botId,
      inTarget(target, req),
      ongoing ? undefined : committed,
    )
    setBusy(false)
    if (!gitActionTaken(op)) return
    if (!ongoing) remember(target.botId, text)
    clear()
    if (push && op?.status === 'succeeded') gitCommands(target).push()
  }
  const keyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return
    e.preventDefault()
    void commit(false)
  }
  const toggleAmend = (on: boolean) => {
    if (on && !text && head) update({ amend: on, message: head.message.trim() })
    else if (!on && head && text === head.message.trim()) update({ amend: on, message: null })
    else update({ amend: on })
  }
  const history = loadHistory(target.botId)
  const notes = inspect(message)
  const label = !owner
    ? t('提交申请')
    : ongoing
      ? ongoing.kind === 'merge'
        ? t('提交合并')
        : t('继续{op}', { op: ongoingLabel(ongoing.kind) })
      : amend
        ? t('修改提交')
        : t('提交')
  return (
    <div className="gc-box">
      <div className="gc-box__head">
        <Checkbox
          label={t('修改#amend')}
          checked={amend}
          disabled={!head || !!ongoing}
          onChange={toggleAmend}
        />
        {amend && head?.pushed ? (
          <Tooltip content={t('该提交已推送，修改后需要强制推送才能更新远程')}>
            <span className="gc-box__warn" role="img" aria-label={t('已推送')}>
              <Icon name="warning" size={12} />
            </span>
          </Tooltip>
        ) : null}
        <span className="spacer" />
        <Popover
          portal
          placement="top-end"
          width={360}
          aria-label={t('最近的提交说明')}
          trigger={
            <button
              type="button"
              className="gc-box__icon"
              aria-label={t('最近的提交说明')}
              title={t('最近的提交说明')}
              disabled={!history.length}
            >
              <Icon name="clock" size={13} />
            </button>
          }
        >
          {(close) => (
            <ul className="gc-history">
              {history.map((m) => (
                <li key={m}>
                  <button
                    type="button"
                    className="gc-history__item"
                    onClick={() => {
                      update({ message: m })
                      close()
                    }}
                  >
                    {m}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Popover>
      </div>
      <textarea
        className="gc-box__message"
        aria-label={t('提交说明')}
        placeholder={amend ? t('修改后的提交说明') : t('提交说明')}
        value={message}
        rows={3}
        onChange={(e) => update({ message: e.target.value })}
        onKeyDown={keyDown}
      />
      {notes.length ? (
        <div className="gc-box__notes">
          {notes.map((n) => (
            <span key={n}>{n}</span>
          ))}
        </div>
      ) : null}
      <div className="gc-box__actions">
        <Button size="small" variant="primary" disabled={!ready} onClick={() => void commit(false)}>
          {busy ? <Spinner size={12} /> : null}
          {label}
        </Button>
        {owner && (!ongoing || ongoing.kind === 'merge') ? (
          <Button size="small" disabled={!ready} onClick={() => void commit(true)}>
            {amend ? t('修改并推送…') : t('提交并推送…')}
          </Button>
        ) : null}
        {ongoing && conflicts ? (
          <span className="gc-box__hint">{t('{n} 个文件有冲突，解决后才能继续', { n: conflicts })}</span>
        ) : null}
      </div>
    </div>
  )
}
