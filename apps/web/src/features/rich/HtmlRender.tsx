import {
  HTML_RENDER_COLUMN_WIDTH,
  type HtmlRenderRef,
  type HtmlRenderTheme,
  htmlRenderFrameHeight,
  htmlRenderResult,
  htmlRenderTheme,
  htmlRenderThemeFragment,
  htmlRenderThemeMessage,
  readHtmlRenderContentHeight,
  readHtmlRenderLinkRequest,
} from '@gonggong/protocol'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { t } from '../../i18n'
import { Dialog, IconButton } from '../../ui'
import { attachmentUrl } from '../attachments/api'
import { token } from './theme'
import './html-render.css'

const subscribe = (onChange: () => void) => {
  const mo = new MutationObserver(onChange)
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return () => mo.disconnect()
}
const themeName = () => document.documentElement.dataset.theme ?? 'light'

/** The app's current tokens under the page's variable names; follows theme switches. */
function usePageTheme(): HtmlRenderTheme {
  const name = useSyncExternalStore(subscribe, themeName)
  return useMemo(() => htmlRenderTheme(name.endsWith('dark') ? 'dark' : 'light', token), [name])
}

/**
 * A published page in an opaque-origin frame (never allow-same-origin: it must not reach the app's session). It
 * reports its height, takes the app theme and asks to open links; a link opens only while the reader is using the
 * frame, since a page script can post at any time.
 */
function PageFrame({
  page,
  className,
  onContentHeight,
}: {
  page: HtmlRenderRef
  className: string
  onContentHeight?: (height: number) => void
}) {
  const theme = usePageTheme()
  const frame = useRef<HTMLIFrameElement>(null)
  // The first URL stays: a new fragment would reload the page and lose its state.
  const [src] = useState(() => `${attachmentUrl(page.attachmentId)}/render${htmlRenderThemeFragment(theme)}`)
  const postTheme = () => frame.current?.contentWindow?.postMessage(htmlRenderThemeMessage(theme), '*')
  useEffect(postTheme, [theme])
  const heightRef = useRef(onContentHeight)
  heightRef.current = onContentHeight
  // At commit: a fast page may post its first height before passive effects run.
  useLayoutEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const f = frame.current
      if (!f || e.source !== f.contentWindow) return
      const height = readHtmlRenderContentHeight(e.data)
      if (height !== undefined) return heightRef.current?.(height)
      const link = readHtmlRenderLinkRequest(e.data)
      if (!link || document.activeElement !== f || navigator.userActivation?.isActive === false) return
      window.open(link.url, '_blank', 'noopener,noreferrer')
      f.contentWindow?.postMessage(htmlRenderResult(link.id), '*')
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])
  return (
    <iframe
      ref={frame}
      src={src}
      title={page.title}
      sandbox="allow-scripts allow-forms"
      loading="lazy"
      className={className}
      // Covers a theme switch while the page was loading.
      onLoad={postTheme}
    />
  )
}

/** A bot's html_render page, inline in the chat at the reply column's width, with a full-screen view. */
export function HtmlRender({ page }: { page: HtmlRenderRef }) {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(HTML_RENDER_COLUMN_WIDTH)
  // Client fonts can wrap the page taller than it was measured; the live height wins.
  const [contentHeight, setContentHeight] = useState<number>()
  const [full, setFull] = useState(false)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    if (el.clientWidth) setWidth(el.clientWidth)
    const ro = new ResizeObserver(([entry]) => {
      if (entry?.contentRect.width) setWidth(entry.contentRect.width)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <div
      ref={box}
      className="html-render"
      style={{ height: htmlRenderFrameHeight(page, width, contentHeight) }}
    >
      <PageFrame page={page} className="html-render__frame" onContentHeight={setContentHeight} />
      <IconButton
        title={t('全屏查看')}
        variant="glass"
        size="small"
        className="html-render__expand"
        onClick={() => setFull(true)}
      >
        {'expand' as const}
      </IconButton>
      {full && (
        <Dialog open onClose={() => setFull(false)} title={page.title} width={1200}>
          <PageFrame page={page} className="html-render__full" />
        </Dialog>
      )}
    </div>
  )
}
