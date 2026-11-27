import {
  ARTIFACT_UPLOAD_TYPES,
  type ArtifactEditOp,
  attrValueOk,
  SHADOW_PRESETS,
  type StyleProp,
  styleValueOk,
} from '@gonggong/protocol'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { t } from '../../i18n'
import { errorText } from '../../lib/api'
import { Alert, Button, Input, PopUpButton, Textarea } from '../../ui'
import { uploadImage } from './actions'
import { crumbs, type PickedElement, parseInlineStyle, styleChanges } from './elements'
import { hexOf } from './Inspector'
import { Panel } from './SidePanel'
import type { DesignTokens } from './tokens'

const FIELD_LABEL: Record<string, string> = {
  color: t('文字颜色'),
  'background-color': t('背景'),
  'border-color': t('边框颜色'),
  'font-size': t('字号'),
  'font-weight': t('字重'),
  'line-height': t('行高'),
  'letter-spacing': t('字间距'),
  padding: t('内边距'),
  margin: t('外边距'),
  gap: t('间距'),
  'border-radius': t('圆角'),
  'border-width': t('边框粗细'),
  width: t('宽度'),
  height: t('高度'),
}
/** What 外观 edits (墨刀's appearance panel, less what a flowing page cannot have: x, y, rotation). */
const EDITED: StyleProp[] = [
  'width',
  'height',
  'margin',
  'padding',
  'gap',
  'background-color',
  'border-color',
  'border-width',
  'border-style',
  'border-radius',
  'opacity',
  'box-shadow',
  'color',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
  'text-align',
  'font-style',
  'text-decoration',
]
const TRANSITIONS = [
  { value: '', label: t('不改') },
  { value: 'none', label: t('无转场') },
  { value: 'push', label: t('推入') },
  { value: 'push-back', label: t('推回') },
  { value: 'slide-up', label: t('上滑') },
  { value: 'fade', label: t('淡入') },
]

/** A titled group of 外观 / 交互 (墨刀's sections). */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="art-el__section">
      <h4 className="art-panel__label">{title}</h4>
      <div className="art-el__grid">{children}</div>
    </section>
  )
}

/** The colour of a `var(--color-x)` value, for its swatch; tokens hold the values. */
function Swatch({ value }: { value: string }) {
  return <i className="art-swatch" style={{ background: value }} />
}

/**
 * The selected element in the 属性面板 (墨刀's 外观 / 交互 tabs): text, image and inline style, or the screen it
 * opens, its link and the page's 热区; colours from the tokens first, any hex colour too. Style values preview on the element as
 * they are set (`onPreview`); 保存 makes one version, 取消 drops it all and puts the element's style back.
 */
export function ElementPanel({
  view = 'look',
  el,
  artifactId,
  screens,
  tokens,
  readOnly,
  onSave,
  onPreview,
  onHotspot,
  onClose,
}: {
  /** 外观 or 交互 (the inspector's tabs); one draft for both, saved together. */
  view?: 'look' | 'interact'
  el: PickedElement
  artifactId: string
  screens: { id: string; title: string }[]
  tokens: DesignTokens | null
  readOnly: boolean
  onSave: (ops: ArtifactEditOp[]) => Promise<boolean>
  /** The style to show on the element for now (changed properties only, '' removes one); null restores it. */
  onPreview?: (props: Partial<Record<StyleProp, string>> | null) => void
  /** 交互 › 热区: start drawing one on the element's screen. */
  onHotspot?: () => void
  onClose: () => void
}) {
  const inline = useMemo(() => parseInlineStyle(el.inlineStyle), [el.inlineStyle])
  const [text, setText] = useState(el.text)
  const [href, setHref] = useState(el.href ?? '')
  const [link, setLink] = useState(el.link ?? '')
  const [transition, setTransition] = useState('')
  const [style, setStyle] = useState<Record<string, string>>(() =>
    Object.fromEntries(EDITED.map((p) => [p, inline[p] ?? ''])),
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
    preview.current?.(JSON.parse(shownStyle) as Partial<Record<StyleProp, string>>)
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

  const color = (p: StyleProp) => (
    <div key={p} className="art-el__field art-el__field--wide">
      <span>{FIELD_LABEL[p]}</span>
      <div className="art-el__color">
        <PopUpButton
          aria-label={FIELD_LABEL[p]}
          size="small"
          disabled={readOnly}
          value={colors.some(([k]) => style[p] === `var(${k})`) ? (style[p] ?? '') : style[p] ? 'custom' : ''}
          onChange={(v) => setProp(p, v === 'custom' ? (style[p] ?? '') : v)}
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
            ...(style[p] && !style[p]?.startsWith('var(')
              ? [
                  {
                    value: 'custom',
                    label: (
                      <span className="art-el__opt">
                        <Swatch value={style[p] ?? ''} />
                        {style[p]}
                      </span>
                    ),
                  },
                ]
              : []),
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
        <input
          type="color"
          className="art-el__picker"
          aria-label={t('{name}：任意颜色', { name: FIELD_LABEL[p] ?? p })}
          title={t('任意颜色（不在设计系统里，会提示规范问题）')}
          disabled={readOnly}
          value={style[p]?.startsWith('#') ? (style[p] ?? '') : hexOf(el.computed[p] ?? '')}
          onChange={(e) => setProp(p, e.target.value)}
        />
      </div>
    </div>
  )
  const field = (p: StyleProp) => (
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
  )
  const choice = (p: StyleProp, label: string, options: { value: string; label: string }[]) => (
    <div key={p} className="art-el__field">
      <span>{label}</span>
      <PopUpButton
        aria-label={label}
        size="small"
        disabled={readOnly}
        value={style[p] ?? ''}
        onChange={(v) => setProp(p, v)}
        options={[{ value: '', label: t('默认') }, ...options]}
      />
    </div>
  )
  const toggle = (p: StyleProp, on: string, label: string, mark: string) => (
    <button
      key={`${p}:${on}`}
      type="button"
      className="art-el__toggle"
      aria-label={label}
      title={label}
      aria-pressed={style[p] === on}
      disabled={readOnly}
      onClick={() => setProp(p, style[p] === on ? '' : on)}
    >
      {mark}
    </button>
  )
  const opacity = style.opacity ? Math.round(Number(style.opacity) * 100) : 100

  const look = (
    <>
      <h4 className="art-panel__label">{t('文字')}</h4>
      <Textarea
        aria-label={t('文字')}
        value={el.textOnly ? text : el.text}
        rows={2}
        maxLength={5000}
        disabled={readOnly || !el.textOnly}
        onChange={(e) => setText(e.target.value)}
      />
      {el.textOnly ? null : <p className="art-el__hint">{t('含子元素：在屏幕里双击要改的文字')}</p>}

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

      <Section title={t('尺寸')}>
        {field('width')}
        {field('height')}
      </Section>
      <Section title={t('间距')}>
        {field('margin')}
        {field('padding')}
        {field('gap')}
      </Section>
      <Section title={t('填充')}>{color('background-color')}</Section>
      <Section title={t('边框')}>
        {color('border-color')}
        {field('border-width')}
        {choice('border-style', t('线型'), [
          { value: 'solid', label: t('实线') },
          { value: 'dashed', label: t('虚线') },
          { value: 'dotted', label: t('点线') },
          { value: 'none', label: t('无') },
        ])}
        {field('border-radius')}
      </Section>
      <Section title={t('效果')}>
        <div className="art-el__field art-el__field--wide">
          <span>{t('不透明度')}</span>
          <div className="art-el__range">
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              aria-label={t('不透明度')}
              disabled={readOnly}
              value={opacity}
              onChange={(e) =>
                setProp('opacity', e.target.value === '100' ? '' : String(Number(e.target.value) / 100))
              }
            />
            <span>{`${opacity}%`}</span>
          </div>
        </div>
        {choice('box-shadow', t('阴影'), [
          { value: 'none', label: t('无') },
          ...SHADOW_PRESETS.map((v, i) => ({ value: v, label: [t('小'), t('中'), t('大')][i] ?? v })),
        ])}
      </Section>
      <Section title={t('文本#type')}>
        {color('color')}
        {field('font-size')}
        {field('font-weight')}
        {field('line-height')}
        {field('letter-spacing')}
        <div className="art-el__field art-el__field--wide">
          <span>{t('对齐与样式')}</span>
          <div className="art-el__toggles">
            {toggle('text-align', 'left', t('左对齐'), '⇤')}
            {toggle('text-align', 'center', t('居中'), '↔')}
            {toggle('text-align', 'right', t('右对齐'), '⇥')}
            {toggle('font-style', 'italic', t('斜体'), 'I')}
            {toggle('text-decoration', 'underline', t('下划线'), 'U')}
            {toggle('text-decoration', 'line-through', t('删除线'), 'S')}
          </div>
        </div>
      </Section>
      {invalid ? (
        <p className="art-el__hint art-el__hint--bad">
          {t('只能填数值加单位（如 16px）、令牌 var(--…) 或关键字')}
        </p>
      ) : null}
    </>
  )

  const interact = (
    <>
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
            options={TRANSITIONS}
          />
        </div>
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
      {onHotspot ? (
        <>
          <h4 className="art-panel__label">{t('热区')}</h4>
          <p className="art-el__hint">{t('在页面上框出一块区域，点击它跳到别的页面')}</p>
          <Button size="small" icon="target" disabled={readOnly} onClick={onHotspot}>
            {t('添加热区')}
          </Button>
        </>
      ) : null}
      <p className="art-el__hint">{t('动效、显示隐藏等更复杂的交互，在下方输入框里告诉 AI')}</p>
    </>
  )

  return (
    <Panel title={view === 'look' ? t('外观') : t('交互')} onClose={onClose}>
      <div className="art-el" data-testid="art-element-panel">
        <div className="art-el__crumbs" title={el.selector}>
          <code className="art-el__tag">{`<${el.tag}>`}</code>
          {crumbs(el.selector).map((c, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: positional parts of one selector
            <span key={i}>{c}</span>
          ))}
        </div>
        {el.when ? (
          <p className="art-el__hint" data-testid="art-element-when">
            {t('仅在状态 {when} 时显示', { when: el.when })}
          </p>
        ) : null}
        {view === 'look' ? look : interact}
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
