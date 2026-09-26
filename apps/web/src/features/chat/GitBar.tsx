import type { GroupBotStateDto, GroupDto } from '@gonggong/protocol'
import { useEffect } from 'react'
import { loadBotStates, useWorkspace } from '../../app/workspace'
import { realtime } from '../../lib/realtime'
import { Icon, type IconName } from '../../ui'
import { useDiffWindow } from '../diff/store'

const WORKSPACE_LABEL = { managed: '托管', cd: '本机目录' } as const

function Commits({ icon, label, n }: { icon: IconName; label: string; n: number }) {
  const name = `${label} ${n} 个提交`
  return (
    <span className="git-bar__ab" role="img" aria-label={name} title={name}>
      <Icon name={icon} size={12} />
      {n}
    </span>
  )
}

function Item({ name, groupId, s }: { name: string; groupId: string; s: GroupBotStateDto }) {
  const openDiff = useDiffWindow((st) => st.open)
  const git = s.git
  const hint =
    s.state === 'unbound' ? (
      <span className="git-bar__hint">待绑定</span>
    ) : s.state === 'pending' && !git ? (
      <span className="git-bar__hint">待创建</span>
    ) : s.state === 'cloning' ? (
      <span className="git-bar__hint">clone 中…</span>
    ) : s.state === 'failed' ? (
      <span className="git-bar__error" title={s.error ?? undefined}>
        工作区创建失败
      </span>
    ) : null
  // Uncommitted work first; a clean feature branch shows what it holds against main.
  const inspect = git
    ? () => openDiff({ groupId, botId: s.botId, runId: null }, git.dirty ? 'uncommitted' : 'base')
    : undefined
  return (
    <button
      type="button"
      className="git-bar__item"
      data-testid={`git-${s.botId}`}
      aria-label={`查看 ${name} 的改动`}
      title="查看改动"
      disabled={!inspect}
      onClick={inspect}
    >
      <span className="git-bar__name">{name}</span>
      {hint ?? (
        <>
          <span className="git-bar__branch">{git?.branch ?? '—'}</span>
          {git?.behind ? <Commits icon="arrow-down" label="落后" n={git.behind} /> : null}
          {git?.ahead ? <Commits icon="arrow-up" label="领先" n={git.ahead} /> : null}
          {git?.dirty ? <span className="git-bar__dirty">未提交</span> : null}
        </>
      )}
      <span className="git-bar__ws">{WORKSPACE_LABEL[s.workspace]}</span>
    </button>
  )
}

/**
 * Partition-mode top bar (spec §5.3 / §8.4): each bot's git status, refreshed after every turn. Shown for repo groups;
 * the states are loaded for every partition group since the workspace banner needs them too.
 */
export function GitBar({ group }: { group: GroupDto }) {
  const partition = group.mode === 'partition'
  const shown = partition && !!group.repo
  const states = useWorkspace((s) => s.botStates[group.id])
  const bots = useWorkspace((s) => s.bots)
  const botKey = group.botIds.join()

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload when the group's bots change
  useEffect(() => {
    if (!partition) return
    const load = () => loadBotStates(group.id).catch(() => {})
    load()
    // Updates pushed while the socket was down are lost: catch up on reconnect.
    return realtime.onStatus((st) => st === 'open' && load())
  }, [partition, group.id, botKey])

  if (!shown) return null
  return (
    <div className="git-bar" data-testid="git-bar">
      {group.botIds.map((id) => (
        <Item
          key={id}
          name={bots.find((b) => b.id === id)?.name ?? 'bot'}
          groupId={group.id}
          s={
            states?.[id] ?? {
              botId: id,
              workspace: 'managed',
              state: 'pending',
              path: null,
              git: null,
              error: null,
              tier: null,
            }
          }
        />
      ))}
    </div>
  )
}
