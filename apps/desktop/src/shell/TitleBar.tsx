import { Icon, Toolbar, ToolbarGroup } from '@web/ui'
import { t } from '../i18n'
import { ipc } from '../ipc'
import { connKind, host, PILL } from '../lib/labels'
import { fail } from '../lib/ui'
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
  const kind = connKind(useDaemon((s) => s.snapshot))
  const pill = PILL[kind]
  const text = pill === PILL.ok ? t('已连接 {host}', { host: host(info?.server) }) : pill.text
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
        {pill === PILL.ok ? (
          <button
            type="button"
            className="dk-conn dk-conn--link"
            data-testid="conn-pill"
            title={t('在浏览器中打开共工')}
            style={{ color: pill.color }}
            onClick={() => void ipc.openWeb().catch(fail)}
          >
            <span className="dk-conn__text">{text}</span>
            <Icon name="external" size={12} className="dk-conn__icon" />
          </button>
        ) : (
          <span
            className={kind === 'unbound' ? 'dk-conn dk-conn--offline' : 'dk-conn'}
            data-testid="conn-pill"
            style={{ color: pill.color }}
          >
            <span className="dk-conn__text">{text}</span>
          </span>
        )}
      </ToolbarGroup>
    </Toolbar>
  )
}
