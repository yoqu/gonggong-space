import type { ArtifactEditOp, BotDto } from '@gonggong/protocol'
import { type ReactNode, useEffect, useState } from 'react'
import { t } from '../../i18n'
import { Button, CloseButton, Icon, type IconName, Select, Textarea } from '../../ui'
import { offlineHint } from './actions'
import type { PickedElement } from './elements'
import { ImageUrlForm, isImage, type TextEditing, textEditingHint, useImageUpload } from './inPlace'

const WIDTH = 272
const GAP = 12
/** Room the right-hand toolbar takes. */
export const TOOLS = 64
/** The floating selection toolbar's bottom edge: popovers stay below it. */
const FLOAT_BOTTOM = 56

interface Box {
  left: number
  top: number
  width: number
  height: number
}

/** The canvas's size and how much of its right edge the tools (and an open side panel) take. */
export interface PopRoom {
  width: number
  height: number
  right: number
}

/**
 * Beside the element: right of it when there is room, else left; kept inside the free part of the canvas, below the
 * selection toolbar. Null while the element is out of that part (panned or zoomed away).
 */
export function besideBox(box: Box, room: PopRoom) {
  const free = room.width - Math.max(TOOLS, room.right)
  const away =
    box.left + box.width < 0 || box.left > free || box.top + box.height < 0 || box.top > room.height
  // An unmeasured canvas (width 0) hides nothing.
  if (room.width && away) return null
  const right = box.left + box.width + GAP
  const left =
    right + WIDTH <= free ? right : Math.max(GAP, Math.min(box.left - GAP - WIDTH, free - GAP - WIDTH))
  const top = Math.min(Math.max(FLOAT_BOTTOM, box.top), Math.max(FLOAT_BOTTOM, room.height - 240))
  return { left, top, width: WIDTH }
}

function Floating({
  box,
  room,
  title,
  label,
  onClose,
  children,
}: {
  box: Box
  room: PopRoom
  title: ReactNode
  label: string
  onClose: () => void
  children: ReactNode
}) {
  const at = besideBox(box, room)
  if (!at) return null
  return (
    <div
      className="art-pop"
      role="dialog"
      aria-label={label}
      style={at}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') onClose()
      }}
    >
      <header className="art-pop__head">
        <span className="art-pop__title">{title}</span>
        <CloseButton onClick={onClose} />
      </header>
      {children}
    </div>
  )
}

/** The bot a request goes to: a picker when the group has several, and a note while it is offline. */
export function BotChoice({
  bots,
  bot,
  onPick,
}: {
  bots: BotDto[]
  bot: BotDto | null
  onPick: (id: string) => void
}) {
  const offline = offlineHint(bot)
  return (
    <>
      {bots.length > 1 ? (
        <div className="art-pop__bot">
          <span>{t('交给')}</span>
          <Select
            label={t('交给')}
            options={bots.map((b) => ({ value: b.id, label: `@${b.name}` }))}
            value={bot?.id ?? null}
            onChange={onPick}
          />
        </div>
      ) : null}
      {offline ? (
        <p className="art-pop__offline" role="note">
          {offline}
        </p>
      ) : null}
    </>
  )
}

function Action({
  icon,
  label,
  hint,
  destructive,
  active,
  disabled,
  onClick,
}: {
  icon: IconName
  label: string
  hint?: string
  destructive?: boolean
  active?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`art-pop__action${destructive ? ' art-pop__action--danger' : ''}${active ? ' art-pop__action--on' : ''}`}
      aria-pressed={active}
      disabled={disabled}
      title={hint}
      onClick={onClick}
    >
      <Icon name={icon} size={15} />
      <span>{label}</span>
      {hint ? <small>{hint}</small> : null}
    </button>
  )
}

/**
 * Stitch's Edit Element (Direct Edit, capability list §4), in the 属性面板 under the tab it belongs to: 外观 edits the
 * text in place in the screen (or picks a text inside the element), replaces an image by its address or a file, has
 * the AI change the element, or deletes it; 交互 has the AI imagine the screen it opens, or adds a page rule on it.
 * Where it leads (连到屏幕) is the 交互 tab's own 点击跳转到.
 */
export function ElementActions({
  group,
  el,
  readOnly,
  bots,
  bot,
  onPickBot,
  texting,
  onEditText,
  artifactId,
  onApply,
  onAi,
  onConnect,
  onRule,
  onDelete,
  ask,
}: {
  group: 'look' | 'interact'
  /** Opens 用 AI 修改 with this request written (动效 ＋), each new `n` once. */
  ask?: { text: string; n: number }
  el: PickedElement
  readOnly: boolean
  bots: BotDto[]
  bot: BotDto | null
  onPickBot: (id: string) => void
  /** Whether the element's text is being picked or typed in the screen. */
  texting: TextEditing
  onEditText: () => void
  artifactId: string
  onApply: (ops: ArtifactEditOp[]) => Promise<boolean>
  onAi: (text: string) => Promise<boolean>
  /** Imagine new screen: a screen the AI makes from `text`, linked from this element. */
  onConnect: (text: string) => Promise<boolean>
  /** 添加规则: a page rule on this element. */
  onRule: () => void
  onDelete: () => void
}) {
  const [step, setStep] = useState<'menu' | 'image' | 'ai' | 'connect'>(ask ? 'ai' : 'menu')
  const [request, setAsk] = useState(ask?.text ?? '')
  const askN = ask?.n
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new ask only
  useEffect(() => {
    if (!ask) return
    setAsk(ask.text)
    setStep('ai')
  }, [askN])
  const [busy, setBusy] = useState(false)
  const located = el.ggId !== null
  const run = async (f: () => Promise<boolean>) => {
    setBusy(true)
    const ok = await f()
    setBusy(false)
    if (ok) {
      setAsk('')
      setStep('menu')
    }
  }
  const noSource = located ? undefined : t('脚本生成的元素，只能批注')
  const ro = readOnly ? t('历史版本只读') : undefined
  const aiHint = noSource ?? (bot ? (offlineHint(bot) ?? undefined) : t('暂无可用 Bot'))
  const image = isImage(el)
  const upload = useImageUpload(artifactId, el, (ops) => run(() => onApply(ops)))
  const status = textEditingHint(texting)

  return (
    <section className="art-el__actions" aria-label={t('模块操作')}>
      {step === 'menu' ? (
        <div className={group === 'look' ? 'art-pop__actions art-pop__actions--row' : 'art-pop__actions'}>
          {group === 'look' ? (
            <>
              {image ? (
                <>
                  <Action
                    icon="globe"
                    label={t('输入图片地址')}
                    hint={ro ?? noSource}
                    disabled={readOnly || !located}
                    onClick={() => setStep('image')}
                  />
                  <Action
                    icon="upload"
                    label={t('上传图片')}
                    hint={ro ?? noSource ?? (upload.busy ? t('上传中…') : undefined)}
                    disabled={readOnly || !located || upload.busy}
                    onClick={upload.open}
                  />
                  {upload.input}
                </>
              ) : (
                <Action
                  icon="textformat"
                  label={t('编辑文字')}
                  hint={ro ?? noSource}
                  active={texting !== null}
                  disabled={readOnly || !located}
                  onClick={onEditText}
                />
              )}
              {status ? (
                <p className="art-pop__status" role="status">
                  {status}
                </p>
              ) : null}
              <Action
                icon="sparkle"
                label={t('用 AI 修改')}
                hint={aiHint}
                disabled={!located || !bot}
                onClick={() => setStep('ai')}
              />
              <Action
                icon="trash"
                label={t('删除')}
                destructive
                hint={ro ?? noSource}
                disabled={readOnly || !located}
                onClick={onDelete}
              />
            </>
          ) : (
            <>
              <Action
                icon="plus"
                label={t('构想新屏')}
                hint={aiHint}
                disabled={!located || !bot}
                onClick={() => setStep('connect')}
              />
              <Action icon="checklist" label={t('添加规则')} hint={ro} disabled={readOnly} onClick={onRule} />
            </>
          )}
        </div>
      ) : step === 'image' ? (
        <ImageUrlForm
          el={el}
          readOnly={readOnly}
          onApply={(ops) => run(() => onApply(ops))}
          onBack={() => setStep('menu')}
        />
      ) : (
        <form
          className="art-pop__form"
          onSubmit={(e) => {
            e.preventDefault()
            if (request.trim()) void run(() => (step === 'ai' ? onAi : onConnect)(request.trim()))
          }}
        >
          <Textarea
            aria-label={step === 'ai' ? t('修改要求') : t('新屏描述')}
            placeholder={step === 'ai' ? t('描述要怎么改这个元素…') : t('描述点它之后打开的新屏…')}
            value={request}
            rows={3}
            maxLength={2000}
            autoFocus
            onChange={(e) => setAsk(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit()
            }}
          />
          <BotChoice bots={bots} bot={bot} onPick={onPickBot} />
          <div className="art-pop__row">
            <Button size="small" variant="plain" onClick={() => setStep('menu')}>
              {t('返回')}
            </Button>
            <Button
              size="small"
              variant="primary"
              icon="send"
              type="submit"
              disabled={busy || !request.trim()}
            >
              {bot ? t('发给 @{name}', { name: bot.name }) : t('发送')}
            </Button>
          </div>
        </form>
      )}
    </section>
  )
}

/** Mark (M): a note on the clicked element, kept with the version for the AI. */
export function MarkPopover({
  title,
  box,
  room,
  onSave,
  onClose,
}: {
  /** What is annotated: `首页 › h1`, or a region of a screen. */
  title: string
  box: Box
  room: PopRoom
  onSave: (note: string) => Promise<boolean>
  onClose: () => void
}) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (!note.trim()) return
    setBusy(true)
    const ok = await onSave(note.trim())
    setBusy(false)
    if (ok) onClose()
  }
  return (
    <Floating
      box={box}
      room={room}
      title={<span className="art-pop__el">{title}</span>}
      label={t('批注')}
      onClose={onClose}
    >
      <form
        className="art-pop__form"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <Textarea
          aria-label={t('意见')}
          placeholder={t('写下修改意见…')}
          value={note}
          rows={3}
          maxLength={2000}
          autoFocus
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit()
          }}
        />
        <div className="art-pop__row">
          <Button size="small" variant="plain" onClick={onClose}>
            {t('取消')}
          </Button>
          <Button size="small" variant="primary" type="submit" disabled={busy || !note.trim()}>
            {t('添加批注')}
          </Button>
        </div>
      </form>
    </Floating>
  )
}
