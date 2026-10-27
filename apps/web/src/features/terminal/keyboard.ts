import type { Terminal } from '@xterm/xterm'

type KeyboardTerminal = Pick<
  Terminal,
  'textarea' | 'attachCustomKeyEventHandler' | 'focus' | 'blur' | 'getSelection'
>

type TerminalClipboard = Pick<globalThis.Clipboard, 'writeText'>

export interface TerminalKeyboardOptions {
  host: HTMLElement
  active: () => boolean
  onSearch: () => void
  onError: () => void
  macOS?: boolean
  clipboard?: TerminalClipboard
}

const editing = (element: Element | null) =>
  element?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')

/** Leaves PTY control keys and IME events to xterm; only consumes browser-owned terminal shortcuts. */
export function attachTerminalKeyboard(terminal: KeyboardTerminal, options: TerminalKeyboardOptions) {
  const { host, active, onSearch, onError } = options
  const macOS = options.macOS ?? /Mac|iPhone|iPad|iPod/.test(navigator.platform)
  const clipboard = options.clipboard ?? navigator.clipboard
  const listeners = new AbortController()
  let disposed = false
  let restoreFocus = false
  let ownsFocus = false

  const copy = (event: KeyboardEvent) => {
    const selection = terminal.getSelection()
    if (!selection) return true
    event.preventDefault()
    void Promise.resolve()
      .then(() => {
        if (!clipboard) throw new Error('Clipboard unavailable')
        return clipboard.writeText(selection)
      })
      .catch(() => {
        if (!disposed && active()) onError()
      })
    return false
  }

  // xterm does not cancel events the handler rejects, so consumed shortcuts must preventDefault
  // themselves. Paste stays native: xterm's paste listener already applies bracketed paste.
  terminal.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown' || event.defaultPrevented || event.isComposing || event.keyCode === 229)
      return true
    const modifier = macOS
      ? event.metaKey && !event.ctrlKey
      : event.ctrlKey && event.shiftKey && !event.metaKey
    if (!modifier || event.altKey) return true
    switch (event.key.toLowerCase()) {
      case 'c':
        return copy(event)
      case 'f':
        event.preventDefault()
        onSearch()
        return false
      default:
        return true
    }
  })

  const focus = () => {
    if (
      disposed ||
      !active() ||
      (document.activeElement instanceof Element &&
        host.contains(document.activeElement) &&
        document.activeElement !== terminal.textarea)
    )
      return
    terminal.focus()
  }
  const pointer = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target : null
    if (event.button !== 0 || editing(target) || target?.closest('[role="dialog"]')) return
    focus()
  }
  const focused = (event: FocusEvent) => {
    ownsFocus = host.contains(event.target as Node)
    if (ownsFocus) restoreFocus = true
  }
  const refocus = () => {
    if (restoreFocus && !editing(document.activeElement)) focus()
  }
  const blur = () => {
    restoreFocus = host.contains(document.activeElement)
    if (!disposed) terminal.blur()
  }
  const pointerOutside = (event: MouseEvent) => {
    if (event.target instanceof Node && !host.contains(event.target)) restoreFocus = false
  }
  host.addEventListener('mousedown', pointer, { signal: listeners.signal })
  document.addEventListener('focusin', focused, { signal: listeners.signal })
  document.addEventListener('mousedown', pointerOutside, { signal: listeners.signal })
  window.addEventListener('focus', refocus, { signal: listeners.signal })
  window.addEventListener('blur', blur, { signal: listeners.signal })

  return () => {
    disposed = true
    listeners.abort()
    terminal.attachCustomKeyEventHandler(() => true)
  }
}
