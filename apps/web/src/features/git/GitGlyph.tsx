import type { ReactNode } from 'react'

export type GitGlyphKind = 'fetch' | 'pull' | 'push' | 'commit'
export type GitGlyphState = 'idle' | 'busy' | 'done'

/** The parts that move while busy: pull's arrow drops into the tray, push's rises, fetch turns, a commit's node beats. */
const PARTS: Record<GitGlyphKind, ReactNode> = {
  fetch: <path className="gg-glyph__spin" d="M15 9a6 6 0 1 1-1.8-4.3 M13.5 2.4v2.5H11" />,
  pull: (
    <>
      <path className="gg-glyph__arrow" d="M9 2.5v8 M5.5 7.3L9 10.8l3.5-3.5" />
      <path d="M3.5 12.5v2h11v-2" />
    </>
  ),
  push: (
    <>
      <path className="gg-glyph__arrow gg-glyph__arrow--up" d="M9 11V3 M5.5 6.5L9 3l3.5 3.5" />
      <path d="M3.5 12.5v2h11v-2" />
    </>
  ),
  commit: (
    <>
      <path className="gg-glyph__line" d="M1.5 9h4 M12.5 9h4" />
      <circle className="gg-glyph__node" cx="9" cy="9" r="3" />
    </>
  ),
}

/** A git action's icon that acts out its own busy state and pops a check when done (Button `liveIcon`). */
export function GitGlyph({
  kind,
  state = 'idle',
  size = 14,
}: {
  kind: GitGlyphKind
  state?: GitGlyphState
  size?: number
}) {
  return (
    <span className="gg-glyph" data-state={state} style={{ width: size, height: size }}>
      <svg viewBox="0 0 18 18" width={size} height={size} aria-hidden="true">
        {state === 'done' ? (
          <path key="done" className="gg-glyph__check" d="M4 9.5l3.2 3.2L14 5.5" />
        ) : (
          PARTS[kind]
        )}
      </svg>
    </span>
  )
}
