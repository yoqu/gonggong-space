import { type KeyboardEvent, type PointerEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import { t } from '../i18n'
import { errorText } from '../lib/api'
import { Button } from './controls'
import { Avatar } from './display'
import { Slider } from './form'
import { Dialog } from './overlay'
import { toast } from './toast'
import './avatar-editor.css'

/** Raster only: SVG could carry script. */
const TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
/** The source may be a big photo; only the 256px crop is uploaded. */
const SOURCE_MAX_MB = 20
const VIEW = 240
const OUT = 256
const ZOOM_MAX = 4

interface Size {
  w: number
  h: number
}
interface Crop {
  zoom: number
  x: number
  y: number
}

/** Where the image sits in the square viewport: it always covers it, `x`/`y` move its center. */
export function cropBox({ w, h }: Size, { zoom, x, y }: Crop, view = VIEW) {
  const scale = (view / Math.min(w, h)) * zoom
  const sw = w * scale
  const sh = h * scale
  const cx = Math.max(-(sw - view) / 2, Math.min((sw - view) / 2, x))
  const cy = Math.max(-(sh - view) / 2, Math.min((sh - view) / 2, y))
  return { left: view / 2 + cx - sw / 2, top: view / 2 + cy - sh / 2, width: sw, height: sh, x: cx, y: cy }
}

function exportCrop(img: HTMLImageElement, crop: Crop) {
  const box = cropBox({ w: img.naturalWidth, h: img.naturalHeight }, crop, OUT)
  const canvas = document.createElement('canvas')
  canvas.width = OUT
  canvas.height = OUT
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.reject(new Error(t('浏览器不支持裁剪图片')))
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, box.left, box.top, box.width, box.height)
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(t('浏览器不支持裁剪图片')))), 'image/png'),
  )
}

interface AvatarCropDialogProps {
  /** Object URL of a picked file, or the current avatar's same-origin URL. */
  src: string
  shape?: 'circle' | 'square'
  onCancel: () => void
  /** The 256px PNG; a rejection keeps the dialog open. */
  onDone: (image: Blob) => Promise<unknown>
}

/** Drag to move, slider or wheel to zoom; the mask previews the circle or rounded square it will show as. */
function AvatarCropDialog({ src, shape = 'circle', onCancel, onDone }: AvatarCropDialogProps) {
  const img = useRef<HTMLImageElement>(null)
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null)
  const [size, setSize] = useState<Size | null>(null)
  const [crop, setCrop] = useState<Crop>({ zoom: 1, x: 0, y: 0 })
  const [busy, setBusy] = useState(false)
  const box = size ? cropBox(size, crop) : null

  const move = (x: number, y: number) => setCrop((c) => ({ ...c, x, y }))
  const zoom = (z: number) => setCrop((c) => ({ ...c, zoom: Math.max(1, Math.min(ZOOM_MAX, z)) }))
  const down = (e: PointerEvent) => {
    if (!box) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    drag.current = { px: e.clientX, py: e.clientY, x: box.x, y: box.y }
  }
  const pointer = (e: PointerEvent) => {
    const d = drag.current
    if (d) move(d.x + e.clientX - d.px, d.y + e.clientY - d.py)
  }
  const key = (e: KeyboardEvent) => {
    if (!box) return
    const step = e.shiftKey ? 20 : 4
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[
      e.key
    ]
    if (!delta) return
    e.preventDefault()
    move(box.x + (delta[0] as number), box.y + (delta[1] as number))
  }
  const done = async () => {
    if (!img.current || !box) return
    setBusy(true)
    try {
      await onDone(
        await exportCrop(img.current, { ...crop, x: (box.x * OUT) / VIEW, y: (box.y * OUT) / VIEW }),
      )
    } catch (err) {
      toast({ type: 'error', message: errorText(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onCancel}
      closeOnBackdrop={false}
      title={t('编辑头像')}
      width={320}
      actions={[
        { label: t('取消'), onClick: onCancel },
        { label: busy ? t('保存中…') : t('完成'), variant: 'primary', disabled: busy || !box, onClick: done },
      ]}
    >
      <div className="ui-avatar-crop">
        <button
          type="button"
          className="ui-avatar-crop__view"
          style={{ width: VIEW, height: VIEW }}
          aria-label={t('拖动调整位置')}
          onPointerDown={down}
          onPointerMove={pointer}
          onPointerUp={() => {
            drag.current = null
          }}
          onPointerCancel={() => {
            drag.current = null
          }}
          onWheel={(e) => zoom(crop.zoom - e.deltaY * 0.002)}
          onKeyDown={key}
        >
          <img
            ref={img}
            src={src}
            alt=""
            draggable={false}
            crossOrigin={src.startsWith('/') ? undefined : 'anonymous'}
            style={
              box ? { left: box.left, top: box.top, width: box.width, height: box.height } : { opacity: 0 }
            }
            onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            onError={() => toast({ type: 'error', message: t('图片无法读取') })}
          />
          <span className={`ui-avatar-crop__mask ui-avatar-crop__mask--${shape}`} />
        </button>
        <Slider
          aria-label={t('缩放')}
          min={1}
          max={ZOOM_MAX}
          step={0.01}
          value={crop.zoom}
          onChange={zoom}
          disabled={!box}
        />
      </div>
    </Dialog>
  )
}

export interface AvatarEditorProps {
  name: string
  /** The current image; empty shows the generated avatar. */
  src?: string
  shape?: 'circle' | 'square'
  size?: number
  /** Shown instead of `<Avatar>`, e.g. a bot's role or a group's mosaic. */
  preview?: ReactNode
  /** Receives the cropped 256px PNG. */
  onUpload: (image: Blob) => Promise<unknown>
  /** Back to the default; the button shows while there is an image. */
  onRemove?: () => Promise<unknown>
  disabled?: boolean
  /** Extra buttons after 上传 / 编辑 / 恢复默认, e.g. 「使用飞书头像」. */
  children?: ReactNode
}

/** The one avatar control: pick an image, crop it, re-crop the current one later, or go back to the default. */
export function AvatarEditor({
  name,
  src,
  shape = 'circle',
  size = 40,
  preview,
  onUpload,
  onRemove,
  disabled,
  children,
}: AvatarEditorProps) {
  const input = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState<{ src: string; picked: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(
    () => () => {
      if (editing?.picked) URL.revokeObjectURL(editing.src)
    },
    [editing],
  )

  const pick = (file: File | undefined) => {
    if (input.current) input.current.value = ''
    if (!file) return
    if (!TYPES.includes(file.type))
      return toast({ type: 'error', message: t('头像仅支持 PNG、JPEG、WebP 或 GIF 图片') })
    if (file.size > SOURCE_MAX_MB << 20)
      return toast({ type: 'error', message: t('图片不能超过 {maxMb} MB', { maxMb: SOURCE_MAX_MB }) })
    setEditing({ src: URL.createObjectURL(file), picked: true })
  }
  const remove = async () => {
    if (!onRemove) return
    setBusy(true)
    try {
      await onRemove()
    } catch (err) {
      toast({ type: 'error', message: errorText(err) })
    } finally {
      setBusy(false)
    }
  }
  const off = disabled || busy
  // Same-origin uploads re-crop; a Feishu URL can't be read back into a canvas.
  const editable = !!src && (src.startsWith('/') || src.startsWith('data:image/'))

  return (
    <span className="ui-avatar-editor">
      {preview ?? <Avatar name={name} src={src} shape={shape} size={size} />}
      <input
        ref={input}
        type="file"
        accept={TYPES.join(',')}
        hidden
        aria-label={t('选择图片')}
        onChange={(e) => pick(e.target.files?.[0])}
      />
      <Button size="small" disabled={off} onClick={() => input.current?.click()}>
        {t('上传图片…')}
      </Button>
      {editable ? (
        <Button size="small" disabled={off} onClick={() => setEditing({ src, picked: false })}>
          {t('编辑…')}
        </Button>
      ) : null}
      {children}
      {onRemove && src ? (
        <Button size="small" disabled={off} onClick={() => void remove()}>
          {t('恢复默认')}
        </Button>
      ) : null}
      {editing ? (
        <AvatarCropDialog
          src={editing.src}
          shape={shape}
          onCancel={() => setEditing(null)}
          onDone={async (image) => {
            await onUpload(image)
            setEditing(null)
          }}
        />
      ) : null}
    </span>
  )
}
