import { ARTIFACT_BOT_NAMES, type BotDto } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { Icon, MenuButton } from '../../ui'
import '../chat/run-config.css'
import './chips.css'

const storeKey = (artifactId: string) => `gg.canvasBot.${artifactId}`

function stored(artifactId: string) {
  try {
    return localStorage.getItem(storeKey(artifactId))
  } catch {
    return null
  }
}

/** The Bots open for works (ARTIFACT_BOT_NAMES) in the team, whatever the group. */
export function useArtifactBots() {
  const all = useWorkspace((s) => s.bots)
  return ARTIFACT_BOT_NAMES.flatMap((name) => all.filter((b) => b.name === name))
}

const isOnline = (b: BotDto) => b.presence === 'online' || b.presence === 'running'

/** Picks the preferred Bot when present, else prefers an online Bot before falling back to the first option. */
export function pickDefaultBot(options: BotDto[], preferredId?: string | null): BotDto | null {
  if (preferredId) {
    const picked = options.find((b) => b.id === preferredId)
    if (picked) return picked
  }
  return options.find(isOnline) ?? options[0] ?? null
}

const LAST_KEY = 'gg.works.newBot'

/** The Bot last picked on any canvas: a new work starts with it. */
export function lastWorkBot() {
  try {
    return localStorage.getItem(LAST_KEY)
  } catch {
    return null
  }
}

export function rememberCanvasBot(artifactId: string, botId: string) {
  try {
    localStorage.setItem(storeKey(artifactId), botId)
    localStorage.setItem(LAST_KEY, botId)
  } catch {}
}

/**
 * The Bot the canvas's composer sends to: the member's last pick on this artifact, else an online Bot from
 * ARTIFACT_BOT_NAMES (which run there whatever the artifact's group).
 */
export function useCanvasBot(artifactId: string) {
  const options = useArtifactBots()
  const [picked, setPicked] = useState(() => stored(artifactId))
  useEffect(() => {
    setPicked(stored(artifactId))
  }, [artifactId])
  const bot = pickDefaultBot(options, picked)
  const pick = (id: string) => {
    setPicked(id)
    rememberCanvasBot(artifactId, id)
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
  if (!options.length) {
    return (
      <span className="run-config">
        <button
          type="button"
          className="run-config__chip"
          aria-label={t('执行的 Bot')}
          disabled
          title={t('当前团队暂无可用于创作作品的 Bot')}
        >
          <span className="run-config__label">{t('暂无可用 Bot')}</span>
        </button>
      </span>
    )
  }
  const label = bot?.name ?? t('选择 Bot')
  const offline = bot ? !isOnline(bot) : false
  return (
    <span className="run-config">
      <MenuButton
        className="run-config__chip"
        aria-label={t('执行的 Bot')}
        align="end"
        placement="above"
        title={offline ? `${label}（${t('离线')}）` : label}
        items={[
          { header: t('执行的 Bot') },
          ...options.map((b) => ({
            label: b.name,
            value: b.id,
            checked: b.id === bot?.id,
            radio: true,
            shortcut: isOnline(b) ? undefined : t('离线'),
          })),
        ]}
        onSelect={onPick}
      >
        {offline ? <span className="art-bot-dot--offline" role="img" aria-label={t('离线')} /> : null}
        <span className="run-config__label">{label}</span>
        <Icon name="chevron-updown" size={10} weight={2.2} />
      </MenuButton>
    </span>
  )
}
