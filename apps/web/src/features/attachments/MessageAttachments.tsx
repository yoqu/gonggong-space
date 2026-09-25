import type { Attachment, MessageDto } from '@gonggong/protocol'
import {
  File,
  FileCode,
  FileText,
  Image,
  Maximize2,
  PanelRightOpen,
  Play,
  Quote,
  ScrollText,
  Video,
} from 'lucide-react'
import { cx } from '../../lib/cx'
import { attachmentUrl, type FileKind, fmtSize, KIND_LABEL, kindOf } from './api'
import { usePreview } from './preview'
import './attachments.css'

export const KIND_ICON: Record<FileKind, typeof File> = {
  image: Image,
  video: Video,
  md: FileText,
  text: ScrollText,
  code: FileCode,
  file: File,
}

/** The quoted bot reply / run card / message shown inside the sent message. */
export function MessageQuote({ quote }: { quote: MessageDto['quote'] }) {
  if (!quote) return null
  return (
    <div className="tl-quote">
      <Quote size={11} />
      <span className="tl-quote__who">引用 {quote.who}</span>
      <span className="tl-quote__text">{quote.text}</span>
    </div>
  )
}

/** Images / videos as a thumbnail grid, everything else as file rows; each opens the preview rail. */
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
              <div key={a.id} className="att-tile">
                {video ? (
                  <video src={attachmentUrl(a.id)} preload="metadata" muted />
                ) : (
                  <img src={attachmentUrl(a.id)} alt={a.name} loading="lazy" />
                )}
                <div className="att-tile__bar">
                  {video ? <Video size={11} /> : null}
                  <span className="att-tile__name">{a.name}</span>
                  <span className="att-tile__meta">{fmtSize(a.size)}</span>
                </div>
                {video ? (
                  <button type="button" className="att-tile__play" title="播放" onClick={() => open(a)}>
                    <Play size={18} />
                  </button>
                ) : null}
                <button
                  type="button"
                  className="att-tile__open"
                  title="在右侧查看"
                  aria-label={`在右侧查看 ${a.name}`}
                  onClick={() => open(a)}
                >
                  <Maximize2 size={12} />
                </button>
              </div>
            )
          })}
        </div>
      ) : null}
      {docs.length ? (
        <div className="att-docs">
          {docs.map((a) => {
            const kind = kindOf(a)
            const Icon = KIND_ICON[kind]
            return (
              <button key={a.id} type="button" className="att-doc" onClick={() => open(a)}>
                <span className="att-doc__icon">
                  <Icon size={15} />
                </span>
                <span className="att-doc__main">
                  <span className="att-doc__name">{a.name}</span>
                  <span className="att-doc__meta">
                    {`${KIND_LABEL[kind]} · ${fmtSize(a.size)}${kind === 'file' ? '' : ' · 点击预览'}`}
                  </span>
                </span>
                <PanelRightOpen size={13} />
              </button>
            )
          })}
        </div>
      ) : null}
    </>
  )
}
