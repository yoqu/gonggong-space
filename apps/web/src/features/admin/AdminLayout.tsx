import { useEffect, useRef } from 'react'
import { Link, Navigate, NavLink, Outlet, useLocation } from 'react-router'
import { useSession } from '../../app/session'
import { t } from '../../i18n'
import { Icon, Logo, TableCardsOnNarrow, Toaster } from '../../ui'
import '../../ui/sidebar.css'
import { ADMIN_NAV } from './nav'
import './admin.css'

/** 管理后台 shell: a flush Pane sidebar with settings-style tile icons (a scrolling tab row under 768px) beside the page. Members manage their own bots and machines in the chat UI. */
export function AdminLayout() {
  const user = useSession((s) => s.user)
  const { pathname } = useLocation()
  const navRef = useRef<HTMLElement>(null)
  // On phones the sidebar is a horizontal scroll strip: center the active route pill into view after layout.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll active nav item on route changes
  useEffect(() => {
    const scrollActive = () => {
      const nav = navRef.current
      const active = nav?.querySelector<HTMLElement>('[aria-current="page"]')
      if (!nav || !active) return
      if (nav.scrollWidth > nav.clientWidth && typeof nav.scrollTo === 'function') {
        const left = Math.max(0, active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2)
        nav.scrollTo({ left, behavior: 'instant' })
      } else {
        active.scrollIntoView?.({ block: 'nearest', inline: 'center' })
      }
    }
    scrollActive()
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(scrollActive) : 0
    return () => {
      if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf)
    }
  }, [pathname])
  if (user?.role !== 'sysadmin') return <Navigate to="/" replace />
  return (
    <div className="admin">
      <nav ref={navRef} className="ui-sidebar admin__nav" aria-label={t('管理后台')}>
        <div className="admin__brand">
          <Logo size={20} />
          <span className="admin__product">{t('共工空间')}</span>
          <span className="admin__crumb">{t('管理后台')}</span>
        </div>
        {ADMIN_NAV.map((g) => (
          <div key={g.head} className="ui-sidebar__section">
            <div className="ui-sidebar__title">{g.head}</div>
            {g.items.map((i) => (
              <NavLink key={i.path} to={`/admin/${i.path}`} className="ui-sidebar__item">
                <span className="ui-sidebar__icon ui-sidebar__icon--tile" style={{ background: i.color }}>
                  <Icon name={i.icon} />
                </span>
                <span className="ui-sidebar__label">{i.label}</span>
              </NavLink>
            ))}
          </div>
        ))}
        <div className="ui-sidebar__section admin__back">
          <Link to="/" className="ui-sidebar__item">
            <span
              className="ui-sidebar__icon ui-sidebar__icon--tile"
              style={{ background: 'var(--accent-fill)' }}
            >
              <Icon name="bubble" />
            </span>
            <span className="ui-sidebar__label">{t('返回消息')}</span>
          </Link>
        </div>
      </nav>
      <main className="admin__main">
        <TableCardsOnNarrow value>
          <Outlet />
        </TableCardsOnNarrow>
      </main>
      <Toaster />
    </div>
  )
}

export function AdminIndex() {
  return <Navigate to={`/admin/${ADMIN_NAV[0]?.items[0]?.path}`} replace />
}
