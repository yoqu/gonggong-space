import { type Attachment, FILE_TEXT_MAX_BYTES } from '@gonggong/protocol'
import { useCallback } from 'react'
import { FileViewer, type ViewKind } from '../files/FileViewer'
import { attachmentUrl, type FileKind, fmtSize, kindOf, workspacePath } from './api'

/** The attachment route serves only images, video and text inline; anything else is a download. */
const VIEW: Record<FileKind, ViewKind> = {
  image: 'image',
  video: 'video',
  md: 'md',
  text: 'text',
  code: 'text',
  file: 'binary',
}

const SEND_NOTE: Partial<Record<FileKind, string>> = {
  image: 'agent 声明支持图片时以 ACP 图片内容直接发送，同时落盘供按路径读取',
  video: '视频不直接发送，agent 按路径读取',
}

/** A message attachment in the shared file viewer, with where it lives and how the bot gets it. */
export function AttachmentViewer({ attachment: a, from }: { attachment: Attachment; from: string }) {
  const kind = kindOf(a)
  const url = attachmentUrl(a.id)
  const read = useCallback(async () => {
    if (a.size > FILE_TEXT_MAX_BYTES) return { text: null, binary: false, size: a.size }
    const r = await fetch(url, { credentials: 'include' })
    if (!r.ok) throw new Error('附件加载失败')
    return { text: await r.text(), binary: false, size: a.size }
  }, [url, a.size])
  return (
    <FileViewer
      name={a.name}
      path={workspacePath(a)}
      url={url}
      kind={VIEW[kind]}
      read={read}
      details={[
        ['来源', from],
        ['大小', fmtSize(a.size)],
        ['位置', workspacePath(a)],
        SEND_NOTE[kind] ? ['发送给 Bot', SEND_NOTE[kind]] : ['工作树', '已加入 .git/info/exclude，不进 git'],
      ]}
    />
  )
}
