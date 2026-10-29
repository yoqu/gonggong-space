import type { ReactNode } from 'react'
import { t } from '../../i18n'
import { ago } from '../../lib/time'
import { Button, CloseButton, EmptyState, Icon } from '../../ui'
import type { CanvasNode } from './geometry'
import { useScreenNotes } from './notes'

/** A panel docked to the right of the canvas (Stitch's View Details, Favourites, DESIGN.md). */
export function Panel({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  return (
    <aside className="art-panel" aria-label={title}>
      <header className="art-panel__head">
        <h3>{title}</h3>
        <CloseButton onClick={onClose} />
      </header>
      <div className="art-panel__body">{children}</div>
    </aside>
  )
}

/** View Details (I): what the screen is, its size, its design system, its source and where it comes from. */
export function DetailsPanel({
  artifactId,
  versionId,
  node,
  thumbnailUrl,
  hasSystem,
  onCode,
  onDesignSystem,
  onClose,
}: {
  artifactId: string
  versionId: string
  node: CanvasNode
  thumbnailUrl: string | null
  hasSystem: boolean
  onCode: () => void
  onDesignSystem: () => void
  onClose: () => void
}) {
  const { origin, note } = useScreenNotes(artifactId, versionId, node)
  return (
    <Panel title={node.title} onClose={onClose}>
      <div className="art-panel__shot">
        {thumbnailUrl ? <img src={thumbnailUrl} alt="" /> : <Icon name="smartphone" size={28} />}
      </div>
      <h4 className="art-panel__label">{t('属性')}</h4>
      <dl className="art-props">
        <dt>{t('类型')}</dt>
        <dd>{t('设计屏幕')}</dd>
        <dt>{t('尺寸')}</dt>
        <dd data-testid="art-details-size">{`${node.w} x ${node.h}`}</dd>
        <dt>{t('设计系统')}</dt>
        <dd>
          {hasSystem ? (
            <Button size="small" variant="plain" icon="palette" onClick={onDesignSystem}>
              tokens.css
            </Button>
          ) : (
            '—'
          )}
        </dd>
        <dt>{t('源码')}</dt>
        <dd>
          <Button size="small" variant="plain" icon="doc-code" onClick={onCode}>
            {t('查看代码')}
          </Button>
        </dd>
        <dt>{t('文件')}</dt>
        <dd>
          <code>{node.file}</code>
        </dd>
        {origin ? (
          <>
            <dt>{t('来源版本')}</dt>
            <dd data-testid="art-details-origin">
              {[`v${origin.n}`, origin.authorName, ago(origin.createdAt)].filter(Boolean).join(' · ')}
            </dd>
          </>
        ) : null}
      </dl>
      {note ? (
        <>
          <h4 className="art-panel__label">{t('设计说明')}</h4>
          <p className="art-panel__note" data-testid="art-details-note">
            {note}
          </p>
        </>
      ) : null}
    </Panel>
  )
}

export function FavouritesPanel({
  screens,
  onPick,
  onClose,
}: {
  screens: CanvasNode[]
  onPick: (id: string) => void
  onClose: () => void
}) {
  return (
    <Panel title={t('收藏')} onClose={onClose}>
      {screens.length ? (
        <ul className="art-favs">
          {screens.map((s) => (
            <li key={s.id}>
              <button type="button" className="art-favs__item" onClick={() => onPick(s.id)}>
                <Icon name="star" size={14} />
                <span>{s.title}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState compact icon="star" title={t('还没有收藏')} description={t('选中屏幕按 ⇧F 收藏')} />
      )}
    </Panel>
  )
}
