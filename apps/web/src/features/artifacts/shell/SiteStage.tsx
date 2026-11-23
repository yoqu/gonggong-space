import type { ArtifactThreadDto } from '@gonggong/protocol'
import { type MouseEvent, type RefObject, useState } from 'react'
import { t } from '../../../i18n'
import { cx } from '../../../lib/cx'
import { Button, Spinner, Textarea } from '../../../ui'

interface PendingPin {
  x: number
  y: number
}

/**
 * Hosted static site stage (`kind === 'site'`): renders the site iframe with a coordinate-annotation
 * overlay when annotating, plus numbered pins for site-anchored threads on the shown version.
 */
export function SiteStage({
  title,
  src,
  versionKey,
  frameRef,
  threads,
  annotating,
  readOnly,
  activeThreadId,
  onCreatePin,
  onSelectThread,
}: {
  title: string
  src: string | null
  versionKey: string
  frameRef: RefObject<HTMLIFrameElement | null>
  threads: ArtifactThreadDto[]
  annotating: boolean
  readOnly: boolean
  activeThreadId: string | null
  onCreatePin: (point: { x: number; y: number }, text: string) => Promise<void>
  onSelectThread: (th: ArtifactThreadDto) => void
}) {
  const [draft, setDraft] = useState<PendingPin | null>(null)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)

  if (!src) {
    return (
      <div className="art-site__wait">
        <Spinner />
      </div>
    )
  }

  const siteThreads = threads.filter(
    (
      th,
    ): th is ArtifactThreadDto & {
      anchor: { kind: 'site'; path: string; point: { x: number; y: number } }
    } => typeof th.anchor !== 'string' && th.anchor.kind === 'site',
  )

  const onOverlayClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!annotating || readOnly) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = Math.max(0, Math.round(e.clientX - rect.left))
    const y = Math.max(0, Math.round(e.clientY - rect.top))
    setDraft({ x, y })
    setText('')
  }

  const submit = async () => {
    if (!draft || !text.trim()) return
    setSaving(true)
    try {
      await onCreatePin(draft, text.trim())
      setDraft(null)
      setText('')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="art-shell__site" data-testid="shell-site-stage">
      <iframe
        key={`${src}|${versionKey}`}
        ref={frameRef}
        className="art-site__frame"
        title={title}
        src={src}
        allowFullScreen
      />
      {annotating && !readOnly ? (
        // biome-ignore lint/a11y/useSemanticElements: full-stage coordinate picker overlay
        <div
          role="button"
          tabIndex={0}
          className="art-shell__overlay"
          data-testid="shell-site-overlay"
          aria-label={t('点击页面添加坐标批注')}
          onClick={onOverlayClick}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setDraft(null)
          }}
        />
      ) : null}
      <div className="art-shell__pins" aria-hidden={!siteThreads.length}>
        {siteThreads.map((th, i) => (
          <button
            key={th.id}
            type="button"
            data-testid={`shell-pin-${i + 1}`}
            data-status={th.status}
            className={cx(
              'art-shell__pin',
              `art-shell__pin--${th.status}`,
              activeThreadId === th.id && 'art-shell__pin--active',
            )}
            style={{ left: th.anchor.point.x, top: th.anchor.point.y }}
            title={`${th.createdByName}: ${th.messages[0]?.text ?? ''}`}
            onClick={() => onSelectThread(th)}
          >
            {i + 1}
          </button>
        ))}
      </div>
      {draft && !readOnly ? (
        <div
          className="art-shell__pin-pop"
          role="dialog"
          aria-label={t('添加批注')}
          data-testid="shell-site-pin-popover"
          style={{ left: Math.max(12, draft.x), top: Math.max(12, draft.y) }}
        >
          <div className="art-shell__pin-coord">{t('坐标 ({x}, {y})', { x: draft.x, y: draft.y })}</div>
          <Textarea
            rows={2}
            maxLength={2000}
            autoFocus
            placeholder={t('写下对这处页面的修改意见…')}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setDraft(null)
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && text.trim()) void submit()
            }}
          />
          <div className="art-shell__pin-acts">
            <Button size="small" variant="plain" onClick={() => setDraft(null)}>
              {t('取消')}
            </Button>
            <Button
              size="small"
              variant="primary"
              disabled={saving || !text.trim()}
              onClick={() => void submit()}
            >
              {t('提交批注')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
