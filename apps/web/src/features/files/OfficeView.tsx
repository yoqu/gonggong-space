import { type ReactNode, useEffect, useRef, useState } from 'react'
import { t } from '../../i18n'
import { Button, EmptyState, Spinner, Tabs } from '../../ui'
import { fmtSize } from '../attachments/api'

export type OfficeKind = 'docx' | 'xlsx' | 'pptx'

/** Parsed in the browser: past this a document freezes the tab, so it is a download. */
const OFFICE_MAX_BYTES = 30 * 1024 * 1024
const SHEET_ROWS = 1000
const SHEET_COLS = 100

type Cell = string | number | boolean | Date | null | object
type Sheet = { sheet: string; data: Cell[][] }

type Loaded = { buf: ArrayBuffer } | { big: number }

async function load(url: string): Promise<Loaded> {
  const r = await fetch(url, { credentials: 'include' })
  if (!r.ok) throw new Error(t('读取失败'))
  const size = Number(r.headers.get('content-length'))
  if (size > OFFICE_MAX_BYTES) {
    void r.body?.cancel()
    return { big: size }
  }
  return { buf: await r.arrayBuffer() }
}

/**
 * Word and slides render into a frame whose scripts are off: the libraries write the document's own markup
 * (pptx-preview through innerHTML), so nothing in a file may run in our origin. Links open in a new tab.
 */
async function renderInto(kind: 'docx' | 'pptx', doc: Document, buf: ArrayBuffer) {
  // pptx-preview's list scrolls inside a black box of the given height; the frame scrolls the slides instead.
  doc.head.innerHTML = `<base target="_blank"><style>
html{overflow-y:scroll}body{margin:0;background:#f2f2f7}
.docx-wrapper{background:none!important}
.pptx-preview-wrapper{height:auto!important;overflow:visible!important;background:none!important;padding:16px 0}
</style>`
  doc.body.replaceChildren()
  if (kind === 'docx') {
    const { renderAsync } = await import('docx-preview')
    // Its styles go into the body with the document: it empties the style container, which would drop ours.
    await renderAsync(buf, doc.body, undefined, {
      renderAltChunks: false,
      useBase64URL: true,
      ignoreLastRenderedPageBreak: true,
    })
    return () => {}
  }
  const { init } = await import('pptx-preview')
  const width = Math.max(320, doc.body.clientWidth - 32)
  const p = init(doc.body, { width, height: Math.round((width * 9) / 16), mode: 'list' })
  await p.preview(buf)
  return () => p.destroy()
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

function SheetView({ sheets }: { sheets: Sheet[] }) {
  const [at, setAt] = useState('0')
  const data = sheets[Number(at)]?.data ?? []
  const rows = data.slice(0, SHEET_ROWS)
  const width = Math.min(SHEET_COLS, Math.max(0, ...rows.map((r) => r.length)))
  const cut = data.length > rows.length || rows.some((r) => r.length > width)
  return (
    <div className="fv-sheet">
      {sheets.length > 1 ? (
        <Tabs
          size="sm"
          value={at}
          onChange={setAt}
          items={sheets.map((s, i) => ({ value: String(i), label: s.sheet }))}
        />
      ) : null}
      <div className="fv-sheet__grid">
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
                {Array.from({ length: width }, (_, j) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: cells are positional
                  <td key={j} data-num={typeof r[j] === 'number' || undefined}>
                    {cellText(r[j] ?? null)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cut ? (
        <div className="fv__note">
          {t('仅显示前 {rows} 行、{cols} 列，完整内容请下载', { rows: SHEET_ROWS, cols: SHEET_COLS })}
        </div>
      ) : null}
    </div>
  )
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
  const [state, setState] = useState<{ sheets?: Sheet[]; done?: boolean; big?: number; error?: string }>({})
  const [attempt, setAttempt] = useState(0)

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt re-runs it for 重试
  useEffect(() => {
    let live = true
    let dispose = () => {}
    setState({})
    ;(async () => {
      const got = await load(url)
      if (!live) return
      if ('big' in got) return setState({ big: got.big })
      if (kind === 'xlsx') {
        const { default: read } = await import('read-excel-file/universal')
        const sheets = (await read(got.buf)) as Sheet[]
        if (live) setState({ sheets })
        return
      }
      const doc = frame.current?.contentDocument
      if (!doc) return
      const off = await renderInto(kind, doc, got.buf)
      if (live) {
        dispose = off
        setState({ done: true })
      } else off()
    })().catch((e: unknown) => live && setState({ error: e instanceof Error ? e.message : t('读取失败') }))
    return () => {
      live = false
      dispose()
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
        action={<Button onClick={() => setAttempt((n) => n + 1)}>{t('重试')}</Button>}
      />
    )
  if (kind === 'xlsx')
    return state.sheets ? (
      <SheetView sheets={state.sheets} />
    ) : (
      <div className="fv__state">
        <Spinner />
      </div>
    )
  return (
    <div className="fv-office">
      {state.done ? null : (
        <div className="fv-office__wait">
          <Spinner />
        </div>
      )}
      <iframe
        ref={frame}
        className="fv__pdf"
        title={name}
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      />
    </div>
  )
}
