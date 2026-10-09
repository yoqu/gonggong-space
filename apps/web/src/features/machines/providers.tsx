import {
  type AgentKind,
  INHERIT_PROVIDER,
  type MachineDto,
  OFFICIAL_PROVIDER,
  type ProviderStoreView,
} from '@gonggong/protocol'
import { useState } from 'react'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { AlertDialog } from '../../ui'

export const OFFICIAL_NAME = t('官方登录')

type Session = ProviderStoreView['sessions'][number]

export const providerName = (view: ProviderStoreView, id: string) =>
  id === OFFICIAL_PROVIDER
    ? OFFICIAL_NAME
    : (view.providers.find((p) => p.id === id)?.name ?? t('已删除的供应商'))

/** What a new session of `botId` uses: its own choice, else the machine default of its agent (§4.2). */
export const effectiveProvider = (view: ProviderStoreView, agent: AgentKind, botId: string) =>
  view.bots[botId] ?? view.machine[agent] ?? OFFICIAL_PROVIDER

/** Why the bot's provider cannot be set here (§5: its owner, on their own online machine), null when it can. */
export const providerBlocked = (meId: string, botOwnerId: string, machine: MachineDto | undefined) =>
  botOwnerId !== meId
    ? t('只有 Bot 主人可以设置其供应商')
    : machine?.ownerId !== meId
      ? t('只能在自己的机器上设置 Bot 的供应商')
      : !machine.online
        ? t('机器离线，上线后才能设置')
        : machine.features.includes('providers')
          ? null
          : t('请先升级该机器的 daemon')

/** 继承机器（当前：X） / 官方登录 / the machine's providers of `agent`. */
export const botProviderOptions = (view: ProviderStoreView, agent: AgentKind) => [
  {
    value: INHERIT_PROVIDER,
    label: t('继承机器（当前：{name}）', {
      name: providerName(view, view.machine[agent] ?? OFFICIAL_PROVIDER),
    }),
  },
  { value: OFFICIAL_PROVIDER, label: OFFICIAL_NAME },
  ...view.providers.filter((p) => p.agent === agent).map((p) => ({ value: p.id, label: p.name })),
]

/** A machine default (no `botId`) or a bot's choice (`inherit` drops it). */
export interface ProviderChange {
  agent: AgentKind
  choice: string
  botId?: string
}

function applied(view: ProviderStoreView, { agent, choice, botId }: ProviderChange): ProviderStoreView {
  if (!botId) return { ...view, machine: { ...view.machine, [agent]: choice } }
  const { [botId]: _, ...bots } = view.bots
  return { ...view, bots: choice === INHERIT_PROVIDER ? bots : { ...bots, [botId]: choice } }
}

/** `前端组（小王的 Claude）`, from what this member can see. */
const sessionLabel = (s: Session) => {
  const { groups, bots } = useWorkspace.getState()
  const group = groups.find((g) => g.id === s.groupId)?.name ?? t('其他群')
  return t('{group}（{bot}）', { group, bot: bots.find((b) => b.id === s.botId)?.name ?? 'Bot' })
}

export interface SessionLine {
  text: string
  groups: string[]
}

/**
 * Sessions a change leaves on their pinned provider while new ones would switch (§4.3), one line per (X, Y):
 * 「N 个群的会话仍在使用 X，开启新会话后才会切换到 Y」.
 */
export function switchLines(view: ProviderStoreView, change: ProviderChange): SessionLine[] {
  const after = applied(view, change)
  const by = new Map<string, Session[]>()
  for (const s of view.sessions) {
    const next = effectiveProvider(after, s.agent, s.botId)
    if (s.agent !== change.agent || next === effectiveProvider(view, s.agent, s.botId) || next === s.provider)
      continue
    const key = `${s.provider}\u0000${next}`
    by.set(key, [...(by.get(key) ?? []), s])
  }
  return [...by.entries()].map(([key, list]) => {
    const [from = '', to = ''] = key.split('\u0000')
    return {
      text: t('{n} 个群的会话仍在使用 {from}，开启新会话后才会切换到 {to}', {
        n: list.length,
        from: providerName(view, from),
        to: providerName(after, to),
      }),
      groups: list.map(sessionLabel),
    }
  })
}

/** Sessions pinned to provider `id`: deleting it makes their next turn start a new session. */
export function removalLines(view: ProviderStoreView, id: string): SessionLine[] {
  const list = view.sessions.filter((s) => s.provider === id)
  if (!list.length) return []
  return [
    {
      text: t('{n} 个群的会话正在使用 {name}，删除后它们下一轮会自动开启新会话', {
        n: list.length,
        name: providerName(view, id),
      }),
      groups: list.map(sessionLabel),
    },
  ]
}

export function SessionLines({ lines }: { lines: SessionLine[] }) {
  return lines.map((l) => (
    <div key={l.text}>
      <p>{t('{text}：', { text: l.text })}</p>
      <ul className="ui-consequences">
        {l.groups.map((g) => (
          <li key={g}>{g}</li>
        ))}
      </ul>
    </div>
  ))
}

/**
 * Switching a machine default or a bot's provider never touches running sessions (§4.3): when some group's session
 * keeps the old one, say so and ask first. `request` takes the view the change applies to.
 */
export function useProviderSwitch(apply: (change: ProviderChange) => Promise<void>) {
  const [pending, setPending] = useState<{ change: ProviderChange; lines: SessionLine[]; to: string } | null>(
    null,
  )
  const [open, setOpen] = useState(false)

  const request = (change: ProviderChange, view: ProviderStoreView) => {
    const lines = switchLines(view, change)
    if (!lines.length) return void apply(change)
    const to = providerName(view, effectiveProvider(applied(view, change), change.agent, change.botId ?? ''))
    setPending({ change, lines, to })
    setOpen(true)
  }

  const dialog = (
    <AlertDialog
      open={open}
      onClose={() => setOpen(false)}
      title={t('要让新会话改用 {name} 吗？', { name: pending?.to ?? '' })}
      message={t('进行中的会话不受影响，在群里开启新会话后才会切换。')}
      detail={pending ? <SessionLines lines={pending.lines} /> : null}
      actions={[
        { label: t('取消'), onClick: () => setOpen(false) },
        {
          label: t('切换'),
          variant: 'primary',
          onClick: () => {
            setOpen(false)
            if (pending) void apply(pending.change)
          },
        },
      ]}
    />
  )
  return { request, dialog }
}
