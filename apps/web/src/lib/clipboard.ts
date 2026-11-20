import { t } from '../i18n'
import { toast } from '../ui/toast'

/** Copies text; plain-http LAN access has no `navigator.clipboard`, so it falls back to a selected textarea. */
export async function copyText(text: string) {
  if (navigator.clipboard) return navigator.clipboard.writeText(text)
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.append(area)
  area.select()
  try {
    if (!document.execCommand('copy')) throw new Error('copy refused')
  } finally {
    area.remove()
  }
}

const COPIED_FLASH = 1500

// The button behind a copy: copies run from click handlers, so the capturing listener has seen it by then; an older
// click means a keyboard shortcut copied, which has no button to mark.
const PRESS_WINDOW = 1000
let pressed: { button: HTMLButtonElement | null; at: number } | undefined
document.addEventListener(
  'click',
  (e) => {
    pressed = { button: (e.target as Element).closest?.('button') ?? null, at: Date.now() }
  },
  true,
)

let live: HTMLElement | undefined
const copiedTimers = new WeakMap<HTMLButtonElement, ReturnType<typeof setTimeout>>()
/** Confirms a copy on the pressed button (a ✓ for a moment, announced for screen readers); a menu item, gone or
 *  closing by now, can't show it. */
function flashCopied(b: HTMLButtonElement | null | undefined, done: string) {
  if (!b?.isConnected || b.closest('[role="menu"]') || !b.getClientRects().length) return false
  if (getComputedStyle(b).position === 'static') b.style.position = 'relative'
  const prev = copiedTimers.get(b)
  if (prev !== undefined) clearTimeout(prev)
  b.dataset.copied = ''
  copiedTimers.set(
    b,
    setTimeout(() => {
      delete b.dataset.copied
      copiedTimers.delete(b)
    }, COPIED_FLASH),
  )
  if (!live?.isConnected) {
    live = document.createElement('div')
    live.className = 'ui-copied-live'
    live.setAttribute('role', 'status')
    document.body.append(live)
  }
  live.textContent = done
  return true
}

/** Copies text, confirming on the pressed button when it is still there and with a toast otherwise. */
export const copyWithToast = (text: string, done: string, fail = t('复制失败')) => {
  const button = pressed && Date.now() - pressed.at < PRESS_WINDOW ? pressed.button : null
  return copyText(text).then(
    () => void (flashCopied(button, done) || toast({ type: 'success', message: done })),
    () => void toast({ type: 'error', message: fail }),
  )
}
