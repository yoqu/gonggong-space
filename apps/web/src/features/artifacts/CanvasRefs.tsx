import { t } from '../../i18n'
import { Button, Icon } from '../../ui'
import type { MessageCanvas, RunArtifact } from './runContext'
import { focusArtifact } from './store'
import './chips.css'

/** Under a sent message: what the canvas had selected; a click opens the artifact on those screens. */
export function MessageCanvasChips({ canvas }: { canvas: MessageCanvas }) {
  const screenOf = (file: string) => canvas.screens.find((s) => file.endsWith(`/${s.id}.html`))
  const open = (screenIds: string[]) => focusArtifact(canvas.artifactId, { screenIds, title: canvas.title })
  const items = [
    ...canvas.screens.map((s) => ({
      key: `screen:${s.id}`,
      label: `${canvas.title} · ${s.title}`,
      icon: 'smartphone' as const,
      ids: [s.id],
    })),
    ...canvas.elements.map((e) => {
      const s = screenOf(e.file)
      return {
        key: `el:${e.file}#${e.ggId}`,
        label: `${s?.title ?? canvas.title} › ${e.label}`,
        icon: 'cursor' as const,
        ids: s ? [s.id] : [],
      }
    }),
  ]
  if (!items.length) items.push({ key: 'artifact', label: canvas.title, icon: 'smartphone', ids: [] })
  return (
    <div className="art-chips art-chips--sent" data-testid="message-canvas">
      {items.map((i) => (
        <button
          key={i.key}
          type="button"
          className="art-chip art-chip--link"
          title={t('在画布中查看')}
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
          <span className="art-run__text">
            {[
              a.title,
              `v${a.n}`,
              a.changedScreens.length
                ? t('改了 {screens}', { screens: a.changedScreens.map((s) => s.title).join('、') })
                : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
          <Button
            size="small"
            variant="plain"
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
