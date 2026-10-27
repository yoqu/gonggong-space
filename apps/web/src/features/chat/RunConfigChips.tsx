import {
  agentConfigLabel,
  type BotDto,
  fitEffort,
  type GroupDto,
  parseMentions,
  type RunConfigPick,
} from '@gonggong/protocol'
import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { Icon, MenuButton, type MenuItem } from '../../ui'
import { effortOptions, modelOptions, useBotCatalog, withModel } from '../bots/AgentConfig'
import './run-config.css'

export type Picks = Record<string, RunConfigPick>

const READ_ONLY = t('只有 Bot 主人或群管理员可以切换')

/** Bots mentioned in `draft`, in order of appearance. */
export function mentionedBots(draft: string, bots: BotDto[]) {
  const byId = new Map(bots.map((bot) => [bot.id, bot]))
  return parseMentions(draft, bots).flatMap((id) => {
    const bot = byId.get(id)
    return bot ? [bot] : []
  })
}

/** Plan M1: the bot owner or a group admin; anyone in a DM. */
export function useCanConfigure(group: GroupDto | undefined) {
  const me = useSession((s) => s.user)
  const admin = group?.kind === 'dm' || !!group?.members.find((m) => m.userId === me?.id)?.isAdmin
  return (bot: BotDto) => admin || bot.ownerId === me?.id
}

/**
 * Model and thought level of each mentioned bot, under the input (plan M2): a pick applies to this message only;
 * 设为本群默认 saves it for the group.
 */
export function RunConfigChips({
  group,
  bots,
  picks,
  onChange,
}: {
  group: GroupDto
  bots: BotDto[]
  picks: Picks
  onChange: (picks: Picks) => void
}) {
  const canConfigure = useCanConfigure(group)
  const set = (botId: string, next: Picks[string] | null) => {
    const rest = { ...picks }
    delete rest[botId]
    onChange(next ? { ...rest, [botId]: next } : rest)
  }
  return (
    <span className="run-config">
      {bots.map((bot) => (
        <RunConfigChip
          key={bot.id}
          group={group}
          bot={bot}
          pick={picks[bot.id]}
          editable={canConfigure(bot)}
          onPick={(next) => set(bot.id, next)}
        />
      ))}
    </span>
  )
}

/**
 * The picks offered are those of the bot's next session, asked of its machine (its provider's models). A message
 * pick may be saved as the group default; a scheduled task keeps its own.
 */
export function RunConfigChip({
  group,
  bot,
  pick,
  editable,
  onPick,
  scope = 'message',
}: {
  group: GroupDto
  bot: BotDto
  pick: RunConfigPick | undefined
  editable: boolean
  onPick: (next: RunConfigPick | null) => void
  scope?: 'message' | 'schedule'
}) {
  const message = scope === 'message'
  const state = useWorkspace((s) => s.botStates[group.id]?.[bot.id])
  const live = useBotCatalog(bot.id)
  const catalog = live ? live.catalog : bot.catalog
  const saved = { model: state?.model ?? bot.model, effort: state?.effort ?? bot.effort }
  const model = pick?.model !== undefined ? pick.model : saved.model
  const effort = fitEffort(catalog, model, pick?.effort !== undefined ? pick.effort : saved.effort)
  const label = agentConfigLabel(catalog, model ?? catalog?.current ?? null, effort)
  const text = message ? `${bot.name} · ${label}` : label
  const name = t('{name} 的模型与推理强度', { name: bot.name })
  if (!editable || !live)
    return (
      <MenuButton
        className="run-config__chip"
        aria-label={name}
        title={
          !editable ? READ_ONLY : !live ? t('正在读取可选模型…') : (live.error ?? t('机器尚未上报可选模型'))
        }
        disabled
        items={[]}
        onSelect={() => {}}
      >
        <span className="run-config__label">{text}</span>
      </MenuButton>
    )
  const available = live.catalog
  const set = (next: RunConfigPick) => {
    const same =
      (next.model === undefined || next.model === saved.model) &&
      (next.effort === undefined || next.effort === saved.effort)
    onPick(same ? null : next)
  }
  const save = () =>
    api
      .put(`/groups/${group.id}/bots/${bot.id}/config`, { model, effort })
      .then(() => set({}))
      .catch(toastError)
  const efforts = effortOptions(available, model)
  const items: MenuItem[] = [
    { header: t('模型') },
    ...(available ? modelOptions(available, model) : []).map((o) => ({
      label: o.label,
      value: `m:${o.value}`,
      checked: (model ?? '') === o.value,
    })),
    ...(!available
      ? [{ label: live.error ?? t('机器尚未上报可选模型'), value: 'unavailable', disabled: true }]
      : []),
    { label: t('刷新模型'), value: 'refresh', disabled: live.refresh.busy },
    ...(efforts.length
      ? [
          { separator: true as const },
          { header: t('推理强度') },
          ...efforts
            .slice(1)
            .map((o) => ({ label: o.label, value: `e:${o.value}`, checked: effort === o.value })),
        ]
      : []),
    ...(pick && message ? [{ separator: true as const }, { label: t('设为本群默认'), value: 'save' }] : []),
    ...(pick && !message ? [{ separator: true as const }, { label: t('跟随默认'), value: 'reset' }] : []),
  ]
  return (
    <MenuButton
      className="run-config__chip"
      aria-label={name}
      align="end"
      placement={message ? 'above' : undefined}
      title={text}
      items={items}
      onSelect={(v) => {
        if (v === 'refresh') return void live.refresh.run()
        if (v === 'save') return void save()
        if (v === 'reset') return onPick(null)
        if (v.startsWith('m:')) {
          const next = withModel(available, pick?.effort ?? null, v.slice(2) || null)
          return set({ model: next.model, ...(next.effort && { effort: next.effort }) })
        }
        set({ ...pick, effort: v.slice(2) })
      }}
    >
      <span className="run-config__label">{text}</span>
      {pick ? <span className="run-config__once">{message ? t('仅本条') : t('本任务')}</span> : null}
      <Icon name="chevron-updown" size={10} weight={2.2} />
    </MenuButton>
  )
}
