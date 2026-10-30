import {
  ARTIFACT_UPLOAD_TYPES,
  type ArtifactEditOp,
  attrValueOk,
  type StyleProp,
  styleValueOk,
} from '@gonggong/protocol'
import { useEffect, useMemo, useRef, useState } from 'react'
import { t } from '../../i18n'
import { errorText } from '../../lib/api'
import { Alert, Button, Input, PopUpButton, Textarea } from '../../ui'
import { uploadImage } from './actions'
import {
  COLOR_FIELDS,
  crumbs,
  type PickedElement,
  parseInlineStyle,
  SIZE_FIELDS,
  styleChanges,
} from './elements'
import { Panel } from './SidePanel'
import type { DesignTokens } from './tokens'

const FIELD_LABEL: Record<string, string> = {
  color: t('文字颜色'),
  'background-color': t('背景'),
  'border-color': t('边框颜色'),
  'font-size': t('字号'),
  'font-weight': t('字重'),
  'line-height': t('行高'),
  padding: t('内边距'),
  margin: t('外边距'),
  'border-radius': t('圆角'),
  width: t('宽度'),
  height: t('高度'),
}

/** The colour of a `var(--color-x)` value, for its swatch; tokens hold the values. */
function Swatch({ value }: { value: string }) {
  return <i className="art-swatch" style={{ background: value }} />
}

/**
 * The element page of the side panel (产物托管 plan §4, 共工's addition to Stitch's Direct Edit): text, image, link,
 * the screen it opens and its inline style, colours from the tokens only. Style values preview on the element as
 * they are set (`onPreview`); 保存 makes one version, 取消 drops it all and puts the element's style back.
 */
export function ElementPanel({
  el,
  artifactId,
  screens,
  tokens,
  readOnly,
  onSave,
  onPreview,
  onClose,
}: {
  el: PickedElement
  artifactId: string
  screens: { id: string; title: string }[]
  tokens: DesignTokens | null
  readOnly: boolean
  onSave: (ops: ArtifactEditOp[]) => Promise<boolean>
  /** The style to show on the element for now (changed properties only, '' removes one); null restores it. */
  onPreview?: (props: Record<string, string> | null) => void
  onClose: () => void
}) {
  const inline = useMemo(() => parseInlineStyle(el.inlineStyle), [el.inlineStyle])
  const [text, setText] = useState(el.text)
  const [href, setHref] = useState(el.href ?? '')
  const [link, setLink] = useState(el.link ?? '')
  const [transition, setTransition] = useState('')
  const [style, setStyle] = useState<Record<string, string>>(() =>
    Object.fromEntries([...COLOR_FIELDS, ...SIZE_FIELDS].map((p) => [p, inline[p] ?? ''])),
  )
  const [upload, setUpload] = useState<{ uploadId: string; name: string; url: string | null } | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  const isImage = el.tag === 'img' || el.src !== null
  const isLink = el.tag === 'a' || el.href !== null
  const colors = useMemo(() => (tokens?.vars ?? []).filter(([k]) => k.startsWith('--color-')), [tokens])

  const badStyle = Object.entries(style).filter(([k, v]) => v.trim() && !styleValueOk(v.trim(), k))
  const badHref = isLink && href.trim() !== '' && !attrValueOk('href', href.trim())
  const ops: ArtifactEditOp[] = []
  const where = { file: el.file, ggId: el.ggId ?? '' }
  if (el.textOnly && text !== el.text) ops.push({ kind: 'text', ...where, text })
  if (isLink && href.trim() !== (el.href ?? ''))
    ops.push({ kind: 'attr', ...where, name: 'href', value: href.trim() || null })
  if (link !== (el.link ?? ''))
    ops.push({ kind: 'attr', ...where, name: 'data-gg-link', value: link || null })
  if (link && transition) ops.push({ kind: 'attr', ...where, name: 'data-gg-transition', value: transition })
  if (upload) ops.push({ kind: 'asset', ...where, uploadId: upload.uploadId })
  const props = styleChanges(inline, style)
  if (Object.keys(props).length) ops.push({ kind: 'style', ...where, props })
  const invalid = badStyle.length > 0 || badHref

  // Live preview: every valid changed value, a cleared one as removed; leaving without saving restores the element.
  const preview = useRef(onPreview)
  preview.current = onPreview
  const saved = useRef(false)
  const shownStyle = JSON.stringify(
    Object.fromEntries(
      Object.entries(style).flatMap(([k, v]) => {
        const want = v.trim()
        if (want === (inline[k] ?? '')) return []
        if (want && !styleValueOk(want, k)) return []
        return [[k, want]]
      }),
    ),
  )
  const previewed = useRef('{}')
  useEffect(() => {
    if (shownStyle === previewed.current) return
    previewed.current = shownStyle
    preview.current?.(JSON.parse(shownStyle) as Record<string, string>)
  }, [shownStyle])
  useEffect(
    () => () => {
      if (!saved.current && previewed.current !== '{}') preview.current?.(null)
    },
    [],
  )

  const pickImage = async (file: File | undefined) => {
    if (!file) return
    setUploading(true)
    setError('')
    try {
      const res = await uploadImage(artifactId, file)
      setUpload({
        uploadId: res.uploadId,
        name: file.name,
        url: typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null,
      })
    } catch (e) {
      setError(errorText(e))
    } finally {
      setUploading(false)
    }
  }
  const save = async () => {
    setBusy(true)
    const ok = await onSave(ops)
    setBusy(false)
    if (ok) {
      saved.current = true
      onClose()
    }
  }
  const setProp = (p: StyleProp, v: string) => setStyle((s) => ({ ...s, [p]: v }))

  return (
    <Panel title={t('元素')} onClose={onClose}>
      <div className="art-el" data-testid="art-element-panel">
        <div className="art-el__crumbs" title={el.selector}>
          <code className="art-el__tag">{`<${el.tag}>`}</code>
          {crumbs(el.selector).map((c, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: positional parts of one selector
            <span key={i}>{c}</span>
          ))}
        </div>

        <h4 className="art-panel__label">{t('文字')}</h4>
        <Textarea
          aria-label={t('文字')}
          value={el.textOnly ? text : el.text}
          rows={2}
          maxLength={5000}
          disabled={readOnly || !el.textOnly}
          onChange={(e) => setText(e.target.value)}
        />
        {el.textOnly ? null : <p className="art-el__hint">{t('含子元素，交给 AI 修改')}</p>}

        {isImage ? (
          <>
            <h4 className="art-panel__label">{t('图片')}</h4>
            <div className="art-el__image">
              {upload?.url ? <img src={upload.url} alt="" /> : null}
              <code title={el.src ?? ''}>{upload ? upload.name : el.src || '—'}</code>
              <Button
                size="small"
                icon="image"
                loading={uploading}
                disabled={readOnly}
                onClick={() => picker.current?.click()}
              >
                {t('替换图片')}
              </Button>
              <input
                ref={picker}
                type="file"
                hidden
                data-testid="art-element-image"
                accept={Object.keys(ARTIFACT_UPLOAD_TYPES).join(',')}
                onChange={(e) => {
                  void pickImage(e.target.files?.[0])
                  e.target.value = ''
                }}
              />
            </div>
            {upload ? <p className="art-el__hint">{t('保存后替换')}</p> : null}
          </>
        ) : null}

        {isLink ? (
          <>
            <h4 className="art-panel__label">{t('链接')}</h4>
            <Input
              aria-label={t('链接')}
              value={href}
              invalid={badHref}
              placeholder="https://"
              disabled={readOnly}
              onChange={(e) => setHref(e.target.value)}
            />
          </>
        ) : null}

        <h4 className="art-panel__label">{t('点击跳转到')}</h4>
        <PopUpButton
          aria-label={t('点击跳转到')}
          size="small"
          disabled={readOnly}
          value={link}
          onChange={setLink}
          options={[
            { value: '', label: t('无') },
            ...screens.filter((s) => s.id !== el.screenId).map((s) => ({ value: s.id, label: s.title })),
          ]}
        />
        {link ? (
          <div className="art-el__field art-el__field--wide art-el__transition">
            <span>{t('转场')}</span>
            <PopUpButton
              aria-label={t('转场')}
              size="small"
              disabled={readOnly}
              value={transition}
              onChange={setTransition}
              options={[
                { value: '', label: t('不改') },
                { value: 'none', label: t('无转场') },
                { value: 'push', label: t('推入') },
                { value: 'push-back', label: t('推回') },
                { value: 'slide-up', label: t('上滑') },
                { value: 'fade', label: t('淡入') },
              ]}
            />
          </div>
        ) : null}

        <h4 className="art-panel__label">{t('样式')}</h4>
        <div className="art-el__grid">
          {COLOR_FIELDS.map((p) => (
            <div key={p} className="art-el__field art-el__field--wide">
              <span>{FIELD_LABEL[p]}</span>
              <PopUpButton
                aria-label={FIELD_LABEL[p]}
                size="small"
                disabled={readOnly}
                value={style[p] ?? ''}
                onChange={(v) => setProp(p, v)}
                options={[
                  {
                    value: '',
                    label: (
                      <span className="art-el__opt">
                        <Swatch value={el.computed[p] ?? 'transparent'} />
                        {t('默认')}
                      </span>
                    ),
                  },
                  ...colors.map(([k, v]) => ({
                    value: `var(${k})`,
                    label: (
                      <span className="art-el__opt">
                        <Swatch value={v} />
                        {k.slice('--color-'.length)}
                      </span>
                    ),
                  })),
                ]}
              />
            </div>
          ))}
          {SIZE_FIELDS.map((p) => (
            <div key={p} className="art-el__field">
              <span>{FIELD_LABEL[p]}</span>
              <Input
                mono
                aria-label={FIELD_LABEL[p]}
                value={style[p] ?? ''}
                placeholder={el.computed[p] || 'auto'}
                invalid={badStyle.some(([k]) => k === p)}
                disabled={readOnly}
                onChange={(e) => setProp(p, e.target.value)}
              />
            </div>
          ))}
        </div>
        {invalid ? (
          <p className="art-el__hint art-el__hint--bad">
            {t('只能填数值加单位（如 16px）、令牌 var(--…) 或关键字')}
          </p>
        ) : null}
        {error ? <Alert variant="error" description={error} /> : null}
      </div>
      <div className="art-el__foot">
        <Button size="small" onClick={onClose}>
          {t('取消')}
        </Button>
        <Button
          size="small"
          variant="primary"
          loading={busy}
          disabled={readOnly || invalid || uploading || !ops.length}
          onClick={() => void save()}
        >
          {t('保存')}
        </Button>
      </div>
    </Panel>
  )
}
