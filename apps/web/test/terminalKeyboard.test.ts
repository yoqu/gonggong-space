import { beforeEach, describe, expect, it, vi } from 'vitest'
import { attachTerminalKeyboard } from '../src/features/terminal/keyboard'

class TerminalStub {
  textarea: HTMLTextAreaElement | undefined
  focused = 0
  blurred = 0
  pasted: string[] = []
  selection = 'selected output'
  keyHandler: ((event: KeyboardEvent) => boolean) | undefined

  attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean) {
    this.keyHandler = handler
  }
  focus() {
    this.focused++
    this.textarea?.focus()
  }
  blur() {
    this.blurred++
    this.textarea?.blur()
  }
  paste(text: string) {
    this.pasted.push(text)
  }
  getSelection() {
    return this.selection
  }
}

const key = (value: string, options: KeyboardEventInit = {}) =>
  new KeyboardEvent('keydown', { key: value, cancelable: true, ...options })

let terminal: TerminalStub
let host: HTMLDivElement
let clipboard: {
  readText: ReturnType<typeof vi.fn<() => Promise<string>>>
  writeText: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>
}
let onSearch: ReturnType<typeof vi.fn<() => void>>
let onError: ReturnType<typeof vi.fn<() => void>>

const attach = (active = () => true) => {
  return attachTerminalKeyboard(terminal, {
    host,
    active,
    macOS: false,
    clipboard,
    onSearch,
    onError,
  })
}

beforeEach(() => {
  host = document.createElement('div')
  terminal = new TerminalStub()
  terminal.textarea = document.createElement('textarea')
  host.append(terminal.textarea)
  document.body.append(host)
  clipboard = {
    readText: vi.fn().mockResolvedValue('from clipboard'),
    writeText: vi.fn().mockResolvedValue(undefined),
  }
  onSearch = vi.fn()
  onError = vi.fn()
})

describe('terminal keyboard', () => {
  it.each([
    ['c', '\u0003'],
    ['d', '\u0004'],
    ['z', '\u001a'],
  ])('leaves Ctrl+%s to xterm, which emits %s', (value, control) => {
    attach()
    const event = key(value, { ctrlKey: true })
    expect(terminal.keyHandler?.(event)).toBe(true)
    expect(event.defaultPrevented).toBe(false)
    expect(control.charCodeAt(0)).toBe(value.charCodeAt(0) - 96)
    expect(clipboard.writeText).not.toHaveBeenCalled()
    expect(terminal.pasted).toEqual([])
    expect(onSearch).not.toHaveBeenCalled()
  })

  it('copies the selected terminal text with Ctrl+Shift+C and stops browser handling', async () => {
    attach()
    const event = key('C', { ctrlKey: true, shiftKey: true })
    expect(terminal.keyHandler?.(event)).toBe(false)
    expect(event.defaultPrevented).toBe(true)
    await vi.waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith('selected output'))
    expect(terminal.pasted).toEqual([])
  })

  it('does not copy an empty selection', () => {
    attach()
    terminal.selection = ''
    expect(terminal.keyHandler?.(key('c', { ctrlKey: true, shiftKey: true }))).toBe(true)
    expect(clipboard.writeText).not.toHaveBeenCalled()
  })

  it('leaves paste to the native paste event so xterm pastes exactly once', async () => {
    attach()
    const paste = key('v', { ctrlKey: true, shiftKey: true })
    expect(terminal.keyHandler?.(paste)).toBe(true)
    expect(paste.defaultPrevented).toBe(false)
    await Promise.resolve()
    expect(clipboard.readText).not.toHaveBeenCalled()
    expect(terminal.pasted).toEqual([])
  })

  it('opens terminal search instead of the browser find bar', () => {
    attach()
    const search = key('f', { ctrlKey: true, shiftKey: true })
    expect(terminal.keyHandler?.(search)).toBe(false)
    expect(search.defaultPrevented).toBe(true)
    expect(onSearch).toHaveBeenCalledTimes(1)
  })

  it('supports macOS Command shortcuts without intercepting plain Ctrl shortcuts', async () => {
    const dispose = attachTerminalKeyboard(terminal, {
      host,
      active: () => true,
      macOS: true,
      clipboard,
      onSearch,
      onError,
    })
    expect(terminal.keyHandler?.(key('c', { ctrlKey: true }))).toBe(true)
    expect(terminal.keyHandler?.(key('v', { ctrlKey: true }))).toBe(true)
    expect(terminal.keyHandler?.(key('f', { ctrlKey: true }))).toBe(true)
    const copy = key('c', { metaKey: true })
    expect(terminal.keyHandler?.(copy)).toBe(false)
    expect(copy.defaultPrevented).toBe(true)
    await vi.waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith('selected output'))
    const paste = key('v', { metaKey: true })
    expect(terminal.keyHandler?.(paste)).toBe(true)
    expect(paste.defaultPrevented).toBe(false)
    expect(clipboard.readText).not.toHaveBeenCalled()
    expect(terminal.pasted).toEqual([])
    const search = key('f', { metaKey: true })
    expect(terminal.keyHandler?.(search)).toBe(false)
    expect(search.defaultPrevented).toBe(true)
    expect(onSearch).toHaveBeenCalledTimes(1)
    dispose()
  })

  it.each([{ isComposing: true }, { keyCode: 229 }])('leaves IME composition to xterm: %o', (options) => {
    attach()
    const event = key('Process', { ctrlKey: true, shiftKey: true, ...options })
    expect(terminal.keyHandler?.(event)).toBe(true)
    expect(event.defaultPrevented).toBe(false)
    expect(clipboard.writeText).not.toHaveBeenCalled()
    expect(onSearch).not.toHaveBeenCalled()
  })

  it('reports clipboard failures without unhandled rejections', async () => {
    clipboard.writeText.mockRejectedValue(new Error('denied'))
    attach()
    terminal.keyHandler?.(key('c', { ctrlKey: true, shiftKey: true }))
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
  })

  it('focuses only while active and blurs the hidden terminal', () => {
    let active = false
    attach(() => active)
    terminal.focus()
    terminal.focused = 0
    terminal.blurred = 0
    window.dispatchEvent(new Event('blur'))
    expect(terminal.blurred).toBe(1)
    window.dispatchEvent(new Event('focus'))
    expect(terminal.focused).toBe(0)
    active = true
    window.dispatchEvent(new Event('focus'))
    expect(terminal.focused).toBe(1)
    window.dispatchEvent(new Event('blur'))
    expect(terminal.blurred).toBe(2)
  })

  it('focuses terminal clicks but leaves dialogs and other editors alone', () => {
    attach()
    const editor = document.createElement('input')
    document.body.append(editor)
    editor.focus()
    window.dispatchEvent(new Event('focus'))
    expect(terminal.focused).toBe(0)

    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    const button = document.createElement('button')
    dialog.append(button)
    host.append(dialog)
    button.focus()
    window.dispatchEvent(new Event('focus'))
    expect(terminal.focused).toBe(0)
    dialog.remove()

    host.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(terminal.focused).toBe(1)
    editor.remove()
  })

  it('does not steal window focus from a control used after the terminal', () => {
    attach()
    const editor = document.createElement('input')
    document.body.append(editor)
    terminal.focus()
    terminal.focused = 0
    editor.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    editor.focus()
    window.dispatchEvent(new Event('focus'))
    expect(terminal.focused).toBe(0)
    expect(document.activeElement).toBe(editor)
    editor.remove()
  })

  it('does not report clipboard failures after disposal', async () => {
    let fail: ((error: Error) => void) | undefined
    clipboard.writeText.mockImplementation(() => new Promise<void>((_, reject) => (fail = reject)))
    const dispose = attach()
    terminal.keyHandler?.(key('c', { ctrlKey: true, shiftKey: true }))
    await vi.waitFor(() => expect(fail).toBeDefined())
    dispose()
    fail?.(new Error('late'))
    await new Promise((resolve) => setTimeout(resolve))
    expect(onError).not.toHaveBeenCalled()
    window.dispatchEvent(new Event('focus'))
    expect(terminal.focused).toBe(0)
  })
})
