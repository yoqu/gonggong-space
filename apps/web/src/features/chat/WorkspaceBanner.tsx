import type { BotDto, GroupDto, RepoAccessReason } from '@gonggong/protocol'
import { useState } from 'react'
import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { api } from '../../lib/api'
import { Button, PinnedBanner, Presence, toast } from '../../ui'
import { WorkspacePicker } from '../workspaces/WorkspacePicker'

const PAUSING: Partial<Record<RepoAccessReason, string>> = {
  denied: '无权限或仓库不存在',
  network: '网络或证书问题',
  timeout: '连接超时',
}

/**
 * Bots waiting for a workspace (plan W5): their owner binds one here; nobody else can, and they are not run meanwhile.
 * Also bots paused because their machine cannot reach the repo: the owner (or an admin) rechecks after fixing it.
 */
export function WorkspaceBanner({ group }: { group: GroupDto }) {
  const me = useSession((s) => s.user)
  const states = useWorkspace((s) => s.botStates[group.id])
  const bots = useWorkspace((s) => s.bots)
  const [picking, setPicking] = useState<BotDto | null>(null)
  const inGroup = bots.filter((b) => group.botIds.includes(b.id))
  const waiting = inGroup.filter((b) => states?.[b.id]?.state === 'unbound')
  const paused = inGroup.filter((b) => {
    const s = states?.[b.id]
    return s?.state === 'failed' && !!s.reason && !!PAUSING[s.reason]
  })
  if (!waiting.length && !paused.length) return null

  const recheck = (bot: BotDto) =>
    api
      .post(`/groups/${group.id}/bots/${bot.id}/recheck`)
      .then(() => toast({ type: 'info', message: `正在让 ${bot.name} 的机器重新 clone…` }))
      .catch((e: Error) => toast({ type: 'error', message: e.message }))

  const mineReady = waiting.filter((b) => b.ownerId === me?.id && b.machineId && !states?.[b.id]?.error)
  return (
    <>
      {paused.map((b) => {
        const s = states?.[b.id]
        const why = s?.reason ? PAUSING[s.reason] : ''
        const mine = b.ownerId === me?.id
        const isAdmin = group.members.some((m) => m.userId === me?.id && m.isAdmin)
        return (
          <div key={b.id} data-testid={`ws-paused-${b.id}`}>
            <PinnedBanner
              icon="warning"
              title={null}
              text={`${b.name} 已暂停：所在机器无法访问仓库（${why}）${
                mine ? '，在这台机器上配置 git 凭据后重新检查' : `，等待 ${b.ownerName} 处理`
              }`}
              action={
                mine || isAdmin ? (
                  <Button size="small" onClick={() => void recheck(b)}>
                    重新检查
                  </Button>
                ) : null
              }
            />
          </div>
        )
      })}
      {mineReady.length > 1 ? (
        // Several of my bots at once: one line with a button each instead of a stack of identical banners.
        <PinnedBanner
          icon="folder-open"
          title={null}
          text={`${mineReady.length} 个 Bot 还没有工作区，此前 @ 它们不会执行`}
          action={mineReady.map((b) => (
            <Button
              key={b.id}
              size="small"
              variant="primary"
              data-testid={`ws-banner-${b.id}`}
              onClick={() => setPicking(b)}
            >
              {`绑定 ${b.name}`}
            </Button>
          ))}
        />
      ) : null}
      {waiting.map((b) => {
        if (mineReady.length > 1 && mineReady.includes(b)) return null
        const mine = b.ownerId === me?.id
        const error = states?.[b.id]?.error
        return (
          <div key={b.id} data-testid={`ws-banner-${b.id}`}>
            <PinnedBanner
              icon="folder-open"
              title={null}
              text={`${
                mine
                  ? `为 ${b.name} 选择工作区后才能开始工作，此前 @ 它不会执行`
                  : `等待 ${b.ownerName} 为 ${b.name} 绑定工作区`
              }${error ? ` · ${error}` : ''}`}
              action={
                mine && b.machineId ? (
                  <Button size="small" variant="primary" onClick={() => setPicking(b)}>
                    绑定工作区
                  </Button>
                ) : null
              }
            />
          </div>
        )
      })}
      <Presence>
        {picking?.machineId ? (
          <WorkspacePicker
            group={group}
            bot={{ ...picking, machineId: picking.machineId }}
            onClose={() => setPicking(null)}
          />
        ) : null}
      </Presence>
    </>
  )
}
