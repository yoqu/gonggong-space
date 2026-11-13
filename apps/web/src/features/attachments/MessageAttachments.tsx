import type { Attachment, MessageDto } from '@gonggong/protocol'
import { type CSSProperties, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { cx } from '../../lib/cx'
import { Button, FileAttachment, FileIcon, Icon, Lightbox, VideoPlayer, VoiceNote } from '../../ui'
import { openTab } from '../workbench/open'
import { attachmentUrl, fmtSize, KIND_LABEL, kindOf, OFFICE_LABEL, officeOf } from './api'
import './attachments.css'
import { t } from '../../i18n'

/** The quoted bot reply / run card / message shown inside the sent message; clicking it jumps to the original. */
export function MessageQuote({ quote }: { quote: MessageDto['quote'] }) {
  const [, setParams] = useSearchParams()
  if (!quote) return null
  const { kind, id } = quote
  const jump = () =>
    setParams(
      (p) => {
        // A message scrolls into view and flashes; a run card opens its process.
        p.set(kind === 'message' ? 'msg' : 'run', id)
        return p
      },
      { replace: true },
    )
  return (
    // biome-ignore lint/a11y/useSemanticElements: a <button> can't line-clamp its text
    <div
      role="button"
      tabIndex={0}
      className="pn-quote pn-quote--link"
      title={t('跳到原消息')}
      onClick={jump}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          jump()
        }
      }}
    >
      <b>{t('引用 {who}', { who: quote.who })}</b>
      {t('：')}
      <span>{quote.text}</span>
    </div>
  )
}

/** A video tile that plays in place on a tap; the poster is its first frame. */
function VideoTile({ a, onOpen }: { a: Attachment; onOpen: () => void }) {
  const [state, setState] = useState<'idle' | 'playing' | 'failed'>('idle')
  const [ratio, setRatio] = useState<string>()
  const [portrait, setPortrait] = useState(false)
  const ref = useRef<HTMLElement>(null)
  const url = attachmentUrl(a.id)
  return (
    <figure
      ref={ref}
      className={cx('pn-image att-tile', state !== 'idle' && 'att-tile--on')}
      style={ratio ? ({ '--ratio': ratio } as CSSProperties) : undefined}
    >
      {state === 'failed' ? (
        <div className="att-tile__failed">
          <span>{t('浏览器无法播放此视频，可下载查看')}</span>
          <a className="ui-btn ui-btn--small" href={url} download={a.name}>
            {t('下载')}
          </a>
        </div>
      ) : (
        <VideoPlayer
          src={url}
          label={a.name}
          // A portrait poster shows whole (pillarboxed) so it reads as portrait in a landscape tile.
          fit={portrait ? 'contain' : 'cover'}
          onStart={() => setState('playing')}
          onLoadedMetadata={(v) => {
            if (!v.videoWidth || !v.videoHeight) return
            setRatio(`${v.videoWidth} / ${v.videoHeight}`)
            setPortrait(v.videoHeight > v.videoWidth)
          }}
          onError={() => setState('failed')}
          cover={
            <figcaption className="att-tile__bar">
              <Icon name="video" size={12} />
              <span className="att-tile__name">{a.name}</span>
              <span>{fmtSize(a.size)}</span>
            </figcaption>
          }
        />
      )}
      {state !== 'idle' && (
        <Button
          className="att-tile__corner"
          size="small"
          variant="glass"
          icon="external"
          title={t('在工作台查看')}
          aria-label={`${t('在工作台查看')} ${a.name}`}
          onClick={() => {
            ref.current?.querySelector('video')?.pause()
            onOpen()
          }}
        />
      )}
    </figure>
  )
}

/** Audio plays right in the message (like a voice note); the workbench shows where it lives. */
function AudioCard({ a, onOpen }: { a: Attachment; onOpen: () => void }) {
  const [failed, setFailed] = useState(false)
  const url = attachmentUrl(a.id)
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset would style and behave as a form part
    <div role="group" aria-label={a.name} className="pn-card att-audio">
      <div className="att-audio__head">
        <FileIcon name={a.name} mime={a.mime} size={32} />
        <span className="pn-file__body">
          <span className="pn-file__name">{a.name}</span>
          <span className="pn-file__meta">{`${KIND_LABEL.audio} · ${fmtSize(a.size)}`}</span>
        </span>
        <Button
          size="small"
          variant="plain"
          icon="external"
          aria-label={t('在工作台查看')}
          title={t('在工作台查看')}
          onClick={onOpen}
        />
        <a
          className="ui-btn ui-btn--small ui-btn--plain ui-btn--icon"
          href={url}
          download={a.name}
          aria-label={t('下载')}
          title={t('下载')}
        >
          <Icon name="download" size={14} />
        </a>
      </div>
      {failed ? (
        <p className="att-audio__failed">{t('浏览器无法播放此音频，可下载查看')}</p>
      ) : (
        <VoiceNote src={url} seed={a.id} onError={() => setFailed(true)} />
      )}
    </div>
  )
}

/** Images / videos as a thumbnail grid, audio as players, everything else as file cards: images zoom and videos play
 * in place, the rest open a workbench file tab. */
export function MessageAttachments({ list, from }: { list: Attachment[]; from: string }) {
  const [zoomed, setZoomed] = useState<Attachment | null>(null)
  const tiles = useRef(new Map<string, HTMLElement>())
  if (!list.length) return null
  const media = list.filter((a) => ['image', 'video'].includes(kindOf(a)))
  const images = media.filter((a) => kindOf(a) === 'image')
  const audios = list.filter((a) => kindOf(a) === 'audio')
  const docs = list.filter((a) => !media.includes(a) && !audios.includes(a))
  const open = (attachment: Attachment) => openTab({ kind: 'file', source: { attachment, from } })
  return (
    <>
      {media.length ? (
        <div className={cx('att-media', media.length > 1 && 'att-media--multi')}>
          {media.map((a) =>
            kindOf(a) === 'video' ? (
              <VideoTile key={a.id} a={a} onOpen={() => open(a)} />
            ) : (
              <figure
                key={a.id}
                ref={(el) => {
                  if (el) tiles.current.set(a.id, el)
                  else tiles.current.delete(a.id)
                }}
                className="pn-image att-tile"
              >
                <img src={attachmentUrl(a.id)} alt={a.name} loading="lazy" />
                <figcaption className="att-tile__bar">
                  <span className="att-tile__name">{a.name}</span>
                  <span>{fmtSize(a.size)}</span>
                </figcaption>
                <button
                  type="button"
                  className="att-tile__open"
                  title={t('查看大图')}
                  aria-label={`${t('查看大图')} ${a.name}`}
                  onClick={() => setZoomed(a)}
                />
              </figure>
            ),
          )}
        </div>
      ) : null}
      {zoomed ? (
        <Lightbox
          items={images.map((a) => ({ src: attachmentUrl(a.id), alt: a.name }))}
          index={images.indexOf(zoomed)}
          onIndexChange={(n) => setZoomed(images[n] ?? null)}
          origin={(n) => tiles.current.get(images[n]?.id ?? '')}
          onClose={() => setZoomed(null)}
          actions={
            <>
              <a className="ui-btn ui-btn--small" href={attachmentUrl(zoomed.id)} download={zoomed.name}>
                {t('下载')}
              </a>
              <Button
                size="small"
                onClick={() => {
                  setZoomed(null)
                  open(zoomed)
                }}
              >
                {t('在工作台查看')}
              </Button>
            </>
          }
        />
      ) : null}
      {audios.map((a) => (
        <AudioCard key={a.id} a={a} onOpen={() => open(a)} />
      ))}
      {docs.map((a) => {
        const kind = kindOf(a)
        const office = officeOf(a.name)
        const label = office ? OFFICE_LABEL[office] : KIND_LABEL[kind]
        return (
          <FileAttachment
            key={a.id}
            name={a.name}
            mime={a.mime}
            meta={`${label} · ${fmtSize(a.size)}${(kind === 'file' || kind === 'archive') && !office ? '' : t(' · 点击预览')}`}
            onOpen={() => open(a)}
          />
        )
      })}
    </>
  )
}
