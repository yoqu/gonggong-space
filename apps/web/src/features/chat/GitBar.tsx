import type { GroupBotStateDto, GroupDto } from '@gonggong/protocol'
import { useEffect } from 'react'
import { loadBotStates, useWorkspace } from '../../app/workspace'
import { realtime } from '../../lib/realtime'

const WORKSPACE_LABEL = { managed: '托管', cd: '本机目录' } as const

function Item({ name, s }: { name: string; s: GroupBotStateDto }) {
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
  return (
    <div className="git-bar__item" data-testid={`git-${s.botId}`}>
      <span className="git-bar__name">{name}</span>
      {hint ?? (
        <>
          <span className="git-bar__branch">{git?.branch ?? '—'}</span>
          {git?.behind || git?.ahead ? (
            <span className="git-bar__ab">
              {[git.behind ? `↓${git.behind}` : '', git.ahead ? `↑${git.ahead}` : '']
                .filter(Boolean)
                .join(' ')}
            </span>
          ) : null}
          {git?.dirty ? <span className="git-bar__dirty">未提交</span> : null}
        </>
      )}
      <span className="git-bar__ws">{WORKSPACE_LABEL[s.workspace]}</span>
    </div>
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
          s={
            states?.[id] ?? {
              botId: id,
              workspace: 'managed',
              state: 'pending',
              path: null,
              git: null,
              error: null,
            }
          }
        />
      ))}
    </div>
  )
}
