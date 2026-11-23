/**
 * Open-artifact chrome protocol (`vendor/open-artifact/packages/protocol/src/shell.ts`):
 * lets an embedded editor report top-bar state (saved, actions, export formats, comments),
 * receive top-bar commands, sync current slide hash, and relay clipboard writes.
 */

export type ChromeDraw = 'saved' | 'actions' | 'formats' | 'shareNotice' | 'peers'
export type ChromeSavedState = 'saved' | 'saving' | 'unsaved' | 'reconnecting' | 'readonly'
export type ChromeExportState = 'started' | 'done' | 'busy' | 'unsupported' | 'declined' | 'failed'

export interface ChromeAction {
  id: string
  label: string
  disabled?: boolean
  active?: boolean
  shortcut?: string
}

export interface ChromeFormatVariant {
  id: string
  label: string
  description?: string
}

export interface ChromeFormat {
  id: string
  label: string
  interactive?: boolean
  variants?: ChromeFormatVariant[]
}

export interface ChromeReport {
  saved?: ChromeSavedState
  leaveLosesWork?: boolean
  actions?: ChromeAction[]
  formats?: ChromeFormat[]
  comments?: { available?: boolean; on?: boolean; open?: boolean; count?: number; pageButton?: boolean }
  history?: boolean
  agent?: { available?: boolean; listening?: boolean; busy?: boolean }
}

export type ChromeCommand =
  | { cmd: 'goto_slide'; hash: string }
  | { cmd: 'comments_mode'; on?: boolean; anchor?: string }
  | { cmd: 'comments_list'; open?: boolean }
  | { cmd: 'history' }
  | { cmd: 'action'; id: string }
  | { cmd: 'export_format'; request: string; format: string; variant?: string }
  | { cmd: 'exports'; id: string }
  | { cmd: 'follow'; key: string | null }

export interface ShellChromeHandlers {
  onReport?: (report: ChromeReport) => void
  onCurrentSlide?: (hash: string) => void
  onCopySlideLink?: (hash: string) => void
  onCommentMode?: (on: boolean, anchor?: string) => void
  onExportState?: (ev: { request: string; state: ChromeExportState; reason?: string }) => void
}

export const CHROME_DRAWS: ChromeDraw[] = ['saved', 'actions', 'formats', 'shareNotice', 'peers']

export function sendChromeHello(win: Window | null, origin: string) {
  win?.postMessage({ openArtifact: 'chrome_hello', draws: CHROME_DRAWS, clipboard: true }, origin)
}

export function sendChromeCommand(win: Window | null, origin: string, command: ChromeCommand) {
  win?.postMessage({ openArtifact: 'chrome_cmd', ...command }, origin)
}

export function newExportRequestId() {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Handles one `PageToShell` chrome/clipboard message. Returns true when handled. */
export function handleChromeMessage(
  data: Record<string, unknown>,
  win: Window | null,
  origin: string,
  handlers: ShellChromeHandlers | undefined,
): boolean {
  const kind = data.openArtifact
  if (kind === 'chrome_report' && data.report && typeof data.report === 'object') {
    handlers?.onReport?.(data.report as ChromeReport)
    return true
  }
  if (kind === 'current_slide' && typeof data.hash === 'string') {
    handlers?.onCurrentSlide?.(data.hash)
    return true
  }
  if (kind === 'copy_slide_link' && typeof data.hash === 'string') {
    handlers?.onCopySlideLink?.(data.hash)
    return true
  }
  if (kind === 'request_comment_mode' && typeof data.on === 'boolean') {
    handlers?.onCommentMode?.(data.on, typeof data.anchor === 'string' ? data.anchor : undefined)
    return true
  }
  if (kind === 'chrome_export' && typeof data.request === 'string' && typeof data.state === 'string') {
    handlers?.onExportState?.({
      request: data.request,
      state: data.state as ChromeExportState,
      reason: typeof data.reason === 'string' ? data.reason : undefined,
    })
    return true
  }
  if (kind === 'clipboard_write') {
    // Wait for `clipboard_data` carrying the Blobs.
    return true
  }
  if (kind === 'clipboard_data' && typeof data.id === 'string') {
    void relayClipboard(
      data.id,
      data.items as Record<string, Blob> | undefined,
      data.error as string | undefined,
      win,
      origin,
    )
    return true
  }
  if (kind === 'files_changed_ok' || kind === 'chrome_exports') return true
  return false
}

async function relayClipboard(
  id: string,
  items: Record<string, Blob> | undefined,
  upstreamError: string | undefined,
  win: Window | null,
  origin: string,
) {
  if (upstreamError || !items || !Object.keys(items).length) {
    win?.postMessage({ openArtifact: 'clipboard_done', id, error: upstreamError ?? 'empty' }, origin)
    return
  }
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem(items)])
    } else if (items['text/plain'] && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(await items['text/plain'].text())
    } else {
      throw new Error('Clipboard API unavailable')
    }
    win?.postMessage({ openArtifact: 'clipboard_done', id }, origin)
  } catch (err) {
    win?.postMessage(
      { openArtifact: 'clipboard_done', id, error: err instanceof Error ? err.message : 'clipboard_failed' },
      origin,
    )
  }
}
