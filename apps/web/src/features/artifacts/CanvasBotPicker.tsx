import type { BotDto, GroupDto } from '@gonggong/protocol'
import { useState } from 'react'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { Icon, MenuButton } from '../../ui'
import '../chat/run-config.css'

/** The AIs open for editing works, whatever the group; only these are offered under the canvas's input. */
export const ARTIFACT_BOT_NAMES = ['工字君', '姜维川的 Claude Code']

const storeKey = (artifactId: string) => `gg.canvasBot.${artifactId}`

function stored(artifactId: string) {
  try {
    return localStorage.getItem(storeKey(artifactId))
  } catch {
    return null
  }
}

/**
 * The AI the canvas's composer sends to: the member's last pick on this artifact, else the artifact's bot. Only
 * bots of the artifact's group can run there for now; the others are listed but cannot be picked.
 */
export function useCanvasBot(group: GroupDto, artifactId: string, artifactBotId: string | null) {
  const all = useWorkspace((s) => s.bots)
  const fixed = ARTIFACT_BOT_NAMES.flatMap((name) => all.filter((b) => b.name === name))
  const own = all.find((b) => b.id === artifactBotId)
  const options = fixed.length ? fixed : own ? [own] : []
  const usable = (b: BotDto | undefined): b is BotDto => !!b && group.botIds.includes(b.id)
  const [picked, setPicked] = useState(() => stored(artifactId))
  const bot =
    [options.find((b) => b.id === picked), options.find((b) => b.id === artifactBotId), ...options].find(
      usable,
    ) ?? null
  const pick = (id: string) => {
    setPicked(id)
    try {
      localStorage.setItem(storeKey(artifactId), id)
    } catch {}
  }
  return { bot, options, usable, pick }
}

export function CanvasBotPicker({
  bot,
  options,
  usable,
  onPick,
}: {
  bot: BotDto | null
  options: BotDto[]
  usable: (b: BotDto) => boolean
  onPick: (id: string) => void
}) {
  const label = bot?.name ?? t('选择 AI')
  return (
    <span className="run-config">
      <MenuButton
        className="run-config__chip"
        aria-label={t('执行的 AI')}
        align="end"
        placement="above"
        title={label}
        items={[
          { header: t('执行的 AI') },
          ...options.map((b) => ({
            label: b.name,
            value: b.id,
            checked: b.id === bot?.id,
            radio: true,
            ...(usable(b) ? {} : { disabled: true, title: t('不在作品所在群，暂不能使用') }),
          })),
        ]}
        onSelect={onPick}
      >
        <span className="run-config__label">{label}</span>
        <Icon name="chevron-updown" size={10} weight={2.2} />
      </MenuButton>
    </span>
  )
}
