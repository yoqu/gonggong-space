import { type Attachment, FILE_TEXT_MAX_BYTES } from '@gonggong/protocol'
import { useCallback } from 'react'
import { t } from '../../i18n'
import { FileViewer, type ViewKind } from '../files/FileViewer'
import { attachmentUrl, type FileKind, fmtSize, kindOf, officeOf, workspacePath } from './api'

/** The attachment route serves images, video, audio, PDF and text inline; office documents render from their bytes. */
const VIEW: Record<FileKind, ViewKind> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  pdf: 'pdf',
  md: 'md',
  text: 'text',
  code: 'text',
  archive: 'binary',
  file: 'binary',
}

const SEND_NOTE: Partial<Record<FileKind, string>> = {
  image: t('直接发给 Bot 看'),
  video: t('Bot 会打开文件读取'),
  audio: t('Bot 会打开文件读取'),
}

/** A message attachment in the shared file viewer, with where it lives and how the bot gets it. */
export function AttachmentViewer({ attachment: a, from }: { attachment: Attachment; from: string }) {
  const kind = kindOf(a)
  const note = SEND_NOTE[kind]
  const view = officeOf(a.name) ?? VIEW[kind]
  const url = attachmentUrl(a.id)
  const read = useCallback(async () => {
    if (a.size > FILE_TEXT_MAX_BYTES) return { text: null, binary: false, size: a.size }
    const r = await fetch(url, { credentials: 'include' })
    if (!r.ok) throw new Error(t('附件加载失败'))
    return { text: await r.text(), binary: false, size: a.size }
  }, [url, a.size])
  return (
    <FileViewer
      name={a.name}
      path={workspacePath(a)}
      url={url}
      kind={view}
      read={read}
      size={a.size}
      details={[
        [t('来源#from'), from],
        [t('大小'), fmtSize(a.size)],
        [t('位置'), workspacePath(a)],
        ...(note ? [[t('发送给 Bot'), note] as [string, string]] : []),
      ]}
    />
  )
}
