import { Avatar, Sidebar, useScrollEdge } from '@web/ui'
import { useState } from 'react'
import { t } from '../i18n'
import { PAGES, type PageKey, SECTIONS } from '../pages'
import { useDaemon, useHeading } from '../store'
import { StatusLine } from './StatusLine'
import { TitleBar } from './TitleBar'

const OS = { macos: 'macOS', windows: 'Windows', linux: 'Linux' } as Record<string, string>

/** Bound layout (Pane window): flush sidebar under the native traffic lights, unified toolbar, content, status line. */
export function Shell() {
  const [page, setPage] = useState<PageKey>('overview')
  const info = useDaemon((s) => s.info)
  const current = PAGES.find((p) => p.key === page) ?? (PAGES[0] as (typeof PAGES)[number])
  const heading = useHeading((s) => s.heading)
  const [sentinel, scrolled] = useScrollEdge()
  return (
    <div className="dk-body">
      <aside className="dk-sidebar">
        <div className="dk-sidebar__lights" data-tauri-drag-region="deep" />
        <Sidebar
          aria-label={t('导航')}
          iconStyle="tile"
          selected={page}
          onSelect={(id) => setPage(id as PageKey)}
          sections={SECTIONS.map((s) => ({
            title: s.title,
            items: s.pages.map((p) => ({ id: p.key, label: p.label, icon: p.icon, color: p.color })),
          }))}
        />
        {info ? (
          <div className="dk-me">
            <Avatar name={info.ownerName ?? t('未绑定')} size={28} />
            <div className="dk-me__text">
              <span className="dk-strong dk-ellipsis">{info.ownerName ?? t('未绑定')}</span>
              <span className="dk-sub dk-ellipsis">
                {info.machine.name} · {OS[info.machine.os] ?? info.machine.os}
              </span>
            </div>
          </div>
        ) : null}
      </aside>
      <div className="dk-main">
        <div className="dk-scroll">
          <TitleBar
            title={heading?.title ?? current.label}
            subtitle={heading ? heading.subtitle : current.desc}
            scrolled={scrolled}
          />
          <main className="dk-content">
            <div ref={sentinel} className="dk-sentinel" aria-hidden="true" />
            <current.Component go={setPage} />
          </main>
        </div>
        <StatusLine />
      </div>
    </div>
  )
}
