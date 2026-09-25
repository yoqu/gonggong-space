import { Toolbar, ToolbarGroup } from '@web/ui'
import { connKind, host, PILL } from '../lib/labels'
import { useDaemon } from '../store'

/**
 * Unified toolbar that also drags the window (the native title bar is transparent, titleBarStyle Overlay).
 * Without a sidebar the native traffic lights sit over its left end, so `lights` keeps that space free.
 */
export function TitleBar({
  title,
  subtitle,
  lights,
  scrolled,
}: {
  title?: string
  subtitle?: string
  lights?: boolean
  scrolled?: boolean
}) {
  const info = useDaemon((s) => s.info)
  const pill = PILL[connKind(useDaemon((s) => s.snapshot))]
  const text = pill.text === '已连接' ? `已连接 ${host(info?.server)}` : pill.text
  return (
    <Toolbar
      className="dk-toolbar"
      title={title}
      subtitle={subtitle}
      leading={lights ? <span className="dk-lights" /> : undefined}
      scrolled={scrolled}
      data-tauri-drag-region="deep"
    >
      {title ? null : <span className="dk-flex" />}
      <ToolbarGroup>
        <span className="dk-conn" data-testid="conn-pill" style={{ color: pill.color }}>
          <span className="dk-conn__text">{text}</span>
        </span>
      </ToolbarGroup>
    </Toolbar>
  )
}
