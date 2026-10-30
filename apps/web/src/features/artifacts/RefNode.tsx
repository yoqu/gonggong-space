import type { GgArtifactRef } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { t } from '../../i18n'
import { FileIcon } from '../../ui'
import { REF_SIZE } from './geometry'

/** Lines of a text reference the card shows. */
const TEXT_LINES = 12

/**
 * A file uploaded to the canvas (G04): an image as itself (reporting its height at the card's width), a PDF as its
 * icon and name, a text file as its first lines.
 */
export function RefNode({
  value,
  src,
  readFile,
  onHeight,
}: {
  value: GgArtifactRef
  /** The file's URL in the shown version. */
  src: string
  readFile: (file: string) => Promise<string>
  onHeight: (h: number) => void
}) {
  if (value.kind === 'image')
    return (
      <img
        className="art-ref__img"
        src={src}
        alt={value.title}
        draggable={false}
        onLoad={(e) => {
          const { naturalWidth: w, naturalHeight: h } = e.currentTarget
          if (w && h) onHeight(Math.round((REF_SIZE.image.w * h) / w))
        }}
      />
    )
  if (value.kind === 'pdf')
    return (
      <div className="art-ref__file">
        <FileIcon name={value.file} size={56} />
        <strong className="art-ref__name">{value.title}</strong>
        <span className="art-ref__type">{t('PDF 文档')}</span>
      </div>
    )
  return <TextRef file={value.file} title={value.title} readFile={readFile} />
}

function TextRef({
  file,
  title,
  readFile,
}: {
  file: string
  title: string
  readFile: (file: string) => Promise<string>
}) {
  const [text, setText] = useState<string | null>(null)
  // The canvas remounts the card per version; `readFile` is a new function each render.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per file
  useEffect(() => {
    let live = true
    readFile(file).then(
      (s) => live && setText(s.split('\n').slice(0, TEXT_LINES).join('\n')),
      () => live && setText(''),
    )
    return () => {
      live = false
    }
  }, [file])
  return (
    <div className="art-ref__text">
      <div className="art-ref__head">
        <FileIcon name={file} size={18} />
        <span className="art-ref__name">{title}</span>
      </div>
      <pre className="art-ref__lines">{text ?? ''}</pre>
    </div>
  )
}
