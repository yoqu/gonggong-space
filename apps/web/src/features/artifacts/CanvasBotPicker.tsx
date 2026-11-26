import { ARTIFACT_BOT_NAMES, type BotDto } from '@gonggong/protocol'
import { useState } from 'react'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { Icon, MenuButton } from '../../ui'
import '../chat/run-config.css'

const storeKey = (artifactId: string) => `gg.canvasBot.${artifactId}`

function stored(artifactId: string) {
  try {
    return localStorage.getItem(storeKey(artifactId))
  } catch {
    return null
  }
}

/**
 * The AI the canvas's composer sends to: the member's last pick on this artifact, else the first of the AIs open for
 * works (ARTIFACT_BOT_NAMES), which run there whatever the artifact's group.
 */
export function useCanvasBot(artifactId: string) {
  const all = useWorkspace((s) => s.bots)
  const options = ARTIFACT_BOT_NAMES.flatMap((name) => all.filter((b) => b.name === name))
  const [picked, setPicked] = useState(() => stored(artifactId))
  const bot = options.find((b) => b.id === picked) ?? options[0] ?? null
  const pick = (id: string) => {
    setPicked(id)
    try {
      localStorage.setItem(storeKey(artifactId), id)
    } catch {}
  }
  return { bot, options, pick }
}

export function CanvasBotPicker({
  bot,
  options,
  onPick,
}: {
  bot: BotDto | null
  options: BotDto[]
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
          ...options.map((b) => ({ label: b.name, value: b.id, checked: b.id === bot?.id, radio: true })),
        ]}
        onSelect={onPick}
      >
        <span className="run-config__label">{label}</span>
        <Icon name="chevron-updown" size={10} weight={2.2} />
      </MenuButton>
    </span>
  )
}
