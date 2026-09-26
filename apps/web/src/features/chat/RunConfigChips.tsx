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
import { effortOptions, modelOptions, withModel } from '../bots/AgentConfig'

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
  const states = useWorkspace((s) => s.botStates[group.id])
  const canConfigure = useCanConfigure(group)
  return (
    <span className="run-config">
      {bots.map((bot) => {
        const catalog = bot.catalog
        const saved = {
          model: states?.[bot.id]?.model ?? bot.model,
          effort: states?.[bot.id]?.effort ?? bot.effort,
        }
        const pick = picks[bot.id]
        const model = pick?.model !== undefined ? pick.model : saved.model
        const effort = fitEffort(catalog, model, pick?.effort !== undefined ? pick.effort : saved.effort)
        const label = agentConfigLabel(catalog, model ?? catalog?.current ?? null, effort)
        const text = `${bot.name} · ${label}`
        const name = `${bot.name} 的模型与推理强度`
        if (!canConfigure(bot) || !catalog)
          return (
            <MenuButton
              key={bot.id}
              className="run-config__chip"
              aria-label={name}
              title={catalog ? READ_ONLY : '机器尚未上报可选模型'}
              disabled
              items={[]}
              onSelect={() => {}}
            >
              {text}
            </MenuButton>
          )
        const set = (next: RunConfigPick) => {
          const rest = { ...picks }
          delete rest[bot.id]
          const same =
            (next.model === undefined || next.model === saved.model) &&
            (next.effort === undefined || next.effort === saved.effort)
          onChange(same ? rest : { ...rest, [bot.id]: next })
        }
        const save = () =>
          api
            .put(`/groups/${group.id}/bots/${bot.id}/config`, { model, effort })
            .then(() => set({}))
            .catch((e: Error) => toast({ type: 'error', message: e.message }))
        const efforts = effortOptions(catalog, model)
        const items: MenuItem[] = [
          { header: '模型' },
          ...modelOptions(catalog, model).map((o) => ({
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
            key={bot.id}
            className="run-config__chip"
            aria-label={name}
            align="end"
            placement="above"
            items={items}
            onSelect={(v) => {
              if (v === 'save') return void save()
              if (v.startsWith('m:')) {
                const next = withModel(catalog, pick?.effort ?? null, v.slice(2) || null)
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
      })}
    </span>
  )
}
