import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS } from '@gonggong/protocol'
import { type ChangeEvent, type RefObject, useCallback, useEffect, useRef, useState } from 'react'
import { cx } from '../../lib/cx'
import { Button, FileIcon, Icon, Lightbox, toast } from '../../ui'
import { fmtSize, type Upload, uploadFile } from './api'
import { type QuoteDraft, useQuote } from './quote'
import './attachments.css'
import { t } from '../../i18n'

interface Pending {
  key: number
  name: string
  size: number
  image: boolean
  /** Object URL of a local image, so it previews before (and without waiting for) the upload. */
  thumb?: string
  progress: number
  upload?: Upload
  abort: () => void
}

let seq = 0

const release = (i: Pending) => i.thumb && URL.revokeObjectURL(i.thumb)

/** Files picked in the composer, uploaded right away (spec §8.7: ≤ 50 MB each, ≤ 10 per message). */
export function useUploads(groupId: string) {
  const [items, setItems] = useState<Pending[]>([])
  const live = useRef(items)
  live.current = items
  const patch = (key: number, p: Partial<Pending>) =>
    setItems((list) => list.map((i) => (i.key === key ? { ...i, ...p } : i)))
  const drop = (key: number) => {
    const gone = live.current.find((i) => i.key === key)
    if (gone) release(gone)
    live.current = live.current.filter((i) => i.key !== key)
    setItems((list) => list.filter((i) => i.key !== key))
  }

  const add = (files: File[]) => {
    let room = MAX_ATTACHMENTS - live.current.length
    const added: Pending[] = []
    for (const file of files) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        toast({ type: 'error', message: t('{name} 超过 50 MB，未添加', { name: file.name }) })
        continue
      }
      if (room-- <= 0) {
        toast({ type: 'warning', message: t('每条消息最多 {n} 个附件', { n: MAX_ATTACHMENTS }) })
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
      const image = file.type.startsWith('image/')
      added.push({
        key,
        name: file.name,
        size: file.size,
        image,
        thumb: image && file.type !== 'image/svg+xml' ? URL.createObjectURL(file) : undefined,
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

  const clear = useCallback(() => {
    live.current.forEach(release)
    live.current = []
    setItems([])
  }, [])
  // Abandoned uploads stay unbound on the server; stop the transfers when leaving the group.
  useEffect(
    () => () =>
      live.current.forEach((i) => {
        release(i)
        if (!i.upload) i.abort()
      }),
    [],
  )

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
      <span className="quote-chip__who">{t('引用 {who}', { who: quote.who })}</span>
      <span className="quote-chip__text">{quote.text}</span>
      <span className="quote-chip__note">{t('等同 @，引用内容一起发送')}</span>
      <Button
        variant="plain"
        size="small"
        icon="xmark"
        aria-label={t('关闭引用')}
        title={t('关闭引用')}
        onClick={clear}
      />
    </div>
  )
}

export function AttachmentChips({ uploads }: { uploads: Uploads }) {
  const [viewKey, setViewKey] = useState<number | null>(null)
  if (!uploads.items.length) return null
  const viewing = uploads.items.find((i) => i.key === viewKey)
  const image = uploads.items.some((i) => i.image)
  return (
    <div className="att-chips">
      {uploads.items.map((i) => (
        <span key={i.key} className={cx('att-chip', i.thumb && 'att-chip--image')}>
          {i.thumb ? (
            <button
              type="button"
              className="att-chip__thumb"
              aria-label={t('预览 {name}', { name: i.name })}
              title={t('点击放大')}
              onClick={() => setViewKey(i.key)}
            >
              <img src={i.thumb} alt={i.name} />
            </button>
          ) : (
            <FileIcon name={i.name} size={18} />
          )}
          <span className="att-chip__name">{i.name}</span>
          <span className="att-chip__size">{fmtSize(i.size)}</span>
          {i.upload ? null : <span className="att-chip__progress">{i.progress}%</span>}
          <button
            type="button"
            className="att-chip__rm"
            aria-label={t('移除 {name}', { name: i.name })}
            onClick={() => uploads.remove(i.key)}
          >
            <Icon name="xmark" size={10} weight={2.2} />
          </button>
        </span>
      ))}
      {viewing?.thumb ? (
        <Lightbox src={viewing.thumb} alt={viewing.name} onClose={() => setViewKey(null)} />
      ) : null}
      <span className="att-chips__note">
        {`${t('{n} / {max} · 写入工作区 .gonggong/attachments/，不进 git', { n: uploads.items.length, max: MAX_ATTACHMENTS })}${image ? t(' · 图片：agent 支持时同时以 ACP 图片发送') : ''}`}
      </span>
    </div>
  )
}
