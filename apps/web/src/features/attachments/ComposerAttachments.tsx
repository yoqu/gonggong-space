import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS } from '@gonggong/protocol'
import { type ChangeEvent, type RefObject, useCallback, useEffect, useRef, useState } from 'react'
import { Button, Icon, toast } from '../../ui'
import { fmtSize, type Upload, uploadFile } from './api'
import { type QuoteDraft, useQuote } from './quote'
import './attachments.css'

interface Pending {
  key: number
  name: string
  size: number
  image: boolean
  progress: number
  upload?: Upload
  abort: () => void
}

let seq = 0

/** Files picked in the composer, uploaded right away (spec §8.7: ≤ 50 MB each, ≤ 10 per message). */
export function useUploads(groupId: string) {
  const [items, setItems] = useState<Pending[]>([])
  const live = useRef(items)
  live.current = items
  const patch = (key: number, p: Partial<Pending>) =>
    setItems((list) => list.map((i) => (i.key === key ? { ...i, ...p } : i)))
  const drop = (key: number) => setItems((list) => list.filter((i) => i.key !== key))

  const add = (files: File[]) => {
    let room = MAX_ATTACHMENTS - live.current.length
    const added: Pending[] = []
    for (const file of files) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        toast({ type: 'error', message: `${file.name} 超过 50 MB，未添加` })
        continue
      }
      if (room-- <= 0) {
        toast({ type: 'warning', message: `每条消息最多 ${MAX_ATTACHMENTS} 个附件` })
        break
      }
      const key = ++seq
      const { done, abort } = uploadFile(groupId, file, (progress) => patch(key, { progress }))
      done.then(
        (upload) => patch(key, { upload, progress: 100 }),
        (e: Error) => {
          drop(key)
          if (e.name !== 'AbortError') toast({ type: 'error', message: `${file.name}：${e.message}` })
        },
      )
      added.push({
        key,
        name: file.name,
        size: file.size,
        image: file.type.startsWith('image/'),
        progress: 0,
        abort,
      })
    }
    live.current = [...live.current, ...added]
    setItems(live.current)
  }

  const remove = (key: number) => {
    live.current.find((i) => i.key === key)?.abort()
    drop(key)
  }

  const clear = useCallback(() => setItems([]), [])
  // Abandoned uploads stay unbound on the server; stop the transfers when leaving the group.
  useEffect(() => () => live.current.forEach((i) => void (i.upload || i.abort())), [])

  return {
    items,
    add,
    remove,
    clear,
    ids: items.flatMap((i) => (i.upload ? [i.upload.id] : [])),
    uploading: items.some((i) => !i.upload),
  }
}

export type Uploads = ReturnType<typeof useUploads>

/** Hidden pickers; the composer's 图片 / 附件 buttons click them. The image picker comes first. */
export function FilePickers({
  uploads,
  imageRef,
  fileRef,
}: {
  uploads: Uploads
  imageRef: RefObject<HTMLInputElement | null>
  fileRef: RefObject<HTMLInputElement | null>
}) {
  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    uploads.add([...(e.target.files ?? [])])
    e.target.value = ''
  }
  return (
    <>
      <input ref={imageRef} type="file" accept="image/*" multiple hidden onChange={onPick} />
      <input ref={fileRef} type="file" multiple hidden onChange={onPick} />
    </>
  )
}

export function QuoteChip({ quote }: { quote: QuoteDraft }) {
  const clear = useQuote((s) => s.clear)
  return (
    <div className="quote-chip">
      <Icon name="quote" size={14} className="quote-chip__icon" />
      <span className="quote-chip__who">引用 {quote.who}</span>
      <span className="quote-chip__text">{quote.text}</span>
      <span className="quote-chip__note">等同 @，引用内容一起发送</span>
      <Button variant="plain" size="small" icon="xmark" aria-label="关闭引用" title="关闭引用" onClick={clear} />
    </div>
  )
}

export function AttachmentChips({ uploads }: { uploads: Uploads }) {
  if (!uploads.items.length) return null
  const image = uploads.items.some((i) => i.image)
  return (
    <div className="att-chips">
      {uploads.items.map((i) => (
        <span key={i.key} className="att-chip">
          <Icon name={i.image ? 'image' : 'doc-text'} size={14} />
          <span className="att-chip__name">{i.name}</span>
          <span className="att-chip__size">{fmtSize(i.size)}</span>
          {i.upload ? null : <span className="att-chip__progress">{i.progress}%</span>}
          <button
            type="button"
            className="att-chip__rm"
            aria-label={`移除 ${i.name}`}
            onClick={() => uploads.remove(i.key)}
          >
            <Icon name="xmark" size={10} weight={2.2} />
          </button>
        </span>
      ))}
      <span className="att-chips__note">
        {`${uploads.items.length} / ${MAX_ATTACHMENTS} · 写入工作区 .gonggong/attachments/，不进 git${image ? ' · 图片：agent 支持时同时以 ACP 图片发送' : ''}`}
      </span>
    </div>
  )
}
