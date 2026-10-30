import { t } from '../../i18n'
import { Button, Icon, type IconName } from '../../ui'
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

/** On a run's card: the artifact versions it made, the screens it changed, and a way to look at them. */
export function RunArtifactsLine({ artifacts }: { artifacts: RunArtifact[] }) {
  return (
    <>
      {artifacts.map((a) => (
        <span key={a.versionId} className="art-run" data-testid="run-artifact">
          <Icon name="grid" size={12} className="art-run__icon" />
          <span className="art-run__text" title={runText(a)}>
            {runText(a)}
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

const runText = (a: RunArtifact) =>
  [
    a.title,
    `v${a.n}`,
    a.changedScreens.length
      ? t('改了 {screens}', { screens: a.changedScreens.map((s) => s.title).join('、') })
      : '',
  ]
    .filter(Boolean)
    .join(' · ')
