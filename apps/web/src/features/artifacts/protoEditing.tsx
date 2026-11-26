import type { ArtifactEditOp, ArtifactTransition, BotDto, Rect } from '@gonggong/protocol'
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import { t } from '../../i18n'
import { cx } from '../../lib/cx'
import { Button, CloseButton, Icon, type IconName, PopUpButton, Textarea, useEscape } from '../../ui'
import { offlineHint } from './actions'
import { BotChoice } from './ElementPopover'
import type { PickedElement } from './elements'
import { ImageUrlForm, isImage, type TextEditing, textEditingHint, useImageUpload } from './inPlace'
import { connectOps, disconnectOps, menuPlace } from './prototype'
import { Panel } from './SidePanel'

// The prototype editor's edit-mode pieces (PrototypeEditor.tsx): asking the bot, the element menu, connecting.

export const TRANSITIONS: { value: ArtifactTransition; label: string }[] = [
  { value: 'none', label: t('无转场') },
  { value: 'push', label: t('推入') },
  { value: 'push-back', label: t('推回') },
  { value: 'slide-up', label: t('上滑') },
  { value: 'fade', label: t('淡入') },
]
export const isTransition = (v: unknown): v is ArtifactTransition => TRANSITIONS.some((x) => x.value === v)
/** The popover's width on screen. */
const MENU_W = 248
/** The popover's height before it is measured (its four actions). */
const MENU_H = 190

/** A request to the bot: text, the bot when the group has several, send. */
export function AskForm({
  label,
  placeholder,
  bots,
  bot,
  onPickBot,
  onSend,
  onClose,
  children,
}: {
  label: string
  placeholder: string
  bots: BotDto[]
  bot: BotDto | null
  onPickBot: (id: string) => void
  onSend: (text: string) => Promise<boolean>
  onClose: () => void
  children?: ReactNode
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const send = async () => {
    if (!text.trim()) return
    setBusy(true)
    const ok = await onSend(text.trim())
    setBusy(false)
    if (ok) onClose()
  }
  return (
    <form
      className="art-pop__form proto-ask"
      onSubmit={(e) => {
        e.preventDefault()
        void send()
      }}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') onClose()
      }}
    >
      <Textarea
        aria-label={label}
        placeholder={placeholder}
        value={text}
        rows={3}
        maxLength={2000}
        autoFocus
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit()
        }}
      />
      <BotChoice bots={bots} bot={bot} onPick={onPickBot} />
      {children}
      <div className="art-pop__row">
        <Button size="small" variant="plain" onClick={onClose}>
          {t('取消')}
        </Button>
        <Button
          size="small"
          variant="primary"
          icon="send"
          type="submit"
          disabled={busy || !text.trim() || !bot}
        >
          {bot ? t('发给 @{name}', { name: bot.name }) : t('发送')}
        </Button>
      </div>
    </form>
  )
}

/** The AI pill's request bar under the device: describe how to change this screen. */
export function ChangeBar({
  beside,
  raised,
  ...props
}: {
  /** The connect panel is open: keep clear of it. */
  beside: boolean
  /** Above the rail along a narrow stage's bottom. */
  raised: boolean
  bots: BotDto[]
  bot: BotDto | null
  onPickBot: (id: string) => void
  onSend: (text: string) => Promise<boolean>
  onClose: () => void
}) {
  return (
    <div className={cx('proto-change', beside && 'proto-change--beside', raised && 'proto-change--raised')}>
      <AskForm label={t('修改要求')} placeholder={t('描述要怎么改这屏…')} {...props}>
        <small className="proto-change__hint">{t('Esc 关闭')}</small>
      </AskForm>
    </div>
  )
}

/** Edit mode's element menu (Stitch: Connect to screen, Edit text, Change with AI, Imagine new screen). */
export function ElementMenu({
  el,
  anchor,
  room,
  edges,
  readOnly,
  bots,
  bot,
  onPickBot,
  onConnect,
  texting,
  onEditText,
  artifactId,
  onApply,
  onAi,
  onImagine,
  onDisconnect,
  onClose,
}: {
  el: PickedElement
  /** The element on the stage. */
  anchor: Rect
  room: { width: number; height: number }
  /** What the screen list and the rail take of the stage's sides. */
  edges: { left: number; right: number }
  readOnly: boolean
  bots: BotDto[]
  bot: BotDto | null
  onPickBot: (id: string) => void
  onConnect: () => void
  /** Whether the element's text is being picked or typed in the screen. */
  texting: TextEditing
  onEditText: () => void
  artifactId: string
  onApply: (ops: ArtifactEditOp[]) => Promise<boolean>
  onAi: (text: string) => Promise<boolean>
  onImagine: (text: string) => Promise<boolean>
  onDisconnect: () => Promise<boolean>
  onClose: () => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(MENU_H)
  // Each step (the actions, a form) has its own height: placed by the one it has now.
  useLayoutEffect(() => {
    const h = box.current?.offsetHeight
    if (h && h !== height) setHeight(h)
  })
  const [step, setStep] = useState<'menu' | 'image' | 'ai' | 'imagine'>('menu')
  const [busy, setBusy] = useState(false)
  const located = el.ggId !== null
  const noSource = located ? undefined : t('脚本生成的元素，只能批注')
  const noBot = bot ? undefined : t('暂无可用 Bot')
  const offline = offlineHint(bot) ?? undefined
  const ro = readOnly ? t('历史版本只读') : undefined
  const status = textEditingHint(texting)
  const apply = async (ops: ArtifactEditOp[]) => (await onApply(ops)) && onClose()
  const upload = useImageUpload(artifactId, el, apply)
  const at = menuPlace(anchor, { w: MENU_W, h: height }, room, edges)
  /** `hint` says why it is off; `note` (an offline bot) only informs. */
  const action = (
    icon: IconName,
    label: string,
    hint: string | undefined,
    onClick: () => void,
    note?: string,
    danger?: boolean,
    on?: boolean,
  ) => (
    <button
      type="button"
      className={cx('art-pop__action', danger && 'art-pop__action--danger', on && 'art-pop__action--on')}
      aria-pressed={on}
      disabled={!!hint}
      title={hint ?? note}
      onClick={onClick}
    >
      <Icon name={icon} size={15} />
      <span>{label}</span>
      {hint || note ? <small>{hint ?? note}</small> : null}
    </button>
  )
  return (
    <div
      ref={box}
      className="art-pop proto-pop"
      role="dialog"
      aria-label={t('编辑元素')}
      style={{ ...at, width: MENU_W }}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') onClose()
      }}
    >
      <header className="art-pop__head">
        <span className="art-pop__title">{t('编辑元素')}</span>
        <CloseButton onClick={onClose} />
      </header>
      {step === 'menu' ? (
        <div className="art-pop__actions">
          {action('link', el.link ? t('编辑连接') : t('连到屏幕'), ro ?? noSource, onConnect)}
          {isImage(el) ? (
            <>
              {action('globe', t('输入图片地址'), ro ?? noSource, () => setStep('image'))}
              {action(
                'upload',
                t('上传图片'),
                ro ?? noSource ?? (upload.busy ? t('上传中…') : undefined),
                upload.open,
              )}
              {upload.input}
            </>
          ) : (
            action(
              'textformat',
              t('编辑文字'),
              ro ?? noSource,
              onEditText,
              undefined,
              false,
              texting !== null,
            )
          )}
          {status ? (
            <p className="art-pop__status" role="status">
              {status}
            </p>
          ) : null}
          {action('sparkle', t('用 AI 修改'), noSource ?? noBot, () => setStep('ai'), offline)}
          {action('plus', t('构想新屏'), noSource ?? noBot, () => setStep('imagine'), offline)}
          {el.link
            ? action(
                'xmark-circle',
                t('移除连接'),
                ro ?? noSource,
                async () => {
                  setBusy(true)
                  const ok = await onDisconnect()
                  setBusy(false)
                  if (ok) onClose()
                },
                undefined,
                true,
              )
            : null}
        </div>
      ) : step === 'image' ? (
        <ImageUrlForm el={el} readOnly={readOnly} onApply={apply} onBack={() => setStep('menu')} />
      ) : (
        <AskForm
          label={step === 'ai' ? t('修改要求') : t('新屏描述')}
          placeholder={step === 'ai' ? t('描述要怎么改这个元素…') : t('描述点它之后打开的新屏…')}
          bots={bots}
          bot={bot}
          onPickBot={onPickBot}
          onSend={step === 'ai' ? onAi : onImagine}
          onClose={onClose}
        />
      )}
    </div>
  )
}

/** Connect Element: the screen the element opens and how it moves there; Disconnect removes the link. */
export function ConnectPanel({
  el,
  screens,
  readOnly,
  onApply,
  onClose,
}: {
  el: PickedElement
  screens: { id: string; title: string }[]
  readOnly: boolean
  onApply: (ops: ArtifactEditOp[]) => Promise<boolean>
  onClose: () => void
}) {
  const [to, setTo] = useState(el.link && screens.some((s) => s.id === el.link) ? el.link : '')
  const [transition, setTransition] = useState<ArtifactTransition>(
    isTransition(el.transition) ? el.transition : 'push',
  )
  const [busy, setBusy] = useState(false)
  useEscape(onClose)
  const where = { file: el.file, ggId: el.ggId ?? '' }
  const unchanged =
    to === (el.link ?? '') && transition === (isTransition(el.transition) ? el.transition : 'push')
  const run = async (ops: ArtifactEditOp[]) => {
    setBusy(true)
    const ok = await onApply(ops)
    setBusy(false)
    if (ok) onClose()
  }
  return (
    <Panel title={t('连接元素')} onClose={onClose}>
      <div className="art-el proto-connect" data-testid="proto-connect">
        <p className="art-el__crumbs">
          <code className="art-el__tag">{`<${el.tag}>`}</code>
          <span>{el.text.slice(0, 40)}</span>
        </p>
        <h4 className="art-panel__label">{t('连到屏幕')}</h4>
        <PopUpButton
          aria-label={t('连到屏幕')}
          size="small"
          disabled={readOnly}
          value={to}
          placeholder={t('选择屏幕')}
          onChange={setTo}
          options={screens.map((s) => ({ value: s.id, label: s.title }))}
        />
        <h4 className="art-panel__label">{t('转场')}</h4>
        <PopUpButton<ArtifactTransition>
          aria-label={t('转场')}
          size="small"
          disabled={readOnly}
          value={transition}
          onChange={setTransition}
          options={TRANSITIONS}
        />
      </div>
      <div className="art-el__foot">
        {el.link ? (
          <Button
            size="small"
            disabled={readOnly || busy}
            onClick={() => void run(disconnectOps({ ...where, transition: el.transition }))}
          >
            {t('断开连接')}
          </Button>
        ) : null}
        <Button
          size="small"
          variant="primary"
          loading={busy}
          disabled={readOnly || !to || unchanged}
          onClick={() => void run(connectOps(where, to, transition))}
        >
          {t('应用连接')}
        </Button>
      </div>
    </Panel>
  )
}
