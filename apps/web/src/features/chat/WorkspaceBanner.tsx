import type { BotDto, GroupDto, RepoAccessReason } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { api } from '../../lib/api'
import { Button, Icon, PinnedBanner, Presence, toast } from '../../ui'
import { DirPicker } from '../workspaces/DirPicker'

const PAUSING: Partial<Record<RepoAccessReason, string>> = {
  denied: '无权限或仓库不存在',
  network: '网络或证书问题',
  timeout: '连接超时',
}

/** Directories on the caller's machines already holding the group repo, offered before a fresh clone. */
function useLocalPaths(group: GroupDto, wanted: boolean) {
  const [paths, setPaths] = useState<{ machineId: string; path: string }[]>([])
  useEffect(() => {
    if (!wanted || !group.repo) return
    api.get<{ machineId: string; path: string }[]>(`/groups/${group.id}/local-paths`).then(setPaths, () => {})
  }, [wanted, group.id, group.repo])
  return paths
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
  const local = useLocalPaths(group, !!picking)
  if (!waiting.length && !paused.length) return null

  const recheck = (bot: BotDto) =>
    api
      .post(`/groups/${group.id}/bots/${bot.id}/recheck`)
      .then(() => toast({ type: 'info', message: `正在让 ${bot.name} 的机器重新 clone…` }))
      .catch((e: Error) => toast({ type: 'error', message: e.message }))

  const bind = (bot: BotDto, path: string | null) =>
    api
      .put(`/groups/${group.id}/bots/${bot.id}/workspace`, { path })
      .then(() => setPicking(null))
      .catch((e: Error) => toast({ type: 'error', message: e.message }))

  const mineReady = waiting.filter((b) => b.ownerId === me?.id && b.machineId && !states?.[b.id]?.error)
  const here = local.filter((p) => p.machineId === picking?.machineId)
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
          <DirPicker
            machineId={picking.machineId}
            title={`为 ${picking.name} 选择工作区`}
            start={picking.defaultWorkspace}
            onPick={(path) => void bind(picking, path)}
            onClose={() => setPicking(null)}
            extra={
              picking.defaultWorkspace || group.repo ? (
                <div className="dirpick__choices">
                  {here.map((p) => (
                    <button
                      key={p.path}
                      type="button"
                      className="dirpick__choice"
                      onClick={() => void bind(picking, p.path)}
                    >
                      <Icon name="folder-check" size={16} className="dirpick__choice-icon" />
                      <span className="dirpick__choice-text">
                        <span className="dirpick__choice-title">
                          使用本机已有的仓库目录<span className="dirpick__badge">免 clone</span>
                        </span>
                        <span className="dirpick__choice-desc">{p.path}</span>
                      </span>
                    </button>
                  ))}
                  {group.repo ? (
                    <button
                      type="button"
                      className="dirpick__choice"
                      onClick={() => void bind(picking, null)}
                    >
                      <Icon name="git-branch" size={16} className="dirpick__choice-icon" />
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
                      <Icon name="folder-check" size={16} className="dirpick__choice-icon" />
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
