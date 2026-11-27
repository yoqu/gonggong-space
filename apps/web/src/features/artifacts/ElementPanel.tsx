import {
  ARTIFACT_UPLOAD_TYPES,
  type ArtifactEditOp,
  attrValueOk,
  FONT_PRESETS,
  type StyleProp,
  styleValueOk,
} from '@gonggong/protocol'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { t } from '../../i18n'
import { errorText } from '../../lib/api'
import { Alert, Button, IconButton, Input, PopUpButton } from '../../ui'
import { uploadImage } from './actions'
import { crumbs, type PickedElement, parseInlineStyle, styleChanges } from './elements'
import { AlignIcon, blurOnEnter, ColorField, Fold, NumField, Toggles, VAlignIcon } from './mkControls'
import { Panel } from './SidePanel'
import type { DesignTokens } from './tokens'

/** What 外观 edits (墨刀's appearance panel, less what a flowing page cannot have: x, y, rotation). */
const EDITED: StyleProp[] = [
  'width',
  'height',
  'margin',
  'padding',
  'gap',
  'background',
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
  'font-family',
  'rotate',
  'align-content',
  'display',
  'margin-left',
  'margin-right',
]
const TRANSITIONS = [
  { value: '', label: t('不改') },
  { value: 'none', label: t('无转场') },
  { value: 'push', label: t('推入') },
  { value: 'push-back', label: t('推回') },
  { value: 'slide-up', label: t('上滑') },
  { value: 'fade', label: t('淡入') },
]

/** How long after a pick (a colour, a toggle, the slider) its change saves: one version for a quick run of picks. */
const AUTO_SAVE_MS = 500

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
  onLayers,
  onAnimate,
  actions,
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
  /** The tab's own actions (编辑文字, 用 AI 修改…), above its fields. */
  actions?: ReactNode
  /** 图层: the selected page's layers. */
  onLayers?: () => void
  /** 动效 ＋: asks the AI to animate the element (动效 are the AI's, 蒋庆 2026-11-27). */
  onAnimate?: () => void
  onClose: () => void
}) {
  const inline = useMemo(() => parseInlineStyle(el.inlineStyle), [el.inlineStyle])
  const [text, _setText] = useState(el.text)
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

  // Only what the member changes: a page's own inline style (rgba(), calc(), a gradient…) never blocks saving.
  const badStyle = Object.entries(style).filter(
    ([k, v]) => v.trim() && v.trim() !== (inline[k] ?? '') && !styleValueOk(v.trim(), k),
  )
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
  // 墨刀-style: a change applies by itself (a new version, undone with 撤销), once the member leaves the text field
  // they type in, or a moment after a pick; never while invalid, uploading or saving.
  const [typing, setTyping] = useState(false)
  const opsKey = JSON.stringify(ops)
  const sent = useRef('[]')
  const save = useRef(async () => {})
  save.current = async () => {
    sent.current = opsKey
    setBusy(true)
    const ok = await onSave(ops)
    setBusy(false)
    if (ok) saved.current = true
  }
  useEffect(() => {
    if (readOnly || invalid || uploading || busy || typing || opsKey === '[]' || opsKey === sent.current)
      return
    const timer = setTimeout(() => void save.current(), AUTO_SAVE_MS)
    return () => clearTimeout(timer)
  }, [opsKey, readOnly, invalid, uploading, busy, typing])
  const textField = (el: EventTarget) =>
    el instanceof HTMLTextAreaElement ||
    (el instanceof HTMLInputElement && (el.type === 'text' || el.type === 'url'))
  const setProp = (p: StyleProp, v: string) => setStyle((s) => ({ ...s, [p]: v }))

  const opacity = style.opacity ? Math.round(Number(style.opacity) * 100) : 100

  const px = (p: StyleProp) =>
    el.computed[p] ? String(Math.round(Number.parseFloat(el.computed[p] ?? '0'))) : ''
  const num = (p: StyleProp, label: string, o: { icon?: ReactNode; unit?: string } = {}) => (
    <NumField
      label={label}
      icon={o.icon}
      unit={o.unit}
      value={style[p] ?? ''}
      placeholder={el.computed[p] || 'auto'}
      invalid={badStyle.some(([k]) => k === p)}
      disabled={readOnly}
      onChange={(v) => setProp(p, v)}
    />
  )
  const colorOf = (p: StyleProp, label: string) => (
    <ColorField
      label={label}
      value={style[p] ?? ''}
      shown={el.computed[p] ?? 'transparent'}
      colors={colors}
      disabled={readOnly}
      onChange={(v) => setProp(p, v)}
    />
  )
  const pressed = (p: StyleProp, on: string) => style[p] === on
  const flip = (p: StyleProp, on: string) => setProp(p, style[p] === on ? '' : on)
  const hidden = style.display === 'none'
  const shadow = /^0 \d+px \d+px (#[0-9a-f]{8})$/i.exec(style['box-shadow'] ?? '')
  const isText = el.textOnly && el.text.trim() !== ''
  const placed = (side: 'left' | 'center' | 'right') =>
    side === 'left'
      ? style['margin-left'] === '0' && style['margin-right'] === 'auto'
      : side === 'right'
        ? style['margin-left'] === 'auto' && style['margin-right'] === '0'
        : style['margin-left'] === 'auto' && style['margin-right'] === 'auto'
  const place = (side: 'left' | 'center' | 'right') =>
    setStyle((st) =>
      placed(side)
        ? { ...st, 'margin-left': '', 'margin-right': '' }
        : {
            ...st,
            'margin-left': side === 'left' ? '0' : 'auto',
            'margin-right': side === 'right' ? '0' : 'auto',
          },
    )

  const look = (
    <>
      <div className="mk-bar">
        <Toggles
          disabled={readOnly}
          items={(['left', 'center', 'right'] as const).map((side) => ({
            label: { left: t('靠左'), center: t('水平居中'), right: t('靠右') }[side],
            mark: <AlignIcon side={side} />,
            on: placed(side),
            onClick: () => place(side),
          }))}
        />
        {onLayers ? (
          <Button size="small" icon="grid" onClick={onLayers}>
            {t('图层')}
          </Button>
        ) : null}
      </div>
      <div className="mk-name">
        <strong title={el.selector}>{el.text.trim().slice(0, 24) || `<${el.tag}>`}</strong>
        <IconButton
          size="small"
          title={hidden ? t('显示') : t('隐藏')}
          aria-pressed={hidden}
          disabled={readOnly}
          onClick={() => setProp('display', hidden ? '' : 'none')}
        >
          {hidden ? ('eye-slash' as const) : ('eye' as const)}
        </IconButton>
      </div>
      {actions}
      {isImage ? (
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
      ) : null}
      <div className="mk-grid">
        <NumField label="X" value={String(Math.round(el.rect.x))} readOnly unit="" />
        <NumField label="Y" value={String(Math.round(el.rect.y))} readOnly unit="" />
        <NumField
          label={t('旋转')}
          icon="⟳"
          unit="deg"
          value={style.rotate ?? ''}
          placeholder="0°"
          invalid={badStyle.some(([k]) => k === 'rotate')}
          disabled={readOnly}
          onChange={(v) => setProp('rotate', v)}
        />
        <NumField
          label={t('宽度')}
          icon="W"
          value={style.width ?? ''}
          placeholder={px('width')}
          invalid={badStyle.some(([k]) => k === 'width')}
          disabled={readOnly}
          onChange={(v) => setProp('width', v)}
        />
        <NumField
          label={t('高度')}
          icon="H"
          value={style.height ?? ''}
          placeholder={px('height')}
          invalid={badStyle.some(([k]) => k === 'height')}
          disabled={readOnly}
          onChange={(v) => setProp('height', v)}
        />
      </div>
      <div className="mk-row">
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

      {isText || el.computed['font-size'] ? (
        <Fold title={t('文本#type')}>
          <PopUpButton
            aria-label={t('字体')}
            size="small"
            disabled={readOnly}
            value={style['font-family'] ?? ''}
            onChange={(v) => setProp('font-family', v)}
            options={[
              { value: '', label: t('默认字体') },
              ...FONT_PRESETS.map((f, i) => ({
                value: f,
                label: [t('系统字体'), t('苹方 / 微软雅黑'), t('思源黑体'), t('衬线'), t('等宽')][i] ?? f,
              })),
            ]}
          />
          {colorOf('color', t('文字颜色'))}
          <div className="mk-row">
            {num('font-size', t('字号'))}
            <Toggles
              disabled={readOnly}
              items={[
                {
                  label: t('加粗'),
                  mark: <b>B</b>,
                  on: pressed('font-weight', '700'),
                  onClick: () => flip('font-weight', '700'),
                },
                {
                  label: t('斜体'),
                  mark: <i>I</i>,
                  on: pressed('font-style', 'italic'),
                  onClick: () => flip('font-style', 'italic'),
                },
                {
                  label: t('下划线'),
                  mark: <u>U</u>,
                  on: pressed('text-decoration', 'underline'),
                  onClick: () => flip('text-decoration', 'underline'),
                },
                {
                  label: t('删除线'),
                  mark: <s>S</s>,
                  on: pressed('text-decoration', 'line-through'),
                  onClick: () => flip('text-decoration', 'line-through'),
                },
              ]}
            />
          </div>
          <div className="mk-row">
            <Toggles
              disabled={readOnly}
              items={(['left', 'center', 'right', 'justify'] as const).map((side) => ({
                label: { left: t('左对齐'), center: t('居中'), right: t('右对齐'), justify: t('两端对齐') }[
                  side
                ],
                mark: <AlignIcon side={side} />,
                on: pressed('text-align', side),
                onClick: () => flip('text-align', side),
              }))}
            />
            <Toggles
              disabled={readOnly}
              items={(['start', 'center', 'end'] as const).map((side) => ({
                label: { start: t('顶部对齐'), center: t('垂直居中'), end: t('底部对齐') }[side],
                mark: <VAlignIcon side={side} />,
                on: pressed('align-content', side),
                onClick: () => flip('align-content', side),
              }))}
            />
          </div>
          <div className="mk-grid mk-grid--2">
            {num('letter-spacing', t('字间距'), { icon: 'A↔' })}
            {num('line-height', t('行高'), { icon: 'A↕', unit: '' })}
            {num('font-weight', t('字重'), { icon: 'Wt', unit: '' })}
          </div>
        </Fold>
      ) : null}

      <Fold title={t('外观')}>
        <div className="mk-row">
          <span>{t('填充')}</span>
          <ColorField
            label={t('背景')}
            value={
              styleValueOk(style.background ?? '', 'background')
                ? (style.background ?? '')
                : (style['background-color'] ?? '')
            }
            shown={el.computed['background-color'] ?? 'transparent'}
            colors={colors}
            disabled={readOnly}
            // The shorthand: a fill also replaces a gradient or image the page painted there.
            onChange={(v) => setStyle((st) => ({ ...st, background: v, 'background-color': '' }))}
          />
        </div>
        <div className="mk-row">
          <span>{t('边框')}</span>
          {colorOf('border-color', t('边框颜色'))}
        </div>
        <div className="mk-grid">
          {num('border-width', t('边框粗细'), { icon: '━' })}
          <PopUpButton
            aria-label={t('线型')}
            size="small"
            disabled={readOnly}
            value={style['border-style'] ?? ''}
            onChange={(v) => setProp('border-style', v)}
            options={[
              { value: '', label: t('默认') },
              { value: 'solid', label: t('实线') },
              { value: 'dashed', label: t('虚线') },
              { value: 'dotted', label: t('点线') },
              { value: 'none', label: t('无') },
            ]}
          />
          {num('border-radius', t('圆角'), { icon: '◜' })}
        </div>
        <div className="mk-row">
          <label className="mk-check">
            <input
              type="checkbox"
              aria-label={t('阴影')}
              checked={!!style['box-shadow'] && style['box-shadow'] !== 'none'}
              disabled={readOnly}
              onChange={(e) => setProp('box-shadow', e.target.checked ? '0 4px 12px #00000066' : '')}
            />
            {t('阴影')}
          </label>
          {shadow ? (
            <ColorField
              label={t('阴影颜色')}
              value={shadow[1] ?? ''}
              shown="#000000"
              colors={[]}
              disabled={readOnly}
              onChange={(v) =>
                setProp('box-shadow', `0 4px 12px ${/^#[0-9a-f]{8}$/i.test(v) ? v : `${v.slice(0, 7)}ff`}`)
              }
            />
          ) : null}
        </div>
      </Fold>

      <Fold title={t('间距')}>
        <div className="mk-grid">
          {num('margin', t('外边距'), { icon: '⬚' })}
          {num('padding', t('内边距'), { icon: '▣' })}
          {num('gap', t('间距'), { icon: '⇹' })}
        </div>
      </Fold>

      <Fold
        title={t('动效')}
        action={
          onAnimate ? (
            <IconButton size="small" title={t('让 AI 加动效')} disabled={readOnly} onClick={onAnimate}>
              {'plus' as const}
            </IconButton>
          ) : null
        }
      />

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
            onKeyDown={blurOnEnter}
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
      <fieldset
        className="art-el"
        data-testid="art-element-panel"
        onFocus={(e) => textField(e.target) && setTyping(true)}
        onBlur={(e) => textField(e.target) && setTyping(false)}
      >
        {el.when ? (
          <p className="art-el__hint" data-testid="art-element-when">
            {t('仅在状态 {when} 时显示', { when: el.when })}
          </p>
        ) : null}
        {view === 'look' ? (
          look
        ) : (
          <>
            <div className="art-el__crumbs" title={el.selector}>
              <code className="art-el__tag">{`<${el.tag}>`}</code>
              {crumbs(el.selector).map((c, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: positional parts of one selector
                <span key={i}>{c}</span>
              ))}
            </div>
            {actions}
            {interact}
          </>
        )}
        {error ? <Alert variant="error" description={error} /> : null}
      </fieldset>
      <p className="art-el__saving" role="status">
        {busy ? t('正在保存…') : readOnly ? t('历史版本只读') : t('改完自动保存，可用撤销退回')}
      </p>
    </Panel>
  )
}
