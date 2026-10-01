import type { GroupBotStateDto, GroupDto } from '@gonggong/protocol'
import { useEffect } from 'react'
import { loadBotStates, useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { realtime } from '../../lib/realtime'
import { Icon, type IconName } from '../../ui'
import { openTab } from '../workbench/open'
import { ContextMeter } from './ContextMeter'

const WORKSPACE_LABEL = { managed: t('托管'), cd: t('本机目录') }

function Commits({ icon, name, n }: { icon: IconName; name: string; n: number }) {
  return (
    <span className="git-bar__ab" role="img" aria-label={name} title={name}>
      <Icon name={icon} size={12} />
      {n}
    </span>
  )
}

function Item({
  groupId,
  name,
  s,
  git: showGit,
}: {
  groupId: string
  name: string
  s: GroupBotStateDto
  git: boolean
}) {
  const git = s.git
  const hint =
    s.state === 'unbound' ? (
      <span className="git-bar__hint">{t('待绑定')}</span>
    ) : s.state === 'pending' && !git ? (
      <span className="git-bar__hint">{t('待创建')}</span>
    ) : s.state === 'cloning' ? (
      <span className="git-bar__hint">{t('clone 中…')}</span>
    ) : s.state === 'failed' ? (
      <span className="git-bar__error" title={s.error ?? undefined}>
        {t('工作区创建失败')}
      </span>
    ) : null
  // Uncommitted work first; a clean feature branch shows what it holds against main.
  const diff = git
    ? () => openTab({ kind: 'diff', botId: s.botId, scope: git.dirty ? 'uncommitted' : 'base', file: null })
    : undefined
  const files =
    git || s.state === 'ready'
      ? () => openTab({ kind: 'files', botId: s.botId, dir: '', selected: null })
      : undefined
  return (
    <div className="git-bar__item" data-testid={`git-${s.botId}`}>
      <span className="git-bar__name">{name}</span>
      {showGit ? (
        <>
          {hint ?? (
            <>
              <span className="git-bar__branch">{git?.branch ?? '—'}</span>
              {git?.behind ? (
                <Commits icon="arrow-down" name={t('落后 {n} 个提交', { n: git.behind })} n={git.behind} />
              ) : null}
              {git?.ahead ? (
                <Commits icon="arrow-up" name={t('领先 {n} 个提交', { n: git.ahead })} n={git.ahead} />
              ) : null}
              {git?.dirty ? <span className="git-bar__dirty">{t('未提交')}</span> : null}
            </>
          )}
          <span className="git-bar__ws">{WORKSPACE_LABEL[s.workspace]}</span>
        </>
      ) : null}
      {s.context ? <ContextMeter groupId={groupId} bot={name} context={s.context} /> : null}
      {showGit ? (
        <span className="git-bar__actions">
          <Action
            icon="git-branch"
            label={t('查看 {name} 的改动', { name })}
            title={t('改动')}
            onClick={diff}
          />
          <Action icon="folder" label={t('浏览 {name} 的文件', { name })} title={t('文件')} onClick={files} />
        </span>
      ) : null}
    </div>
  )
}

function Action({
  icon,
  label,
  title,
  onClick,
}: {
  icon: IconName
  label: string
  title: string
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      className="git-bar__act"
      aria-label={label}
      title={title}
      disabled={!onClick}
      onClick={onClick}
    >
      <Icon name={icon} size={13} />
    </button>
  )
}

/**
 * Bot bar under the header: each bot's context occupancy (every group, once reported) and, in partition groups with
 * a repo, its git status refreshed after every turn (spec §5.3 / §8.4). The workspace banner reads the same states.
 */
export function GitBar({ group }: { group: GroupDto }) {
  const showGit = group.mode === 'partition' && !!group.repo
  const states = useWorkspace((s) => s.botStates[group.id])
  const bots = useWorkspace((s) => s.bots)
  const botKey = group.botIds.join()

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload when the group's bots change
  useEffect(() => {
    const load = () => loadBotStates(group.id).catch(() => {})
    load()
    // Updates pushed while the socket was down are lost: catch up on reconnect.
    return realtime.onStatus((st) => st === 'open' && load())
  }, [group.id, botKey])

  const ids = showGit ? group.botIds : group.botIds.filter((id) => states?.[id]?.context)
  if (!ids.length) return null
  return (
    <div className="git-bar" data-testid="git-bar">
      {ids.map((id) => (
        <Item
          key={id}
          groupId={group.id}
          git={showGit}
          name={bots.find((b) => b.id === id)?.name ?? 'bot'}
          s={
            states?.[id] ?? {
              botId: id,
              workspace: 'managed',
              state: 'pending',
              path: null,
              git: null,
              error: null,
              reason: null,
              tier: null,
              model: null,
              effort: null,
              context: null,
            }
          }
        />
      ))}
    </div>
  )
}
