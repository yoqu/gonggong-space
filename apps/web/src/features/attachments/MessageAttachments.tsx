import type { Attachment, MessageDto } from '@gonggong/protocol'
import { cx } from '../../lib/cx'
import { FileAttachment, Icon, type IconName } from '../../ui'
import { attachmentUrl, type FileKind, fmtSize, KIND_LABEL, kindOf } from './api'
import { usePreview } from './preview'
import './attachments.css'

export const KIND_ICON: Record<FileKind, IconName> = {
  image: 'image',
  video: 'video',
  md: 'doc-text',
  text: 'doc-text',
  code: 'doc-code',
  file: 'doc',
}

/** The quoted bot reply / run card / message shown inside the sent message. */
export function MessageQuote({ quote }: { quote: MessageDto['quote'] }) {
  if (!quote) return null
  return (
    <div className="pn-quote">
      <b>引用 {quote.who}</b>
      {'：'}
      <span>{quote.text}</span>
    </div>
  )
}

/** Images / videos as a thumbnail grid, everything else as file cards; each opens the preview rail. */
export function MessageAttachments({ list, from }: { list: Attachment[]; from: string }) {
  const show = usePreview((s) => s.show)
  if (!list.length) return null
  const media = list.filter((a) => ['image', 'video'].includes(kindOf(a)))
  const docs = list.filter((a) => !media.includes(a))
  const open = (attachment: Attachment) => show({ attachment, from })
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
                  title="在右侧查看"
                  aria-label={`在右侧查看 ${a.name}`}
                  onClick={() => open(a)}
                />
              </figure>
            )
          })}
        </div>
      ) : null}
      {docs.map((a) => {
        const kind = kindOf(a)
        return (
          <FileAttachment
            key={a.id}
            name={a.name}
            meta={`${KIND_LABEL[kind]} · ${fmtSize(a.size)}${kind === 'file' ? '' : ' · 点击预览'}`}
            onOpen={() => open(a)}
          />
        )
      })}
    </>
  )
}
