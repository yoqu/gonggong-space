import type { BotDto, GroupDto } from '@gonggong/protocol'
import { FolderCheck, FolderOpen, GitBranch } from 'lucide-react'
import { useState } from 'react'
import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { api } from '../../lib/api'
import { Button, Presence, toast } from '../../ui'
import { DirPicker } from '../workspaces/DirPicker'

/** Bots waiting for a workspace (plan W5): their owner binds one here; nobody else can, and they are not run meanwhile. */
export function WorkspaceBanner({ group }: { group: GroupDto }) {
  const me = useSession((s) => s.user)
  const states = useWorkspace((s) => s.botStates[group.id])
  const bots = useWorkspace((s) => s.bots)
  const [picking, setPicking] = useState<BotDto | null>(null)
  const waiting = bots.filter((b) => group.botIds.includes(b.id) && states?.[b.id]?.state === 'unbound')
  if (!waiting.length) return null

  const bind = (bot: BotDto, path: string | null) =>
    api
      .put(`/groups/${group.id}/bots/${bot.id}/workspace`, { path })
      .then(() => setPicking(null))
      .catch((e: Error) => toast({ type: 'error', message: e.message }))

  const mineReady = waiting.filter((b) => b.ownerId === me?.id && b.machineId && !states?.[b.id]?.error)
  return (
    <>
      {mineReady.length > 1 ? (
        // Several of my bots at once: one line with a button each instead of a stack of identical banners.
        <div className="ws-banner">
          <FolderOpen size={13} className="muted-icon" />
          <span className="ws-banner__text">{`${mineReady.length} 个 Bot 还没有工作区，此前 @ 它们不会执行`}</span>
          {mineReady.map((b) => (
            <Button
              key={b.id}
              size="xs"
              variant="primary"
              data-testid={`ws-banner-${b.id}`}
              onClick={() => setPicking(b)}
            >
              {`绑定 ${b.name}`}
            </Button>
          ))}
        </div>
      ) : null}
      {waiting.map((b) => {
        if (mineReady.length > 1 && mineReady.includes(b)) return null
        const mine = b.ownerId === me?.id
        const error = states?.[b.id]?.error
        return (
          <div key={b.id} className="ws-banner" data-testid={`ws-banner-${b.id}`}>
            <FolderOpen size={13} className="muted-icon" />
            <span className="ws-banner__text">
              {mine
                ? `为 ${b.name} 选择工作区后才能开始工作，此前 @ 它不会执行`
                : `等待 ${b.ownerName} 为 ${b.name} 绑定工作区`}
              {error ? ` · ${error}` : ''}
            </span>
            {mine && b.machineId ? (
              <Button size="xs" variant="primary" onClick={() => setPicking(b)}>
                绑定工作区
              </Button>
            ) : null}
          </div>
        )
      })}
      <Presence>
        {picking?.machineId ? (
          <DirPicker
            machineId={picking.machineId}
            title={`为 ${picking.name} 选择工作区`}
            start={picking.defaultWorkspace}
            onPick={(path) => void bind(picking, path)}
            onClose={() => setPicking(null)}
            extra={
              picking.defaultWorkspace || group.repo ? (
                <div className="dirpick__choices">
                  {group.repo ? (
                    <button
                      type="button"
                      className="dirpick__choice"
                      onClick={() => void bind(picking, null)}
                    >
                      <GitBranch size={16} className="dirpick__choice-icon" />
                      <span className="dirpick__choice-text">
                        <span className="dirpick__choice-title">
                          托管克隆群仓库<span className="dirpick__badge">推荐</span>
                        </span>
                        <span className="dirpick__choice-desc">在机器上自动克隆到独立目录，互不干扰</span>
                      </span>
                    </button>
                  ) : null}
                  {picking.defaultWorkspace ? (
                    <button
                      type="button"
                      className="dirpick__choice"
                      onClick={() => void bind(picking, picking.defaultWorkspace)}
                    >
                      <FolderCheck size={16} className="dirpick__choice-icon" />
                      <span className="dirpick__choice-text">
                        <span className="dirpick__choice-title">使用默认工作区</span>
                        <span className="dirpick__choice-desc">{picking.defaultWorkspace}</span>
                      </span>
                    </button>
                  ) : null}
                  <span className="dirpick__or">或选择机器上已有的目录</span>
                </div>
              ) : null
            }
          />
        ) : null}
      </Presence>
    </>
  )
}
