import type { GitCommit, GitRebaseStep } from '@gonggong/protocol'
import { type KeyboardEvent, useEffect, useState } from 'react'
import { t } from '../../../i18n'
import { Alert, Button, Checkbox, Dialog, PopUpButton, TextField } from '../../../ui'
import { type GitTarget, gitBase, shortRev } from '../api'
import type { CommitInfo } from '../commands'
import { useLog } from '../log/useLog'
import { GitError, OwnerNote, RefCombo, useActionLabel, useGitRun, useRepoStatus } from './common'
import './rebase-todo.css'

type Step = GitRebaseStep & { commitInfo: GitCommit }
type Action = GitRebaseStep['action']

const ACTIONS: Action[] = ['pick', 'reword', 'squash', 'fixup', 'drop']
const ACTION_LABEL: Record<Action, string> = {
  pick: 'Pick',
  reword: 'Reword',
  squash: 'Squash',
  fixup: 'Fixup',
  drop: 'Drop',
}

function planError(steps: Step[]): string | null {
  if (!steps.length) return t('当前分支在所选提交之上没有提交')
  if (steps.some((s) => s.commitInfo.parents.length > 1))
    return t('范围内有合并提交，不能在这里重排；请使用普通变基。')
  const first = steps.find((s) => s.action !== 'drop')
  if (first && (first.action === 'squash' || first.action === 'fixup'))
    return t('第一个保留的提交不能 Squash 或 Fixup')
  if (steps.some((s) => (s.action === 'reword' || s.action === 'squash') && !s.message?.trim()))
    return t('Reword 和 Squash 必须填写非空说明')
  return null
}

/** IDEA's interactive rebase editor: the selected commit is the exclusive base, the list runs oldest to newest. */
export function RebaseTodoDialog({
  target,
  commit,
  pushed,
  onClose,
}: {
  target: GitTarget
  commit: CommitInfo
  pushed: boolean
  onClose: () => void
}) {
  const status = useRepoStatus(target)
  const [onto, setOnto] = useState(commit.hash)
  const [steps, setSteps] = useState<Step[]>([])
  const [plannedFor, setPlannedFor] = useState<string | null>(null)
  const [selected, setSelected] = useState(commit.hash)
  const [confirmed, setConfirmed] = useState(false)
  const range = onto.trim() ? `${onto.trim()}..HEAD` : null
  const log = useLog(gitBase(target.groupId, target.botId), target.repo, range, {}, '')
  const { busy, error, submit } = useGitRun(target, onClose)
  const label = useActionLabel(target.botId)
  const branch = status?.branch ?? null
  useEffect(() => {
    if (plannedFor !== range && !log.loading && !log.error && !log.hasMore) {
      setSteps(
        log.commits
          .toReversed()
          .map((commitInfo) => ({ action: 'pick', commit: commitInfo.hash, commitInfo })),
      )
      setSelected(log.commits.at(-1)?.hash ?? commit.hash)
      setPlannedFor(range)
    }
  }, [commit.hash, log.commits, log.error, log.hasMore, log.loading, plannedFor, range])
  useEffect(() => {
    if (log.hasMore && !log.loading) log.more()
  }, [log])

  const invalid = planError(steps)
  const edit = (hash: string, change: Partial<GitRebaseStep>) =>
    setSteps((all) => all.map((s) => (s.commit === hash ? { ...s, ...change } : s)))
  const move = (hash: string, delta: number) => {
    setSteps((all) => {
      const from = all.findIndex((s) => s.commit === hash)
      const to = from + delta
      if (from < 0 || to < 0 || to >= all.length) return all
      const next = [...all]
      const [step] = next.splice(from, 1)
      if (step) next.splice(to, 0, step)
      return next
    })
  }
  const rowKey = (e: KeyboardEvent<HTMLDivElement>, step: Step, index: number) => {
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault()
      move(step.commit, e.key === 'ArrowUp' ? -1 : 1)
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      const next = steps[index + (e.key === 'ArrowUp' ? -1 : 1)]
      if (next) {
        setSelected(next.commit)
        document.querySelector<HTMLElement>(`[data-rebase-commit="${next.commit}"]`)?.focus()
      }
    }
  }

  return (
    <Dialog
      open
      title={t('交互式变基 {branch}', { branch: branch ?? 'HEAD' })}
      width={760}
      onClose={onClose}
      closeOnBackdrop={false}
      actions={[
        { label: t('取消'), onClick: onClose },
        {
          label: label(t('开始变基')),
          variant: 'primary',
          disabled:
            busy || !branch || !range || log.loading || !!log.error || !!invalid || (pushed && !confirmed),
          onClick: () =>
            void submit({
              action: 'rebase',
              branch: branch ?? undefined,
              onto: onto.trim(),
              todo: steps.map(({ action, commit, message }) => ({
                action,
                commit,
                ...((action === 'reword' || action === 'squash') && { message: message?.trim() }),
              })),
            }),
        },
      ]}
    >
      <div className="git-form git-rebase-todo">
        <OwnerNote botId={target.botId} />
        {pushed ? (
          <>
            <Alert
              variant="warning"
              description={t('这些提交已经推送，变基会改写公开历史，之后需要强制推送。')}
            />
            <Checkbox label={t('我确认改写已推送的历史')} checked={confirmed} onChange={setConfirmed} />
          </>
        ) : (
          <p className="git-form__hint">
            {t('重排或改写提交会生成新的提交哈希，已推送的提交之后需要强制推送。')}
          </p>
        )}
        <RefCombo
          target={target}
          label={t('变基到')}
          value={onto}
          onChange={(ref) => {
            setOnto(ref)
            setConfirmed(false)
          }}
        />
        <p className="git-rebase-todo__base">{t('变基到 {onto}', { onto: shortRev(onto.trim()) })}</p>
        {log.error ? <Alert variant="error" description={log.error} /> : null}
        {log.loading && !steps.length ? <p className="git-form__hint">{t('正在读取提交…')}</p> : null}
        {plannedFor === range && steps.length ? (
          <div className="git-rebase-todo__list" role="listbox" aria-label={t('变基提交，按执行顺序排列')}>
            {steps.map((step, index) => (
              <div
                key={step.commit}
                role="option"
                aria-selected={selected === step.commit}
                tabIndex={selected === step.commit ? 0 : -1}
                data-rebase-commit={step.commit}
                className="git-rebase-todo__row"
                data-dropped={step.action === 'drop' || undefined}
                onClick={() => setSelected(step.commit)}
                onKeyDown={(e) => rowKey(e, step, index)}
              >
                <PopUpButton
                  aria-label={t('提交 {subject} 的动作', { subject: step.commitInfo.subject })}
                  value={step.action}
                  onChange={(action) =>
                    edit(step.commit, {
                      action,
                      message: action === 'squash' ? step.commitInfo.subject : step.message,
                    })
                  }
                  options={ACTIONS.map((value) => ({ value, label: ACTION_LABEL[value] }))}
                />
                <div className="git-rebase-todo__commit">
                  <span className="git-rebase-todo__subject">{step.commitInfo.subject}</span>
                  <span className="git-rebase-todo__meta">
                    {step.commitInfo.shortHash} · {step.commitInfo.author}
                  </span>
                  {step.action === 'reword' || step.action === 'squash' ? (
                    <TextField
                      multiline
                      autoGrow
                      label={t('提交 {subject} 的提交说明', { subject: step.commitInfo.subject })}
                      value={step.message ?? step.commitInfo.subject}
                      onChange={(e) => edit(step.commit, { message: e.target.value })}
                    />
                  ) : null}
                </div>
                <div className="git-rebase-todo__move">
                  <Button
                    icon="arrow-up"
                    size="small"
                    variant="plain"
                    aria-label={t('上移 {subject}', { subject: step.commitInfo.subject })}
                    title={t('上移（Alt+↑）')}
                    disabled={index === 0}
                    onClick={() => move(step.commit, -1)}
                  />
                  <Button
                    icon="arrow-down"
                    size="small"
                    variant="plain"
                    aria-label={t('下移 {subject}', { subject: step.commitInfo.subject })}
                    title={t('下移（Alt+↓）')}
                    disabled={index === steps.length - 1}
                    onClick={() => move(step.commit, 1)}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {plannedFor === range ? <GitError error={invalid ?? error} /> : null}
      </div>
    </Dialog>
  )
}
