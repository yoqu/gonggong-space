import type { BotDto } from '@gonggong/protocol'
import { type ReactNode, useState } from 'react'
import { t } from '../../i18n'
import { Button, CloseButton, Icon, type IconName, Select, Textarea } from '../../ui'
import type { PickedElement } from './elements'

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

/** The bot a request goes to: a picker when the group has several. */
export function BotChoice({
  bots,
  bot,
  onPick,
}: {
  bots: BotDto[]
  bot: BotDto | null
  onPick: (id: string) => void
}) {
  if (bots.length < 2) return null
  return (
    <div className="art-pop__bot">
      <span>{t('交给')}</span>
      <Select
        label={t('交给')}
        options={bots.map((b) => ({ value: b.id, label: `@${b.name}` }))}
        value={bot?.id ?? null}
        onChange={onPick}
      />
    </div>
  )
}

function Action({
  icon,
  label,
  hint,
  destructive,
  disabled,
  onClick,
}: {
  icon: IconName
  label: string
  hint?: string
  destructive?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`art-pop__action${destructive ? ' art-pop__action--danger' : ''}`}
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
 * Stitch's Edit Element (Direct Edit, capability list §4): edit the text in place, have the AI change the element, or
 * delete it; 属性 opens the element panel.
 */
export function EditPopover({
  el,
  box,
  room,
  readOnly,
  bots,
  bot,
  onPickBot,
  onText,
  onAi,
  onConnect,
  onProps,
  onDelete,
  onClose,
}: {
  el: PickedElement
  box: Box
  room: PopRoom
  readOnly: boolean
  bots: BotDto[]
  bot: BotDto | null
  onPickBot: (id: string) => void
  onText: (text: string) => Promise<boolean>
  onAi: (text: string) => Promise<boolean>
  /** Imagine new screen: a screen the AI makes from `text`, linked from this element. */
  onConnect: (text: string) => Promise<boolean>
  onProps: () => void
  onDelete: () => void
  onClose: () => void
}) {
  const [step, setStep] = useState<'menu' | 'text' | 'ai' | 'connect'>('menu')
  const [text, setText] = useState(el.text)
  const [ask, setAsk] = useState('')
  const [busy, setBusy] = useState(false)
  const located = el.ggId !== null
  const run = async (f: () => Promise<boolean>) => {
    setBusy(true)
    const ok = await f()
    setBusy(false)
    if (ok) onClose()
  }
  const noSource = located ? undefined : t('脚本生成的元素，只能批注')
  const ro = readOnly ? t('AI 正在修改') : undefined

  return (
    <Floating box={box} room={room} title={t('编辑元素')} label={t('编辑元素')} onClose={onClose}>
      {step === 'menu' ? (
        <div className="art-pop__actions">
          <Action
            icon="textformat"
            label={t('编辑文字')}
            hint={ro ?? noSource ?? (el.textOnly ? undefined : t('含子元素，交给 AI 修改'))}
            disabled={readOnly || !located || !el.textOnly}
            onClick={() => setStep('text')}
          />
          <Action
            icon="sparkle"
            label={t('用 AI 修改')}
            hint={noSource ?? (bot ? undefined : t('群里没有 Bot'))}
            disabled={!located || !bot}
            onClick={() => setStep('ai')}
          />
          <Action
            icon="link"
            label={t('连到新屏…')}
            hint={noSource ?? (bot ? undefined : t('群里没有 Bot'))}
            disabled={!located || !bot}
            onClick={() => setStep('connect')}
          />
          <Action
            icon="slider-horizontal"
            label={t('属性')}
            hint={ro ?? noSource}
            disabled={readOnly || !located}
            onClick={onProps}
          />
          <Action
            icon="trash"
            label={t('删除')}
            destructive
            hint={ro ?? noSource}
            disabled={readOnly || !located}
            onClick={onDelete}
          />
        </div>
      ) : step === 'text' ? (
        <form
          className="art-pop__form"
          onSubmit={(e) => {
            e.preventDefault()
            if (text !== el.text) void run(() => onText(text))
          }}
        >
          <Textarea
            aria-label={t('文字')}
            value={text}
            rows={3}
            maxLength={5000}
            autoFocus
            onChange={(e) => setText(e.target.value)}
          />
          <div className="art-pop__row">
            <Button size="small" variant="plain" onClick={() => setStep('menu')}>
              {t('返回')}
            </Button>
            <Button size="small" variant="primary" type="submit" disabled={busy || text === el.text}>
              {t('保存')}
            </Button>
          </div>
        </form>
      ) : (
        <form
          className="art-pop__form"
          onSubmit={(e) => {
            e.preventDefault()
            if (ask.trim()) void run(() => (step === 'ai' ? onAi : onConnect)(ask.trim()))
          }}
        >
          <Textarea
            aria-label={step === 'ai' ? t('修改要求') : t('新屏描述')}
            placeholder={step === 'ai' ? t('描述要怎么改这个元素…') : t('描述点它之后打开的新屏…')}
            value={ask}
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
            <Button size="small" variant="primary" icon="send" type="submit" disabled={busy || !ask.trim()}>
              {bot ? t('发给 @{name}', { name: bot.name }) : t('发送')}
            </Button>
          </div>
        </form>
      )}
    </Floating>
  )
}

/** Mark (M): a note on the clicked element, kept with the version for the AI. */
export function MarkPopover({
  el,
  box,
  room,
  onSave,
  onClose,
}: {
  el: PickedElement
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
      title={<span className="art-pop__el">{`${el.screenTitle} › ${el.tag}`}</span>}
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
