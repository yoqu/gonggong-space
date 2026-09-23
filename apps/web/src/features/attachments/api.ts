import type { Attachment } from '@aiws/protocol'
import { ApiError } from '../../lib/api'

export type Upload = Omit<Attachment, 'messageId'>

export const attachmentUrl = (id: string) => `/api/attachments/${id}`

/** POST /api/uploads with upload progress (fetch has none); `groupId` goes first so the server checks it before the file. */
export function uploadFile(groupId: string, file: File, onProgress: (pct: number) => void) {
  const xhr = new XMLHttpRequest()
  const done = new Promise<Upload>((resolve, reject) => {
    const form = new FormData()
    form.append('groupId', groupId)
    form.append('file', file)
    xhr.open('POST', '/api/uploads')
    xhr.withCredentials = true
    xhr.responseType = 'json'
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100))
    xhr.onload = () => {
      const body = xhr.response as (Upload & { error?: string; message?: string }) | null
      if (xhr.status >= 200 && xhr.status < 300 && body) resolve(body)
      else reject(new ApiError(xhr.status, 'http_error', body?.message ?? '上传失败'))
    }
    xhr.onerror = () => reject(new Error('上传失败，请检查网络'))
    xhr.onabort = () => reject(new DOMException('aborted', 'AbortError'))
    xhr.send(form)
  })
  return { done, abort: () => xhr.abort() }
}

export type FileKind = 'image' | 'video' | 'md' | 'text' | 'code' | 'file'

const CODE =
  /\.(ts|tsx|js|jsx|mjs|cjs|go|rs|py|java|kt|swift|rb|php|c|h|cc|cpp|cs|sh|sql|json|ya?ml|toml|css|scss|html|xml|vue)$/i

/** Preview kind (prototype KIND_*): svg is served as a download, so it is a plain file here. */
export function kindOf(a: Pick<Attachment, 'name' | 'mime'>): FileKind {
  if (a.mime.startsWith('image/') && a.mime !== 'image/svg+xml') return 'image'
  if (a.mime.startsWith('video/')) return 'video'
  if (/\.(md|markdown)$/i.test(a.name) || a.mime === 'text/markdown') return 'md'
  if (CODE.test(a.name)) return 'code'
  if (a.mime.startsWith('text/') || /\.(log|txt|csv)$/i.test(a.name)) return 'text'
  return 'file'
}

export const KIND_LABEL: Record<FileKind, string> = {
  image: '图片',
  video: '视频',
  md: 'Markdown',
  text: '文本日志',
  code: '代码',
  file: '文件',
}

export function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Where the daemon writes it in the bot's workspace. */
export const workspacePath = (a: Attachment) => `.aiws/attachments/${a.messageId}/${a.name}`
