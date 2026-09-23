import { cx } from '@web/lib/cx'
import { useState } from 'react'
import { PAGES, type PageKey } from '../pages'
import { useDaemon } from '../store'
import { StatusLine } from './StatusLine'

const OS = { macos: 'macOS', windows: 'Windows', linux: 'Linux' } as Record<string, string>

/** Bound layout: left nav, the current page with its header, bottom status line. */
export function Shell() {
  const [page, setPage] = useState<PageKey>('overview')
  const info = useDaemon((s) => s.info)
  const current = PAGES.find((p) => p.key === page) ?? (PAGES[0] as (typeof PAGES)[number])
  return (
    <>
      <div className="dk-body">
        <nav className="dk-nav">
          {PAGES.map((p) => (
            <button
              key={p.key}
              type="button"
              className={cx('dk-nav__item', p.key === page && 'dk-nav__item--active')}
              aria-current={p.key === page ? 'page' : undefined}
              onClick={() => setPage(p.key)}
            >
              <p.icon size={14} />
              <span>{p.label}</span>
            </button>
          ))}
          <span className="dk-flex" />
          {info ? (
            <div className="dk-nav__me">
              <span className="dk-strong">{info.ownerName ?? '未绑定'}</span>
              <span className="dk-mono dk-sub">
                {info.machine.name} · {OS[info.machine.os] ?? info.machine.os}
              </span>
            </div>
          ) : null}
        </nav>
        <main className="dk-main">
          <header className="dk-main__header">
            <h1>{current.label}</h1>
            <p>{current.desc}</p>
          </header>
          <current.Component go={setPage} />
        </main>
      </div>
      <StatusLine />
    </>
  )
}
