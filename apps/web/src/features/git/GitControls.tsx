import type { GitStatus } from '@gonggong/protocol'
import type { ReactNode } from 'react'
import { t } from '../../i18n'
import { Icon, type IconName, Popover } from '../../ui'
import { openTab } from '../workbench/open'
import './git.css'

interface BotGit {
  botId: string
  name: string
}

/** The branch, with sub-repos how many there are or how many have changes. */
export function BranchLabel({ git }: { git: GitStatus }) {
  const subs = git.repos
  const changed = subs.filter((r) => r.dirty || !!r.ahead).length
  const label = changed ? t('{n} 个子仓库有改动', { n: changed }) : t('{n} 个子仓库', { n: subs.length })
  return (
    <>
      {git.branch ?? (git.head ? t('{hash}（游离）', { hash: git.head }) : subs.length ? null : '—')}
      {subs.length ? (
        <span className="git-bar__subs" data-changed={changed > 0}>
          {git.branch ? ` · ${label}` : label}
        </span>
      ) : null}
    </>
  )
}

function MenuItem({
  icon,
  label,
  note,
  disabled,
  spin,
  aria,
  onClick,
}: {
  icon: IconName
  label: string
  note?: string | null
  disabled?: boolean
  spin?: boolean
  aria?: string
  onClick: () => void
}) {
  return (
    <button type="button" className="git-subs__item" aria-label={aria} disabled={disabled} onClick={onClick}>
      <span className="git-menu__icon" data-spin={spin || undefined}>
        <Icon name={icon} size={13} />
      </span>
      {label}
      {note ? <span className="git-menu__note">{note}</span> : null}
    </button>
  )
}

/**
 * The bar's one menu per bot: where it works (`head`), its changes and files, and with `git` its Git tab, where
 * everything git (branches, sync, commit, history, operation log) happens.
 */
export function WorkspaceMenu({
  botId,
  name,
  git,
  head,
  showDiff,
  onDiff,
  onFiles,
  onChange,
}: BotGit & {
  git: GitStatus | null
  head: ReactNode
  /** The changes entry, disabled without `onDiff`. */
  showDiff: boolean
  onDiff?: () => void
  onFiles?: () => void
  /** 更换工作区, offered to the bot's owner only. */
  onChange?: () => void
}) {
  const label = t('{name} 的工作区', { name })
  return (
    <Popover
      portal
      placement="bottom-end"
      width={320}
      aria-label={label}
      trigger={
        <button type="button" className="git-bar__act" aria-label={label} title={t('工作区')}>
          <Icon name="more" size={13} />
        </button>
      }
    >
      {(close) => {
        const then = (run: () => void) => () => {
          close()
          run()
        }
        return (
          <div className="git-subs">
            <div className="git-menu__head">{head}</div>
            {showDiff ? (
              <MenuItem
                icon="doc-text"
                label={t('查看改动')}
                aria={t('查看 {name} 的改动', { name })}
                disabled={!onDiff}
                onClick={then(() => onDiff?.())}
              />
            ) : null}
            <MenuItem
              icon="folder"
              label={t('浏览文件')}
              aria={t('浏览 {name} 的文件', { name })}
              disabled={!onFiles}
              onClick={then(() => onFiles?.())}
            />
            {onChange ? (
              <MenuItem
                icon="folder-open"
                label={t('更换工作区…')}
                aria={t('更换 {name} 的工作区', { name })}
                onClick={then(onChange)}
              />
            ) : null}
            {git ? (
              <MenuItem
                icon="git-branch"
                label={t('Git 面板')}
                aria={t('打开 {name} 的 Git', { name })}
                onClick={then(() => openTab({ kind: 'git', botId }))}
              />
            ) : null}
          </div>
        )
      }}
    </Popover>
  )
}
