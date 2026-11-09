import { useEffect, useState } from 'react'
import { t } from '../../i18n'
import { Button, EmptyState, FileIcon, Icon, Skeleton } from '../../ui'

/** iOS frames show a PDF's first page only and Android's none at all; the browser's own reader pages through it. */
const touch = () => typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches

/** A frame gives no progress; past this the reader is offered the browser and the download. */
const SLOW_MS = 8000

/**
 * Checked with a HEAD beside the frame: an offline bot or a gone file would otherwise show its JSON error inside it.
 * The HEAD has no body, so a failure reads the GET for the reason.
 */
async function check(url: string): Promise<number | null> {
  let res: Response
  try {
    res = await fetch(url, { method: 'HEAD', credentials: 'include' })
  } catch {
    throw new Error(t('网络连接失败，请检查网络后重试'))
  }
  if (res.ok) {
    const n = res.headers.get('content-length')
    return n ? Number(n) : null
  }
  const body = await fetch(url, { credentials: 'include' })
    .then((r) => r.json() as Promise<{ message?: string }>)
    .catch(() => null)
  throw new Error(body?.message || t('请求失败（HTTP {status}）', { status: res.status }))
}

function OpenLink({ url, primary }: { url: string; primary?: boolean }) {
  return (
    <a
      className={primary ? 'ui-btn ui-btn--primary' : 'ui-btn ui-btn--small'}
      href={url}
      target="_blank"
      rel="noopener noreferrer"
    >
      {primary ? <Icon name="globe" size={16} /> : null}
      {t('在浏览器中打开')}
    </a>
  )
}

/** A PDF in the browser's own viewer: framed on desktop, a card that opens it on touch screens. */
export function PdfView({
  url,
  name,
  meta,
  onSize,
}: {
  url: string
  name: string
  /** The bar's kind and size line, repeated on the card. */
  meta: string
  onSize: (bytes: number) => void
}) {
  const [attempt, setAttempt] = useState(0)
  const key = `${url}#${attempt}`
  const [error, setError] = useState<{ key: string; message: string }>()
  const [loaded, setLoaded] = useState<string>()
  const [slow, setSlow] = useState<string>()
  const [card] = useState(touch)

  useEffect(() => {
    let live = true
    check(url).then(
      (size) => live && size != null && onSize(size),
      (e: Error) => live && setError({ key: `${url}#${attempt}`, message: e.message }),
    )
    const timer = setTimeout(() => setSlow(`${url}#${attempt}`), SLOW_MS)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [url, attempt, onSize])

  const download = (
    <a className="ui-btn ui-btn--small" href={url} download={name}>
      {t('下载')}
    </a>
  )
  if (error?.key === key)
    return (
      <EmptyState
        compact
        icon="warning"
        title={t('无法加载 PDF')}
        description={error.message}
        action={<Button onClick={() => setAttempt((n) => n + 1)}>{t('重试')}</Button>}
      />
    )
  if (card)
    return (
      <div className="fv-pdf-card">
        <FileIcon name={name} size={64} />
        <span className="fv-pdf-card__name">{name}</span>
        <span className="fv-pdf-card__meta">{meta}</span>
        <OpenLink url={url} primary />
        {download}
        <span className="fv-pdf-card__hint">{t('在浏览器自带的阅读器中翻页、缩放与搜索')}</span>
      </div>
    )
  return (
    <div className="fv-pdf" data-loaded={loaded === key || undefined}>
      <iframe key={key} className="fv__pdf" title={name} src={url} onLoad={() => setLoaded(key)} />
      {loaded === key ? null : (
        <div className="fv-pdf__wait">
          <Skeleton className="fv-pdf__page" count={9} label={t('正在加载 PDF…')} />
          {slow === key ? (
            <div className="fv-pdf__slow">
              <span>{t('加载较慢，可在浏览器中打开或下载')}</span>
              <span className="fv-pdf__slow-actions">
                <OpenLink url={url} />
                {download}
              </span>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
