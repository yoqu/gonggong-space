import { LINK_PREFIX } from './geometry'

/**
 * A page's iframe, and while a newer version of it loads, the newer one behind it: it takes the old one's place once
 * loaded, so a saved change shows without a blank reload. Only the newest is the page's bridge frame (`frames`).
 */
export function PageFrames({
  file,
  title,
  src,
  shown,
  latest,
  className,
  frames,
  onLoaded,
}: {
  file: string
  title: string
  src: string | undefined
  /** The load (`reloads`) on show; undefined before the first one loaded. */
  shown: number | undefined
  latest: number
  className: string
  frames: Map<string, HTMLIFrameElement>
  onLoaded: (k: number) => void
}) {
  return [...new Set([shown ?? latest, latest])].map((k) => (
    <iframe
      key={k}
      ref={
        k === latest
          ? (el) => {
              if (el) frames.set(file, el)
              else frames.delete(file)
            }
          : undefined
      }
      className={`${className}${k === latest && (shown ?? k) !== k ? ' art-node__frame--next' : ''}`}
      title={k === latest ? title : undefined}
      src={src}
      tabIndex={-1}
      onLoad={k === latest ? () => onLoaded(k) : undefined}
    />
  ))
}

/** What a right click hit: the node to select (a title counts as its node) and which menu it gets. */
export function contextTarget(target: Element) {
  // A screen's title gets the screen's menu, as the screen itself does.
  const titled = target.closest<HTMLElement>('[data-screen-title]')?.dataset.screenTitle
  const refTitled = target.closest<HTMLElement>('[data-ref-title]')?.dataset.refTitle
  // The design system, DESIGN.md and the prototype have menus of their own.
  const other = target.closest<HTMLElement>('[data-node-kind]')
  const kind = other?.dataset.nodeKind as 'system' | 'doc' | 'prototype' | undefined
  return {
    hit: titled ?? refTitled ?? other?.dataset.nodeId,
    menu: kind
      ? kind
      : refTitled?.startsWith(LINK_PREFIX) || target.closest('.art-node--link')
        ? ('link' as const)
        : refTitled || target.closest('.art-node--ref')
          ? ('ref' as const)
          : titled || target.closest('.art-node--screen')
            ? ('screen' as const)
            : null,
  }
}
