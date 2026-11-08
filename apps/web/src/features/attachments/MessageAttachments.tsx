import type { Attachment, MessageDto } from '@gonggong/protocol'
import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { cx } from '../../lib/cx'
import { Button, FileAttachment, Icon, Lightbox } from '../../ui'
import { openTab } from '../workbench/open'
import { attachmentUrl, fmtSize, KIND_LABEL, kindOf } from './api'
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

/** Images / videos as a thumbnail grid, everything else as file cards; images zoom in place, the rest open a workbench file tab. */
export function MessageAttachments({ list, from }: { list: Attachment[]; from: string }) {
  const [zoomed, setZoomed] = useState<Attachment | null>(null)
  if (!list.length) return null
  const media = list.filter((a) => ['image', 'video'].includes(kindOf(a)))
  const images = media.filter((a) => kindOf(a) === 'image')
  const docs = list.filter((a) => !media.includes(a))
  const open = (attachment: Attachment) => openTab({ kind: 'file', source: { attachment, from } })
  return (
    <>
      {media.length ? (
        <div className={cx('att-media', media.length > 1 && 'att-media--multi')}>
          {media.map((a) => {
            const video = kindOf(a) === 'video'
            return (
              <figure key={a.id} className="pn-image att-tile">
                {video ? (
                  <video src={attachmentUrl(a.id)} preload="metadata" muted />
                ) : (
                  <img src={attachmentUrl(a.id)} alt={a.name} loading="lazy" />
                )}
                <figcaption className="att-tile__bar">
                  {video ? <Icon name="video" size={12} /> : null}
                  <span className="att-tile__name">{a.name}</span>
                  <span>{fmtSize(a.size)}</span>
                </figcaption>
                {video ? (
                  <span className="att-tile__play" aria-hidden="true">
                    <Icon name="play" size={18} />
                  </span>
                ) : null}
                <button
                  type="button"
                  className="att-tile__open"
                  title={video ? t('在工作台查看') : t('查看大图')}
                  aria-label={`${video ? t('在工作台查看') : t('查看大图')} ${a.name}`}
                  onClick={() => (video ? open(a) : setZoomed(a))}
                />
              </figure>
            )
          })}
        </div>
      ) : null}
      {zoomed ? (
        <Lightbox
          items={images.map((a) => ({ src: attachmentUrl(a.id), alt: a.name }))}
          index={images.indexOf(zoomed)}
          onIndexChange={(n) => setZoomed(images[n] ?? null)}
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
      {docs.map((a) => {
        const kind = kindOf(a)
        return (
          <FileAttachment
            key={a.id}
            name={a.name}
            mime={a.mime}
            meta={`${KIND_LABEL[kind]} · ${fmtSize(a.size)}${kind === 'file' ? '' : t(' · 点击预览')}`}
            onOpen={() => open(a)}
          />
        )
      })}
    </>
  )
}
