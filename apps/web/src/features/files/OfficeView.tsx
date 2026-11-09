import { type ReactNode, useEffect, useRef, useState } from 'react'
import { t } from '../../i18n'
import { Button, EmptyState, ProgressIndicator, Tabs } from '../../ui'
import { fmtSize } from '../attachments/api'

export type OfficeKind = 'docx' | 'xlsx' | 'pptx'

/** Parsed in the browser: past this a document freezes the tab, so it is a download. */
const OFFICE_MAX_BYTES = 30 * 1024 * 1024
const SHEET_ROWS = 1000
const SHEET_COLS = 100

type Cell = string | number | boolean | Date | null | object
type Sheet = { sheet: string; data: Cell[][] }

type Loaded = { buf: ArrayBuffer } | { big: number }

/** Slides render at one width and are zoomed to the panel, so a resize never re-parses the deck. */
const SLIDE_WIDTH = 960
const SLIDE_MAX_FIT = 4 / 3
/** The canvas around pages and slides, inside the zoom. */
const PAD = 16

async function load(url: string, progress: (pct: number) => void): Promise<Loaded> {
  let r: Response
  try {
    r = await fetch(url, { credentials: 'include' })
  } catch {
    throw new Error(t('网络连接失败，请检查网络后重试'))
  }
  if (!r.ok) {
    const body = (await r.json().catch(() => null)) as { message?: string } | null
    throw new Error(body?.message || t('请求失败（HTTP {status}）', { status: r.status }))
  }
  const size = Number(r.headers.get('content-length'))
  if (size > OFFICE_MAX_BYTES) {
    void r.body?.cancel()
    return { big: size }
  }
  if (!size || !r.body) return { buf: await r.arrayBuffer() }
  const reader = r.body.getReader()
  const parts: Uint8Array<ArrayBuffer>[] = []
  let got = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
    got += value.length
    // A compressed response counts more bytes than its length; it is never "done" before parsing.
    progress(Math.min(99, Math.floor((got * 100) / size)))
  }
  return { buf: await new Blob(parts).arrayBuffer() }
}

/** Thrown by the libraries on a damaged or unsupported file; their own messages mean nothing to a reader. */
class ParseError extends Error {}

/**
 * Word and slides render into a frame whose scripts are off: the libraries write the document's own markup
 * (pptx-preview through innerHTML), so nothing in a file may run in our origin. Links open in a new tab.
 * Returns the width the content needs at 100%, and how far it may grow.
 */
async function renderInto(kind: 'docx' | 'pptx', doc: Document, buf: ArrayBuffer) {
  // The libraries' inline sizes and later-inserted styles win without !important. Pages stay paper white on the
  // app's canvas (the frame is transparent), as in Word and Keynote's dark mode; paper keeps paper's text colour.
  // The frame is in quirks mode (no doctype), where tables do not inherit the colour.
  doc.head.innerHTML = `<base target="_blank"><style>
html{overflow-y:scroll}body{margin:0;background:transparent}
.docx-wrapper,.pptx-preview-wrapper{zoom:var(--fit,1)}
.docx-wrapper>section,.pptx-preview-slide-wrapper{color-scheme:light;color:#000}
.docx-wrapper table{color:inherit}
.docx-wrapper{background:none!important;padding:${PAD}px ${PAD}px 0!important}
.docx-wrapper>section.docx{margin-bottom:${PAD}px!important;box-shadow:0 1px 2px rgba(0,0,0,.12),0 4px 16px rgba(0,0,0,.08)!important}
.pptx-preview-wrapper{height:auto!important;overflow:visible!important;background:none!important;padding:${PAD}px;margin:0 auto}
.pptx-preview-slide-wrapper{margin:0 auto ${PAD}px!important;box-shadow:0 1px 2px rgba(0,0,0,.12),0 4px 16px rgba(0,0,0,.08)}
</style>`
  doc.body.replaceChildren()
  if (kind === 'docx') {
    const { renderAsync } = await import('docx-preview')
    // Its styles go into the body with the document: it empties the style container, which would drop ours.
    await renderAsync(buf, doc.body, undefined, {
      renderAltChunks: false,
      useBase64URL: true,
      ignoreLastRenderedPageBreak: true,
    }).catch((e: unknown) => {
      throw new ParseError(String(e))
    })
    const pages = [...doc.querySelectorAll<HTMLElement>('.docx-wrapper > section')]
    const width = Math.max(0, ...pages.map((p) => p.offsetWidth))
    return { dispose: () => {}, width: width && width + 2 * PAD, max: 1 }
  }
  const { init } = await import('pptx-preview')
  const p = init(doc.body, { width: SLIDE_WIDTH, mode: 'list' })
  await p.preview(buf).catch((e: unknown) => {
    throw new ParseError(String(e))
  })
  return { dispose: () => p.destroy(), width: SLIDE_WIDTH + 2 * PAD, max: SLIDE_MAX_FIT }
}

/** Follows the app's theme: a frame whose color scheme differs from its parent's paints an opaque canvas. */
function followTheme(doc: Document) {
  const sync = () => {
    doc.documentElement.style.colorScheme = getComputedStyle(document.documentElement).colorScheme
  }
  sync()
  const watch = new MutationObserver(sync)
  watch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return () => watch.disconnect()
}

/** Zooms pages and slides to the frame's width as the panel resizes. */
function fitTo(frame: HTMLIFrameElement, doc: Document, width: number, max: number) {
  if (!width) return () => {}
  const fit = () => {
    const room = doc.documentElement.clientWidth
    if (room) doc.documentElement.style.setProperty('--fit', String(Math.min(max, room / width)))
  }
  fit()
  const watch = new ResizeObserver(fit)
  watch.observe(frame)
  return () => watch.disconnect()
}

const column = (i: number): string =>
  (i < 26 ? '' : column(Math.floor(i / 26) - 1)) + String.fromCharCode(65 + (i % 26))

function cellText(v: Cell) {
  if (v === null) return ''
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (typeof v === 'number') return String(Number(v.toPrecision(15)))
  if (v instanceof Date) {
    const iso = v.toISOString()
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${iso.slice(11, 16)}`
  }
  return String(v)
}

/** Long text is cut to the column width; the whole value shows on hover. */
const LONG_CELL = 40

function SheetView({ sheets }: { sheets: Sheet[] }) {
  const [at, setAt] = useState('0')
  const data = sheets[Number(at)]?.data ?? []
  const rows = data.slice(0, SHEET_ROWS)
  const width = Math.min(SHEET_COLS, Math.max(0, ...rows.map((r) => r.length)))
  const cut = data.length > rows.length || rows.some((r) => r.length > width)
  return (
    <div className="fv-sheet">
      {sheets.length > 1 ? (
        <div className="fv-sheet__tabs">
          <Tabs
            size="sm"
            value={at}
            onChange={setAt}
            items={sheets.map((s, i) => ({ value: String(i), label: s.sheet }))}
          />
        </div>
      ) : null}
      {width ? (
        // Keyed by sheet: another sheet starts at its top-left corner.
        <div key={at} className="fv-sheet__grid">
          <table>
            <thead>
              <tr>
                <th />
                {Array.from({ length: width }, (_, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional
                  <th key={i}>{column(i)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
                <tr key={i}>
                  <th>{i + 1}</th>
                  {Array.from({ length: width }, (_, j) => {
                    const text = cellText(r[j] ?? null)
                    return (
                      <td
                        // biome-ignore lint/suspicious/noArrayIndexKey: cells are positional
                        key={j}
                        data-num={typeof r[j] === 'number' || undefined}
                        title={text.length > LONG_CELL ? text : undefined}
                      >
                        {text}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="fv__none">{t('此工作表为空')}</div>
      )}
      {cut ? (
        <div className="fv__note">
          {t('仅显示前 {rows} 行、{cols} 列，完整内容请下载', { rows: SHEET_ROWS, cols: SHEET_COLS })}
        </div>
      ) : null}
    </div>
  )
}

type State = {
  /** Download progress in percent, then parsing once the bytes are in. */
  pct?: number
  parsing?: boolean
  sheets?: Sheet[]
  done?: boolean
  big?: number
  error?: string
}

/** Word, Excel and PowerPoint (the OOXML formats) previewed from their bytes. */
export function OfficeView({
  kind,
  url,
  name,
  download,
}: {
  kind: OfficeKind
  url: string
  name: string
  /** What to show instead: a message with the download link. */
  download: (message: string) => ReactNode
}) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [state, setState] = useState<State>({})
  const [attempt, setAttempt] = useState(0)

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt re-runs it for 重试
  useEffect(() => {
    let live = true
    const offs: (() => void)[] = []
    setState({})
    ;(async () => {
      const got = await load(url, (pct) => live && setState((s) => (s.pct === pct ? s : { pct })))
      if (!live) return
      if ('big' in got) return setState({ big: got.big })
      setState({ parsing: true })
      if (kind === 'xlsx') {
        const { default: read } = await import('read-excel-file/universal')
        const sheets = (await read(got.buf).catch((e: unknown) => {
          throw new ParseError(String(e))
        })) as Sheet[]
        if (live) setState({ sheets })
        return
      }
      const el = frame.current
      const doc = el?.contentDocument
      if (!el || !doc) return
      offs.push(followTheme(doc))
      const { dispose, width, max } = await renderInto(kind, doc, got.buf)
      offs.push(dispose)
      if (!live) return
      offs.push(fitTo(el, doc, width, max))
      setState({ done: true })
    })().catch(
      (e: unknown) =>
        live &&
        setState({
          error:
            e instanceof ParseError
              ? t('文件可能已损坏或格式不受支持，可下载后用本机应用打开')
              : e instanceof Error
                ? e.message
                : t('读取失败'),
        }),
    )
    return () => {
      live = false
      for (const off of offs) off()
    }
  }, [kind, url, attempt])

  if (state.big !== undefined)
    return download(
      t('文件过大（{size}，超过 {max}），可下载查看', {
        size: fmtSize(state.big),
        max: fmtSize(OFFICE_MAX_BYTES),
      }),
    )
  if (state.error)
    return (
      <EmptyState
        compact
        icon="warning"
        title={t('无法预览文件')}
        description={state.error}
        action={
          <>
            <Button onClick={() => setAttempt((n) => n + 1)}>{t('重试')}</Button>
            <a className="ui-btn" href={url} download={name}>
              {t('下载')}
            </a>
          </>
        }
      />
    )
  const label = state.parsing
    ? t('正在解析…')
    : state.pct === undefined
      ? t('正在读取…')
      : t('正在读取… {pct}%', { pct: state.pct })
  const wait = (
    <div className="fv-office__wait">
      <span role="status">{label}</span>
      <ProgressIndicator
        className="fv-office__progress"
        value={state.parsing ? undefined : state.pct}
        aria-label={label}
      />
    </div>
  )
  if (kind === 'xlsx') return state.sheets ? <SheetView sheets={state.sheets} /> : wait
  return (
    <div className="fv-office" data-loaded={state.done || undefined}>
      <iframe
        ref={frame}
        className="fv-office__frame"
        title={name}
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      />
      {state.done ? null : wait}
    </div>
  )
}
