import type { BotDto, GroupDto, RepoAccessReason } from '@gonggong/protocol'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { Button, PinnedBanner, Presence, toast } from '../../ui'
import { WorkspacePicker } from '../workspaces/WorkspacePicker'

const PAUSING: Partial<Record<RepoAccessReason, string>> = {
  denied: t('无权限或仓库不存在'),
  network: t('网络或证书问题'),
  timeout: t('连接超时'),
}

/**
 * Bots waiting for their owner's workspace choice (plan W5): one to confirm in a repo group is not run meanwhile; one
 * left without any (from before managed became the default) moves onto a managed directory when @-ed.
 * Also bots paused because their machine cannot reach the repo: the owner (or an admin) rechecks after fixing it.
 */
export function WorkspaceBanner({ group }: { group: GroupDto }) {
  const me = useSession((s) => s.user)
  const states = useWorkspace((s) => s.botStates[group.id])
  const bots = useWorkspace((s) => s.bots)
  const [picking, setPicking] = useState<BotDto | null>(null)
  const navigate = useNavigate()
  const inGroup = bots.filter((b) => group.botIds.includes(b.id))
  const waiting = inGroup.filter((b) => ['unbound', 'confirm'].includes(states?.[b.id]?.state ?? ''))
  const paused = inGroup.filter((b) => {
    const s = states?.[b.id]
    return s?.state === 'failed' && !!s.reason && !!PAUSING[s.reason]
  })
  if (!waiting.length && !paused.length) return null

  const recheck = (bot: BotDto) =>
    api
      .post(`/groups/${group.id}/bots/${bot.id}/recheck`)
      .then(() => toast({ type: 'info', message: t('正在让 {name} 的机器重新 clone…', { name: bot.name }) }))
      .catch(toastError)

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
              text={
                mine
                  ? t(
                      '{name} 已暂停：所在机器无法访问仓库（{why}），在这台机器的「Git 访问」里配置后重新检查',
                      {
                        name: b.name,
                        why: why ?? '',
                      },
                    )
                  : t('{name} 已暂停：所在机器无法访问仓库（{why}），等待 {owner} 处理', {
                      name: b.name,
                      why: why ?? '',
                      owner: b.ownerName,
                    })
              }
              action={
                mine || isAdmin ? (
                  <>
                    {mine && b.machineId ? (
                      <Button
                        size="small"
                        variant="primary"
                        onClick={() =>
                          navigate(
                            `/machine/${b.machineId}?tab=git${group.repo ? `&repo=${encodeURIComponent(group.repo.url)}` : ''}`,
                          )
                        }
                      >
                        {t('去配置')}
                      </Button>
                    ) : null}
                    <Button size="small" onClick={() => void recheck(b)}>
                      {t('重新检查')}
                    </Button>
                  </>
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
          text={t('{n} 个 Bot 还没有选工作区，@ 它们时会先用托管目录', { n: mineReady.length })}
          action={mineReady.map((b) => (
            <Button
              key={b.id}
              size="small"
              variant="primary"
              data-testid={`ws-banner-${b.id}`}
              onClick={() => setPicking(b)}
            >
              {t('绑定 {name}', { name: b.name })}
            </Button>
          ))}
        />
      ) : null}
      {waiting.map((b) => {
        if (mineReady.length > 1 && mineReady.includes(b)) return null
        const mine = b.ownerId === me?.id
        const error = states?.[b.id]?.error
        const confirm = states?.[b.id]?.state === 'confirm'
        const text = confirm
          ? mine
            ? t('为 {name} 确认工作区后才能开始工作：自动克隆或使用本机已有目录', { name: b.name })
            : t('等待 {owner} 为 {name} 确认工作区', { owner: b.ownerName, name: b.name })
          : t('{name} 还没有选工作区，@ 它时会先用托管目录', { name: b.name })
        return (
          <div key={b.id} data-testid={`ws-banner-${b.id}`}>
            <PinnedBanner
              icon="folder-open"
              title={null}
              text={`${text}${error ? ` · ${error}` : ''}`}
              action={
                mine && b.machineId ? (
                  <Button size="small" variant="primary" onClick={() => setPicking(b)}>
                    {confirm ? t('确认工作区') : t('绑定工作区')}
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
