import { t } from '../../i18n'
import { Button, Icon, type IconName } from '../../ui'
import { activityText } from './ActivityLayer'
import { useRunActivity } from './activity'
import { refNodeId } from './geometry'
import type { MessageCanvas, RunArtifact } from './runContext'
import { focusArtifact } from './store'
import './chips.css'

const IMAGE = /\.(png|jpe?g|gif|webp|svg)$/i

/**
 * Under a sent message: what the canvas had selected, and the reference files sent along; a click opens the artifact
 * on those screens (or that reference). Repeats (several notes on one element) show once.
 */
export function MessageCanvasChips({ canvas }: { canvas: MessageCanvas }) {
  const screenOf = (file: string) => canvas.screens.find((s) => file.endsWith(`/${s.id}.html`))
  const open = (screenIds: string[]) => focusArtifact(canvas.artifactId, { screenIds, title: canvas.title })
  const items = [
    ...canvas.screens.map((s) => ({
      key: `screen:${s.id}`,
      label: `${canvas.title} · ${s.title}`,
      icon: 'smartphone' as IconName,
      ids: [s.id],
    })),
    ...canvas.elements.map((e) => {
      const s = screenOf(e.file)
      return {
        key: `el:${e.file}#${e.ggId}`,
        label: `${s?.title ?? canvas.title} › ${e.label}`,
        icon: 'cursor' as IconName,
        ids: s ? [s.id] : [],
      }
    }),
    ...(canvas.refs ?? []).map((r) => ({
      key: `ref:${r.id}`,
      label: t('参考 · {name}', { name: r.title }),
      icon: (IMAGE.test(r.title) ? 'image' : 'doc-text') as IconName,
      ids: [refNodeId(r.id)],
    })),
  ].filter((i, n, all) => all.findIndex((x) => x.key === i.key) === n)
  if (!items.some((i) => !i.key.startsWith('ref:')))
    items.unshift({ key: 'artifact', label: canvas.title, icon: 'smartphone', ids: [] })
  return (
    <div className="art-chips art-chips--sent" data-testid="message-canvas">
      {items.map((i) => (
        <button
          key={i.key}
          type="button"
          className="art-chip art-chip--link"
          title={`${i.label} · ${t('在画布中查看')}`}
          onClick={() => open(i.ids)}
        >
          <Icon name={i.icon} size={13} className="art-chip__icon" />
          <span className="art-chip__text">{i.label}</span>
        </button>
      ))}
    </div>
  )
}

/**
 * On a run's card: what it is writing now (`runId`, plan 原型协作 P1), the artifact versions it made, the screens it
 * changed, and a way to look at them.
 */
export function RunArtifactsLine({ artifacts, runId = '' }: { artifacts: RunArtifact[]; runId?: string }) {
  const writing = useRunActivity(runId)
  return (
    <>
      {writing.map((a) => (
        <button
          key={`live:${a.artifactId}`}
          type="button"
          className="art-run art-run--live"
          data-testid="run-artifact-activity"
          onClick={() =>
            focusArtifact(a.artifactId, { screenIds: a.screens.map((s) => s.id), title: a.title })
          }
        >
          <Icon name="pencil" size={12} className="art-run__icon" />
          <span className="art-run__text">{`${a.title} · ${activityText(a)}`}</span>
        </button>
      ))}
      {artifacts.map((a) => (
        <span key={a.versionId} className="art-run" data-testid="run-artifact">
          <Icon name="grid" size={12} className="art-run__icon" />
          <span className="art-run__text" title={runText(a)}>
            {runText(a, true)}
          </span>
          <Button
            size="small"
            variant="plain"
            className="art-run__open"
            onClick={() =>
              focusArtifact(a.artifactId, {
                screenIds: a.changedScreens.map((s) => s.id),
                versionId: a.versionId,
                title: a.title,
              })
            }
          >
            {t('在画布中查看')}
          </Button>
        </span>
      ))}
    </>
  )
}

/** Screens a run line names before it says just how many (all of them on hover). */
const NAMED_SCREENS = 2

const runText = (a: RunArtifact, short = false) =>
  [
    a.title,
    `v${a.n}`,
    a.candidate ? t('存为候选，未成为当前版本') : '',
    !a.changedScreens.length
      ? ''
      : short && a.changedScreens.length > NAMED_SCREENS
        ? t('改了 {n} 屏', { n: a.changedScreens.length })
        : t('改了 {screens}', { screens: a.changedScreens.map((s) => s.title).join('、') }),
  ]
    .filter(Boolean)
    .join(' · ')
