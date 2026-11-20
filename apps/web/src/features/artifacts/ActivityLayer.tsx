import type { ArtifactActivityDto } from '@gonggong/protocol'
import { useEffect, useRef, useState } from 'react'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { Icon } from '../../ui'
import { useActivityOf } from './activity'
import { type CanvasNode, onScreen, type View } from './geometry'
import { focusArtifact, useArtifactEntry } from './store'
import './activity.css'

/** The wipe and the outline flash of screens a run's new head changed. */
const LANDED_MS = 2100

/** Bot names writing each screen. */
function byScreen(activity: ArtifactActivityDto[], name: (botId: string) => string) {
  const out = new Map<string, string[]>()
  for (const a of activity)
    for (const s of a.screens) out.set(s.id, [...(out.get(s.id) ?? []), name(a.botId)])
  return out
}

/** Hide the in-screen badge below this width so it never overflows a tiny overview thumbnail. */
const BADGE_MIN_WIDTH = 90
const IDENTITY_VIEW: View = { x: 0, y: 0, z: 1 }

/**
 * On the canvas overlay in screen space (plan 原型协作 P1): a flowing outline and who is at it on each screen a run is
 * writing; when that run's version becomes the head, its screens get a wipe and a short outline flash.
 */
export function ActivityLayer({
  artifactId,
  nodes,
  view = IDENTITY_VIEW,
}: {
  artifactId: string
  nodes: CanvasNode[]
  view?: View
}) {
  const activity = useActivityOf(artifactId)
  const bots = useWorkspace((s) => s.bots)
  const head = useArtifactEntry(artifactId)?.artifact?.head
  const name = (botId: string) => bots.find((b) => b.id === botId)?.name ?? 'Bot'
  const editing = byScreen(activity, name)
  /** runId → the screens it was last seen writing: kept after the run ends, until its version lands. */
  const seen = useRef(new Map<string, string[]>())
  const [landed, setLanded] = useState<string[]>([])
  for (const a of activity)
    if (a.screens.length)
      seen.current.set(
        a.runId,
        a.screens.map((s) => s.id),
      )
  const headId = head?.id
  const headRun = head?.runId
  const first = useRef(headId)
  useEffect(() => {
    if (!headId || first.current === headId) return
    first.current = headId
    const ids = headRun ? seen.current.get(headRun) : undefined
    if (!ids || !headRun) return
    seen.current.delete(headRun)
    setLanded(ids)
    const timer = setTimeout(() => setLanded([]), LANDED_MS)
    return () => clearTimeout(timer)
  }, [headId, headRun])
  return (
    <>
      {nodes
        .filter((n) => n.kind === 'screen' && (editing.has(n.id) || landed.includes(n.id)))
        .map((n) => {
          const who = editing.get(n.id)
          const rect = onScreen(n, view)
          return (
            <div
              key={n.id}
              className={who ? 'art-activity' : 'art-landed'}
              data-testid={`art-activity-${n.id}`}
              style={rect}
            >
              {who && rect.width >= BADGE_MIN_WIDTH ? (
                <span className="art-activity__who">
                  {t('{name} 正在改', { name: [...new Set(who)].join('、') })}
                </span>
              ) : null}
            </div>
          )
        })}
    </>
  )
}

/** What a run is writing, as a sentence: 正在改 首页、详情 / 正在改全局样式. */
export function activityText(a: Pick<ArtifactActivityDto, 'screens' | 'global'>) {
  const screens = a.screens.map((s) => s.title).join('、')
  return screens
    ? a.global
      ? t('正在改 {screens} 和全局样式', { screens })
      : t('正在改 {screens}', { screens })
    : t('正在改全局样式')
}

/** Beside the canvas's runner: what is being written; a click shows those screens. */
export function ActivityNote({ artifactId }: { artifactId: string }) {
  const activity = useActivityOf(artifactId)
  if (!activity.length) return null
  const screens = activity.flatMap((a) => a.screens)
  const global = activity.some((a) => a.global)
  const text = activityText({
    screens: screens.filter((s, i) => screens.findIndex((x) => x.id === s.id) === i),
    global,
  })
  return (
    <button
      type="button"
      className="art-activity-note"
      data-testid="art-activity-note"
      title={text}
      onClick={() => focusArtifact(artifactId, { screenIds: screens.map((s) => s.id) })}
    >
      <Icon name="pencil" size={11} />
      <span>{text}</span>
    </button>
  )
}
