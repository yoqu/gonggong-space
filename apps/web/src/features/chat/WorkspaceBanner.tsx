import type { BotDto, GroupDto, RepoAccessReason } from '@gonggong/protocol'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { Button, PinnedBanner, Presence, toast } from '../../ui'
import { TakeoverDialog } from '../teams/TakeoverDialog'
import { WorkspacePicker } from '../workspaces/WorkspacePicker'

const PAUSING: Partial<Record<RepoAccessReason, string>> = {
  denied: t('无权限或仓库不存在'),
  network: t('网络或证书问题'),
  timeout: t('连接超时'),
}

const HIDDEN_KEY = 'gg.workspaceBanner.hidden'
const readHidden = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

import { create } from 'zustand'

export const useWorkspaceBannerHidden = create<{ hidden: string[]; add: (keys: string[]) => void }>(
  (set) => ({
    hidden: readHidden(),
    add: (keys) =>
      set((s) => {
        const next = [...new Set([...s.hidden, ...keys])].slice(-200)
        localStorage.setItem(HIDDEN_KEY, JSON.stringify(next))
        return { hidden: next }
      }),
  }),
)

export const workspaceBannerHideKey = (
  groupId: string,
  botId: string,
  state?: string,
  reason?: string | null,
) => `${groupId}:${botId}:${state}:${reason ?? ''}`

/** A team admin viewing a group of the team they are not in (plan D19): nothing can be sent, changed or acted on. */
export function ReadOnlyBanner({ group }: { group: GroupDto }) {
  const [taking, setTaking] = useState(false)
  return (
    <div data-testid="readonly-banner">
      <PinnedBanner
        icon="eye"
        title={t('只读查看')}
        text={t('你正以团队管理员身份查看此群，不能发言或管理。')}
        action={
          <Button size="small" onClick={() => setTaking(true)}>
            {t('进群并成为管理员')}
          </Button>
        }
      />
      <Presence>
        {taking ? (
          <TakeoverDialog
            teamId={group.teamId}
            group={group}
            onDone={() => setTaking(false)}
            onClose={() => setTaking(false)}
          />
        ) : null}
      </Presence>
    </div>
  )
}

/**
 * Blocking workspace banners: bots awaiting their owner's workspace confirmation in a repo group, and bots paused
 * because their computer cannot reach the repo. Non-repo bots silently use a managed workspace with no top banner.
 */
export function WorkspaceBanner({ group }: { group: GroupDto }) {
  const me = useSession((s) => s.user)
  const states = useWorkspace((s) => s.botStates[group.id])
  const bots = useWorkspace((s) => s.bots)
  const [picking, setPicking] = useState<BotDto | null>(null)
  const [recheckingId, setRecheckingId] = useState<string | null>(null)
  const navigate = useNavigate()
  // Hidden per bot and state: a banner comes back once the bot's state changes.
  const hidden = useWorkspaceBannerHidden((s) => s.hidden)
  const addHidden = useWorkspaceBannerHidden((s) => s.add)
  const hideKey = (b: BotDto) =>
    workspaceBannerHideKey(group.id, b.id, states?.[b.id]?.state, states?.[b.id]?.reason)
  const hide = (list: BotDto[]) => addHidden(list.map(hideKey))
  const inGroup = bots.filter((b) => group.botIds.includes(b.id) && !hidden.includes(hideKey(b)))
  const waiting = inGroup.filter((b) => states?.[b.id]?.state === 'confirm')
  const paused = inGroup.filter((b) => {
    const s = states?.[b.id]
    return s?.state === 'failed' && !!s.reason && !!PAUSING[s.reason]
  })
  if (!waiting.length && !paused.length) return null

  const recheck = (bot: BotDto) => {
    if (recheckingId === bot.id) return
    setRecheckingId(bot.id)
    return api
      .post(`/groups/${group.id}/bots/${bot.id}/recheck`)
      .then(() => toast({ type: 'info', message: t('正在让 {name} 的电脑重新克隆…', { name: bot.name }) }))
      .catch(toastError)
      .finally(() => setRecheckingId((cur) => (cur === bot.id ? null : cur)))
  }

  const mineReady = waiting.filter((b) => b.ownerId === me?.id && b.machineId && !states?.[b.id]?.error)
  const primaryCount =
    paused.filter((b) => b.ownerId === me?.id && b.machineId).length +
    (mineReady.length > 1 ? mineReady.length : 0) +
    waiting.filter(
      (b) => !(mineReady.length > 1 && mineReady.includes(b)) && b.ownerId === me?.id && b.machineId,
    ).length
  const primaryVariant = primaryCount > 1 ? 'default' : 'primary'
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
                      '{name} 已暂停：所在电脑连不上仓库（{why}），在这台电脑的「Git 访问」里配置后重新检查',
                      {
                        name: b.name,
                        why: why ?? '',
                      },
                    )
                  : t('{name} 已暂停：所在电脑连不上仓库（{why}），等待 {owner} 处理', {
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
                        variant={primaryVariant}
                        onClick={() =>
                          navigate(
                            `/machine/${b.machineId}?tab=git${group.repo ? `&repo=${encodeURIComponent(group.repo.url)}` : ''}`,
                          )
                        }
                      >
                        {t('去配置')}
                      </Button>
                    ) : null}
                    <Button
                      size="small"
                      loading={recheckingId === b.id}
                      disabled={recheckingId === b.id}
                      onClick={() => void recheck(b)}
                    >
                      {t('重新检查')}
                    </Button>
                  </>
                ) : null
              }
              onClose={() => hide([b])}
              closeLabel={t('隐藏')}
            />
          </div>
        )
      })}
      {mineReady.length > 1 ? (
        // Several of my bots at once: one line with a button each instead of a stack of identical banners.
        <PinnedBanner
          icon="folder-open"
          title={null}
          text={t('请先为 {n} 个 Bot 确认工作区，确认后即可开始工作', { n: mineReady.length })}
          action={mineReady.map((b) => (
            <Button
              key={b.id}
              size="small"
              variant={primaryVariant}
              data-testid={`ws-banner-${b.id}`}
              onClick={() => setPicking(b)}
            >
              {t('确认 {name}', { name: b.name })}
            </Button>
          ))}
          onClose={() => hide(mineReady)}
          closeLabel={t('隐藏')}
        />
      ) : null}
      {waiting.map((b) => {
        if (mineReady.length > 1 && mineReady.includes(b)) return null
        const mine = b.ownerId === me?.id
        const error = states?.[b.id]?.error
        const text = mine
          ? t('请先为 {name} 确认工作区，确认后即可开始工作', { name: b.name })
          : t('等待 {owner} 为 {name} 确认工作区', { owner: b.ownerName, name: b.name })
        return (
          <div key={b.id} data-testid={`ws-banner-${b.id}`}>
            <PinnedBanner
              icon="folder-open"
              title={null}
              text={`${text}${error ? ` · ${error}` : ''}`}
              action={
                mine && b.machineId ? (
                  <Button size="small" variant={primaryVariant} onClick={() => setPicking(b)}>
                    {t('确认工作区')}
                  </Button>
                ) : null
              }
              onClose={() => hide([b])}
              closeLabel={t('隐藏')}
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
