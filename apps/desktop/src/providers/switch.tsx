import type { AgentKind } from '@gonggong/protocol'
import { AlertDialog } from '@web/ui'
import { useState } from 'react'
import { t } from '../i18n'
import { type Impact, ipc, type ProviderChoice } from '../ipc'
import { fail } from '../lib/ui'

interface Pending {
  agent: AgentKind
  choice: ProviderChoice
  bot?: string
  impact: Impact[]
}

/** 「N 个群的会话仍在使用 X，开启新会话后才会切换到 Y」, one line per (X, Y). */
export function impactLines(impact: Impact[]) {
  const by = new Map<string, Impact[]>()
  for (const i of impact) {
    const key = `${i.from}\u0000${i.to}`
    by.set(key, [...(by.get(key) ?? []), i])
  }
  return [...by.values()].map((list) => ({
    text: t('{n} 个群的会话仍在使用 {from}，开启新会话后才会切换到 {to}', {
      n: list.length,
      from: list[0]?.from ?? '',
      to: list[0]?.to ?? '',
    }),
    groups: list.map((i) => t('{group}（{bot}）', { group: i.group, bot: i.bot })),
  }))
}

/**
 * Switching a machine default or a bot's provider never touches running sessions (§4.3): when some group's session
 * keeps the old one, say so and ask first.
 */
export function useProviderSwitch(onDone: () => void) {
  const [pending, setPending] = useState<Pending | null>(null)
  const [open, setOpen] = useState(false)

  const apply = async ({ agent, choice, bot }: Omit<Pending, 'impact'>) => {
    try {
      await ipc.chooseProvider(agent, choice, bot)
      onDone()
    } catch (e) {
      fail(e)
    }
  }

  const request = async (agent: AgentKind, choice: ProviderChoice, bot?: string) => {
    let impact: Impact[]
    try {
      impact = await ipc.providerImpact(agent, choice, bot)
    } catch (e) {
      fail(e)
      return
    }
    if (!impact.length) return apply({ agent, choice, bot })
    setPending({ agent, choice, bot, impact })
    setOpen(true)
  }

  const lines = pending ? impactLines(pending.impact) : []
  const dialog = (
    <AlertDialog
      open={open}
      onClose={() => setOpen(false)}
      title={t('要让新会话改用 {to} 吗？', { to: pending?.impact[0]?.to ?? '' })}
      message={t('进行中的会话不受影响，在群里开启新会话后才会切换。')}
      detail={lines.map((l) => (
        <div key={l.text}>
          <p>{t('{text}：', { text: l.text })}</p>
          <ul className="ui-consequences">
            {l.groups.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </div>
      ))}
      actions={[
        { label: t('取消'), onClick: () => setOpen(false) },
        {
          label: t('切换'),
          variant: 'primary',
          onClick: () => {
            setOpen(false)
            if (pending) apply(pending)
          },
        },
      ]}
    />
  )
  return { request, dialog }
}
