import type { BotDto, GroupDto } from '@aiws/protocol'
import { FolderOpen } from 'lucide-react'
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

  return (
    <>
      {waiting.map((b) => {
        const mine = b.ownerId === me?.id
        const error = states?.[b.id]?.error
        return (
          <div key={b.id} className="ws-banner" data-testid={`ws-banner-${b.id}`}>
            <FolderOpen size={13} className="muted-icon" />
            <span className="ws-banner__text">
              {mine
                ? `为 ${b.name} 选择工作目录后才能开始工作`
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
            title={`${picking.name} 的工作目录`}
            start={picking.defaultWorkspace}
            onPick={(path) => void bind(picking, path)}
            onClose={() => setPicking(null)}
            extra={
              picking.defaultWorkspace || group.repo ? (
                <div className="dirpick__choices">
                  {picking.defaultWorkspace ? (
                    <Button size="sm" onClick={() => void bind(picking, picking.defaultWorkspace)}>
                      使用默认工作区
                    </Button>
                  ) : null}
                  {group.repo ? (
                    <Button size="sm" onClick={() => void bind(picking, null)}>
                      托管克隆群仓库
                    </Button>
                  ) : null}
                </div>
              ) : null
            }
          />
        ) : null}
      </Presence>
    </>
  )
}
