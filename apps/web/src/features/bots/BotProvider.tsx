import {
  type AgentCatalog,
  type BotDto,
  INHERIT_PROVIDER,
  OFFICIAL_PROVIDER,
  type ProviderStoreView,
  type UserDto,
} from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { FormRow, PopUpButton, toast } from '../../ui'
import {
  botProviderOptions,
  effectiveProvider,
  providerBlocked,
  useProviderSwitch,
} from '../machines/providers'
import { useBotCatalog } from './AgentConfig'

/**
 * 供应商 of a bot (design §4.2): inherit the machine default, official login or one of its machine's providers of
 * the same agent. Read and set live on the machine, so only its owner (who must own the bot too) can, while online.
 * `onCatalog` gets the models a new session of the bot may pick, null until known.
 */
export function BotProviderField({
  bot,
  me,
  onCatalog,
}: {
  bot: BotDto
  me: UserDto
  onCatalog: (catalog: AgentCatalog | null) => void
}) {
  const machine = useWorkspace((s) => s.machines.find((m) => m.id === bot.machineId))
  const [view, setView] = useState<ProviderStoreView | null>(null)
  const reason = providerBlocked(me.id, bot.ownerId, machine)
  const base = `/machines/${bot.machineId}/providers`

  useEffect(() => {
    if (reason) return
    api.get<ProviderStoreView>(base).then(setView, (e) => toastError(e))
  }, [base, reason])

  const effective = view && !reason ? effectiveProvider(view, bot.agentKind, bot.id) : OFFICIAL_PROVIDER
  const live = useBotCatalog(bot.id, effective)
  useEffect(() => onCatalog(live?.catalog ?? null), [live, onCatalog])

  const switcher = useProviderSwitch(async ({ choice }) => {
    try {
      setView(await api.put<ProviderStoreView>(`/bots/${bot.id}/provider`, { choice }))
      toast({ type: 'success', message: t('{name} 的供应商已切换，新会话生效', { name: bot.name }) })
    } catch (e) {
      toastError(e)
    }
  })

  const options = view ? botProviderOptions(view, bot.agentKind) : []
  return (
    <FormRow
      label={t('供应商')}
      hint={reason ?? t('只保存在 Bot 所在的机器上；进行中的会话开启新会话后才切换')}
    >
      <PopUpButton
        aria-label={t('供应商')}
        value={view ? (view.bots[bot.id] ?? INHERIT_PROVIDER) : null}
        placeholder={reason ? '--' : t('读取中…')}
        disabled={!!reason || !view}
        options={options}
        onChange={(choice) => view && switcher.request({ agent: bot.agentKind, choice, botId: bot.id }, view)}
      />
      {switcher.dialog}
    </FormRow>
  )
}
