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
let onError: ReturnType<typeof vi.fn<(operation: 'copy' | 'paste') => void>>

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
    await vi.waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith('selected output'))
    expect(terminal.pasted).toEqual([])
  })

  it('does not copy an empty selection', () => {
    attach()
    terminal.selection = ''
    expect(terminal.keyHandler?.(key('c', { ctrlKey: true, shiftKey: true }))).toBe(true)
    expect(clipboard.writeText).not.toHaveBeenCalled()
  })

  it('pastes through xterm once and opens terminal search', async () => {
    attach()
    const paste = key('v', { ctrlKey: true, shiftKey: true })
    expect(terminal.keyHandler?.(paste)).toBe(false)
    await vi.waitFor(() => expect(terminal.pasted).toEqual(['from clipboard']))

    const search = key('f', { ctrlKey: true, shiftKey: true })
    expect(terminal.keyHandler?.(search)).toBe(false)
    expect(onSearch).toHaveBeenCalledTimes(1)
    expect(terminal.pasted).toEqual(['from clipboard'])
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
    expect(terminal.keyHandler?.(key('c', { metaKey: true }))).toBe(false)
    await vi.waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith('selected output'))
    expect(terminal.keyHandler?.(key('v', { metaKey: true }))).toBe(false)
    await vi.waitFor(() => expect(terminal.pasted).toEqual(['from clipboard']))
    expect(terminal.keyHandler?.(key('f', { metaKey: true }))).toBe(false)
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
    clipboard.readText.mockRejectedValue(new Error('denied'))
    clipboard.writeText.mockRejectedValue(new Error('denied'))
    attach()
    terminal.keyHandler?.(key('v', { ctrlKey: true, shiftKey: true }))
    terminal.keyHandler?.(key('c', { ctrlKey: true, shiftKey: true }))
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(2))
    expect(terminal.pasted).toEqual([])
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

  it('does not run clipboard actions after disposal', async () => {
    let read: ((text: string) => void) | undefined
    clipboard.readText.mockImplementation(() => new Promise<string>((resolve) => (read = resolve)))
    const dispose = attach()
    terminal.keyHandler?.(key('v', { ctrlKey: true, shiftKey: true }))
    dispose()
    read?.('late')
    await Promise.resolve()
    expect(terminal.pasted).toEqual([])
    window.dispatchEvent(new Event('focus'))
    expect(terminal.focused).toBe(0)
  })
})
