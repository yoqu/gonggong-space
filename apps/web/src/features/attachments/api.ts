import type { Attachment } from '@gonggong/protocol'
import { ApiError } from '../../lib/api'
import { fileType } from '../../ui/file-icon'

export type Upload = Omit<Attachment, 'messageId'>

export const attachmentUrl = (id: string) => `/api/attachments/${id}`

/** POST multipart with upload progress (fetch has none). */
export function postForm<T>(url: string, form: FormData, onProgress: (pct: number) => void) {
  const xhr = new XMLHttpRequest()
  const done = new Promise<T>((resolve, reject) => {
    xhr.open('POST', url)
    xhr.withCredentials = true
    xhr.responseType = 'json'
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100))
    xhr.onload = () => {
      const body = xhr.response as (T & { error?: string; message?: string }) | null
      if (xhr.status >= 200 && xhr.status < 300 && body) resolve(body)
      else reject(new ApiError(xhr.status, 'http_error', body?.message ?? '上传失败'))
    }
    xhr.onerror = () => reject(new Error('上传失败，请检查网络'))
    xhr.onabort = () => reject(new DOMException('aborted', 'AbortError'))
    xhr.send(form)
  })
  return { done, abort: () => xhr.abort() }
}

/** POST /api/uploads; `groupId` goes first so the server checks it before the file. */
export function uploadFile(groupId: string, file: File, onProgress: (pct: number) => void) {
  const form = new FormData()
  form.append('groupId', groupId)
  form.append('file', file)
  return postForm<Upload>('/api/uploads', form, onProgress)
}

export type FileKind = 'image' | 'video' | 'md' | 'text' | 'code' | 'file'

/** Preview kind (prototype KIND_*): svg is served as a download, so it is a plain file here. */
export function kindOf(a: Pick<Attachment, 'name' | 'mime'>): FileKind {
  if (a.mime.startsWith('image/') && a.mime !== 'image/svg+xml') return 'image'
  if (a.mime.startsWith('video/')) return 'video'
  const t = fileType(a.name, a.mime)
  if (t === 'md' || t === 'code' || t === 'text') return t
  return a.mime.startsWith('text/') || /\.csv$/i.test(a.name) ? 'text' : 'file'
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
export const workspacePath = (a: Attachment) => `.gonggong/attachments/${a.messageId}/${a.name}`
