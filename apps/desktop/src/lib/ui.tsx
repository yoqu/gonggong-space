import type { ReactNode } from 'react'

/** Status as a colored dot plus text, so it never relies on color alone. */
export function StatusText({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className="dk-status" style={{ color }}>
      <span className="dk-status__dot" />
      <span className="dk-status__text">{children}</span>
    </span>
  )
}

/** A titled block of page content; the title reads like a macOS settings group heading. */
export function Section({
  title,
  aside,
  children,
}: {
  title: ReactNode
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="dk-section">
      <div className="dk-section__head">
        <h2 className="dk-section__title">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

/** Caption over a value, laid out in a row of four inside a group. */
export function Meta({ k, mono, children }: { k: string; mono?: boolean; children: ReactNode }) {
  return (
    <div className="dk-meta">
      <span className="dk-meta__k">{k}</span>
      <span className={mono ? 'dk-meta__v dk-mono' : 'dk-meta__v'}>{children}</span>
    </div>
  )
}
