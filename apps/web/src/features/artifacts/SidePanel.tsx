import { type ReactNode, useState } from 'react'
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

/** The details panel's shot width when it cannot be measured (the 300px panel less its padding). */
const SHOT_WIDTH = 268

/**
 * The screen itself, shrunk to the shot's width (top first): a static, non-interactive copy of what the canvas shows.
 */
function ScreenShot({ node, src }: { node: CanvasNode; src: string | null }) {
  const [width, setWidth] = useState(SHOT_WIDTH)
  if (!src) return <Icon name="smartphone" size={28} />
  const scale = width / node.w
  return (
    <iframe
      ref={(el) => {
        if (el?.parentElement?.clientWidth) setWidth(el.parentElement.clientWidth)
      }}
      title={t('{title} 缩略图', { title: node.title })}
      data-testid="art-details-shot"
      src={src}
      tabIndex={-1}
      loading="lazy"
      style={{ width: node.w, height: node.h, transform: `scale(${scale})` }}
    />
  )
}

/** View Details (I): what the screen is, its size, its design system, its source, where it comes from and its prompt. */
export function DetailsPanel({
  artifactId,
  versionId,
  node,
  src,
  prompt,
  systemName,
  onCode,
  onDesignSystem,
  onClose,
}: {
  artifactId: string
  versionId: string
  node: CanvasNode
  /** The screen's preview URL; null while the preview opens. */
  src: string | null
  /** The manifest's design prompt of the screen; else its section of brief.md or DESIGN.md. */
  prompt?: string
  /** DESIGN.md's name (or a generic one); null without a design system. */
  systemName: string | null
  onCode: () => void
  onDesignSystem: () => void
  onClose: () => void
}) {
  const notes = useScreenNotes(artifactId, versionId, node)
  const origin = notes.origin
  const note = prompt?.trim() || notes.note
  return (
    <Panel title={node.title} onClose={onClose}>
      <div className="art-panel__shot">
        <ScreenShot node={node} src={src} />
      </div>
      <h4 className="art-panel__label">{t('属性')}</h4>
      <dl className="art-props">
        <dt>{t('类型')}</dt>
        <dd>{t('设计屏幕')}</dd>
        <dt>{t('尺寸')}</dt>
        <dd data-testid="art-details-size">{`${node.w} x ${node.h}`}</dd>
        <dt>{t('设计系统')}</dt>
        <dd>
          {systemName ? (
            <Button size="small" variant="plain" icon="palette" onClick={onDesignSystem}>
              {systemName}
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
