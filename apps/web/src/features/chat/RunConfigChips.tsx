import {
  agentConfigLabel,
  type BotDto,
  fitEffort,
  type GroupDto,
  type RunConfigPick,
} from '@gonggong/protocol'
import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { api } from '../../lib/api'
import { Icon, MenuButton, type MenuItem, toast } from '../../ui'
import { effortOptions, modelOptions, useBotCatalog, withModel } from '../bots/AgentConfig'

export type Picks = Record<string, RunConfigPick>

const READ_ONLY = '只有 Bot 主人或群管理员可以切换'

/** Bots mentioned in `draft`, in order of appearance. */
export function mentionedBots(draft: string, bots: BotDto[]) {
  return bots
    .map((b) => ({ b, at: draft.indexOf(`@${b.name}`) }))
    .filter((x) => x.at >= 0)
    .sort((x, y) => x.at - y.at)
    .map((x) => x.b)
}

/** Plan M1: the bot owner or a group admin; anyone in a DM. */
function useCanConfigure(group: GroupDto) {
  const me = useSession((s) => s.user)
  const admin = group.kind === 'dm' || !!group.members.find((m) => m.userId === me?.id)?.isAdmin
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

/** The picks offered are those of the bot's next session, asked of its machine (its provider's models). */
function RunConfigChip({
  group,
  bot,
  pick,
  editable,
  onPick,
}: {
  group: GroupDto
  bot: BotDto
  pick: RunConfigPick | undefined
  editable: boolean
  onPick: (next: RunConfigPick | null) => void
}) {
  const state = useWorkspace((s) => s.botStates[group.id]?.[bot.id])
  const live = useBotCatalog(bot.id)
  const catalog = live ? live.catalog : bot.catalog
  const saved = { model: state?.model ?? bot.model, effort: state?.effort ?? bot.effort }
  const model = pick?.model !== undefined ? pick.model : saved.model
  const effort = fitEffort(catalog, model, pick?.effort !== undefined ? pick.effort : saved.effort)
  const label = agentConfigLabel(catalog, model ?? catalog?.current ?? null, effort)
  const text = `${bot.name} · ${label}`
  const name = `${bot.name} 的模型与推理强度`
  if (!editable || !live?.catalog)
    return (
      <MenuButton
        className="run-config__chip"
        aria-label={name}
        title={!editable ? READ_ONLY : !live ? '正在读取可选模型…' : (live.error ?? '机器尚未上报可选模型')}
        disabled
        items={[]}
        onSelect={() => {}}
      >
        {text}
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
      .catch((e: Error) => toast({ type: 'error', message: e.message }))
  const efforts = effortOptions(available, model)
  const items: MenuItem[] = [
    { header: '模型' },
    ...modelOptions(available, model).map((o) => ({
      label: o.label,
      value: `m:${o.value}`,
      checked: (model ?? '') === o.value,
    })),
    ...(efforts.length
      ? [
          { separator: true as const },
          { header: '推理强度' },
          ...efforts
            .slice(1)
            .map((o) => ({ label: o.label, value: `e:${o.value}`, checked: effort === o.value })),
        ]
      : []),
    ...(pick ? [{ separator: true as const }, { label: '设为本群默认', value: 'save' }] : []),
  ]
  return (
    <MenuButton
      className="run-config__chip"
      aria-label={name}
      align="end"
      placement="above"
      items={items}
      onSelect={(v) => {
        if (v === 'save') return void save()
        if (v.startsWith('m:')) {
          const next = withModel(available, pick?.effort ?? null, v.slice(2) || null)
          return set({ model: next.model, ...(next.effort && { effort: next.effort }) })
        }
        set({ ...pick, effort: v.slice(2) })
      }}
    >
      {text}
      {pick ? <span className="run-config__once">仅本条</span> : null}
      <Icon name="chevron-updown" size={10} weight={2.2} />
    </MenuButton>
  )
}
