import { type IconName, PathControl, toast } from '@web/ui'
import type { ReactNode } from 'react'
import { ipc } from '../ipc'
import { tildify } from './labels'

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

/** A local path as a path control (home shown as ~); each level reveals itself in the file manager. */
export function PathValue({ path, leaf = 'folder' }: { path: string; leaf?: IconName }) {
  const shown = tildify(path)
  const home = shown === path ? '' : path.slice(0, path.length - shown.length + 1)
  const parts = shown.split('/')
  const items = parts.flatMap((label, i) => {
    if (!label) return []
    const id = parts.slice(0, i + 1).join('/')
    return [{ id: home ? id.replace(/^~/, home) : id, label }]
  })
  return (
    <PathControl
      aria-label={shown}
      items={items.map((it, i) => ({ ...it, icon: i === items.length - 1 ? leaf : 'folder' }))}
      onSelect={(id) => ipc.reveal(id).catch((e) => toast({ type: 'error', message: String(e) }))}
    />
  )
}
