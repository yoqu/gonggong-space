import { ARTIFACT_UPLOAD_TYPES, type ArtifactEditOp, attrValueOk } from '@gonggong/protocol'
import { useCallback, useRef, useState } from 'react'
import { t } from '../../i18n'
import { errorText } from '../../lib/api'
import { Button, Input, toast } from '../../ui'
import { uploadImage } from './actions'
import { type BridgeMessage, postToScreen } from './bridge'
import type { PickedElement } from './elements'

export type TextEditing = 'picking' | 'editing' | null

/**
 * Stitch's Edit Text, in the screens themselves (bridge `edit-text` / `text-edit`): starts it on an element, follows
 * whether the member is picking a text or typing, and saves what was typed as one `text` op. A screen whose text could
 * not be saved is reloaded, so it shows the source again.
 */
export function useTextEdit({
  frames,
  origin,
  canEdit,
  save,
  onSaved,
  onDirect,
}: {
  frames: ReadonlyMap<string, HTMLIFrameElement>
  origin: string | null
  canEdit: boolean
  save: (ops: ArtifactEditOp[]) => Promise<boolean>
  onSaved: () => void
  /** Editing began in the screen (a double click), not from the element's menu: no menu while typing. */
  onDirect: () => void
}) {
  const [state, setState] = useState<TextEditing>(null)
  const fromMenu = useRef(false)
  const reload = (file: string) => postToScreen(frames.get(file), origin, { type: 'reload' })
  const start = (el: PickedElement) => {
    const frame = frames.get(el.file)
    if (!el.ggId || !frame) return
    fromMenu.current = true
    // The text gets the caret: the keys go to the screen from now on.
    frame.focus()
    postToScreen(frame, origin, { type: 'edit-text', ggId: el.ggId })
  }
  const onMessage = (m: Extract<BridgeMessage, { type: 'text-edit' }>) => {
    if (m.state !== 'done') {
      if (!fromMenu.current) onDirect()
      if (canEdit) return setState(m.state)
      setState(null)
      toast({ type: 'warning', message: t('历史版本只读，回到当前版本再改') })
      return reload(m.file)
    }
    setState(null)
    fromMenu.current = false
    if (!m.ggId || m.text === null) return
    if (!canEdit) return reload(m.file)
    void save([{ kind: 'text', file: m.file, ggId: m.ggId, text: m.text }]).then((ok) =>
      ok ? onSaved() : reload(m.file),
    )
  }
  const reset = useCallback(() => {
    setState(null)
    fromMenu.current = false
  }, [])
  return { state, start, onMessage, reset }
}

/** Shown in the element's menu while its text is edited in the screen. */
export function textEditingHint(state: TextEditing) {
  if (state === 'picking') return t('点选要改的文字，Esc 退出')
  if (state === 'editing') return t('直接输入，回车保存，Esc 取消')
  return null
}

/**
 * The menu's Edit Image › Enter URL (Stitch): the picture's address, all of it selected; https or a file of the
 * artifact.
 */
export function ImageUrlForm({
  el,
  readOnly,
  onApply,
  onBack,
}: {
  el: PickedElement
  readOnly: boolean
  onApply: (ops: ArtifactEditOp[]) => Promise<unknown>
  onBack: () => void
}) {
  const [src, setSrc] = useState(el.src ?? '')
  const [busy, setBusy] = useState(false)
  const next = src.trim()
  const bad = next !== '' && !attrValueOk('src', next)
  return (
    <form
      className="art-pop__form"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!next || bad || next === el.src) return
        setBusy(true)
        await onApply([{ kind: 'attr', file: el.file, ggId: el.ggId ?? '', name: 'src', value: next }])
        setBusy(false)
      }}
    >
      <Input
        aria-label={t('图片地址')}
        placeholder={t('粘贴图片地址（https://…）')}
        value={src}
        invalid={bad}
        autoFocus
        disabled={readOnly}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setSrc(e.target.value)}
      />
      {bad ? <p className="art-pop__note">{t('只支持 https 地址或产物里的文件路径')}</p> : null}
      <div className="art-pop__row">
        <Button size="small" variant="plain" onClick={onBack}>
          {t('返回')}
        </Button>
        <Button
          size="small"
          variant="primary"
          type="submit"
          loading={busy}
          disabled={readOnly || !next || bad || next === el.src}
        >
          {t('应用')}
        </Button>
      </div>
    </form>
  )
}

/** Edit Image › Upload Image: picks a file, uploads it and puts it in place as one `asset` op. */
export function useImageUpload(
  artifactId: string,
  el: PickedElement,
  onApply: (ops: ArtifactEditOp[]) => Promise<unknown>,
) {
  const [busy, setBusy] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  const input = (
    <input
      ref={picker}
      type="file"
      hidden
      data-testid="art-pop-image"
      accept={Object.keys(ARTIFACT_UPLOAD_TYPES).join(',')}
      onChange={async (e) => {
        const file = e.target.files?.[0]
        e.target.value = ''
        if (!file) return
        setBusy(true)
        try {
          const { uploadId } = await uploadImage(artifactId, file)
          await onApply([{ kind: 'asset', file: el.file, ggId: el.ggId ?? '', uploadId }])
        } catch (err) {
          toast({ type: 'error', message: errorText(err) })
        } finally {
          setBusy(false)
        }
      }}
    />
  )
  return { input, busy, open: () => picker.current?.click() }
}

/** An element whose picture a member can replace. */
export const isImage = (el: Pick<PickedElement, 'tag' | 'src'>) => el.tag === 'img' || el.src !== null
