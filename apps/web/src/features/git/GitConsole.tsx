import type { GitCommandRecord, GitOperationDto } from '@gonggong/protocol'
import { useState } from 'react'
import { t } from '../../i18n'
import { fullTime } from '../../lib/time'
import { Button, EmptyState } from '../../ui'
import { useGitOps } from './GitOperations'
import { ACTION_LABEL } from './notify'

function Command({ command }: { command: GitCommandRecord }) {
  const [open, setOpen] = useState(false)
  const output = [command.stdout, command.stderr].filter(Boolean).join('\n')
  const long = output.length > 1600 || output.split('\n').length > 16
  return (
    <li className="git-console__command" data-testid={`git-command-${command.startedAt}`}>
      <div className="git-console__command-line">
        <code>{command.command}</code>
        <span>
          {command.exitCode === null ? t('未启动') : t('退出码 {code}', { code: command.exitCode })}
        </span>
        <span>{t('{duration} ms', { duration: command.durationMs })}</span>
        {command.truncated ? <span>{t('输出已截断')}</span> : null}
        {long ? (
          <Button size="small" variant="plain" onClick={() => setOpen(!open)}>
            {open ? t('收起输出') : t('展开输出')}
          </Button>
        ) : null}
      </div>
      {output && (!long || open) ? (
        <pre className="git-console__output" data-error={command.exitCode !== 0 || undefined}>
          {output}
        </pre>
      ) : null}
    </li>
  )
}

function Operation({ op }: { op: GitOperationDto }) {
  const [open, setOpen] = useState(false)
  const output = [op.output, op.error].filter(Boolean).join('\n')
  const long = output.length > 1600 || output.split('\n').length > 16
  const commands = op.detail?.commands ?? []
  return (
    <li className="git-console__op" data-testid={`git-console-${op.id}`} data-status={op.status}>
      <div className="git-console__meta">
        <time dateTime={op.createdAt}>{fullTime(op.createdAt)}</time>
        <strong>{ACTION_LABEL[op.action]}</strong>
        <span>{op.requestedBy.name}</span>
        <span className="git-console__status">{op.status === 'failed' ? t('失败') : t('已完成')}</span>
        <span className="spacer" />
        {long ? (
          <Button size="small" variant="plain" onClick={() => setOpen(!open)}>
            {open ? t('收起输出') : t('展开输出')}
          </Button>
        ) : null}
      </div>
      {commands.length ? (
        <ol className="git-console__commands">
          {commands.map((command) => (
            <Command key={`${command.startedAt}-${command.command}`} command={command} />
          ))}
        </ol>
      ) : output && (!long || open) ? (
        <pre className="git-console__output" data-error={!!op.error || undefined}>
          {output}
        </pre>
      ) : null}
    </li>
  )
}

/** Read-only IDEA-style console: only the audited, controlled Git operations, never an arbitrary shell. */
export function GitConsole({ groupId, botId }: { groupId: string; botId: string }) {
  const [failedOnly, setFailedOnly] = useState(false)
  const list = useGitOps(groupId)
    .filter((op) => op.botId === botId && ['running', 'succeeded', 'failed'].includes(op.status))
    .filter((op) => !failedOnly || op.status === 'failed')
    .reverse()
  return (
    <div className="git-console">
      <div className="git-console__tools">
        <span className="git-console__hint">{t('受控 Git 操作的命令与输出')}</span>
        <span className="spacer" />
        <Button
          size="small"
          variant="plain"
          aria-pressed={failedOnly}
          onClick={() => setFailedOnly(!failedOnly)}
        >
          {t('仅失败')}
        </Button>
      </div>
      {list.length ? (
        <ol className="git-console__list">
          {list.map((op) => (
            <Operation key={op.id} op={op} />
          ))}
        </ol>
      ) : (
        <EmptyState
          compact
          icon="terminal"
          title={failedOnly ? t('没有失败的 Git 操作') : t('还没有 Git 控制台输出')}
        />
      )}
    </div>
  )
}
