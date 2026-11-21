import type { ArtifactVersionDto } from '@gonggong/protocol'
import { act, within } from '@testing-library/react'
import type { Call } from './mockApi'

/** Shared fixtures of the artifact tests. The preview origin the screens' bridge posts from. */
export const ORIGIN = 'https://a1.preview.test'

/** Version `n` of artifact a1 made by a run at `at`. */
export const versionAt =
  (at: string) =>
  (n: number, o: Partial<ArtifactVersionDto> = {}): ArtifactVersionDto => ({
    id: `v${n}`,
    artifactId: 'a1',
    n,
    parentVersionId: n > 1 ? `v${n - 1}` : null,
    source: 'run',
    runId: 'r1',
    userId: null,
    files: [],
    digest: 'a'.repeat(64),
    thumbnailUrl: null,
    stale: false,
    issues: [],
    createdAt: at,
    authorName: '设计助手',
    ...o,
  })

/** The bodies of the `method` `path` requests. */
export const bodies = (calls: Call[], method: string, path: string) =>
  calls.filter((c) => c.method === method && c.path === path).map((c) => c.body)

/** The menu's (checkbox) item named `name`. */
export const item = (menu: HTMLElement, name: RegExp) => {
  const m = within(menu)
  const [hit] = [...m.queryAllByRole('menuitem', { name }), ...m.queryAllByRole('menuitemcheckbox', { name })]
  if (!hit) throw new Error(`no menu item ${name}`)
  return hit
}

/** A bridge message from the screen `file` shown in `iframe`. */
export const fromFrame = (iframe: HTMLIFrameElement, file: string, data: Record<string, unknown>) => {
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { source: 'gg-bridge', file, ...data },
        origin: ORIGIN,
        source: iframe.contentWindow,
      }),
    )
  })
}
