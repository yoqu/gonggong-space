import type { BotDto, DiffRepo } from '@gonggong/protocol'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tabKey, useWorkbench, type WorkbenchTab } from '../src/app/workbench'
import { useWorkspace } from '../src/app/workspace'
import { DiffPane } from '../src/features/diff/DiffPane'
import { type DiffFile, groupByRepo, parsePatch } from '../src/features/diff/patch'
import { useDiffLayout } from '../src/features/diff/store'
import type { WorkspaceDiff } from '../src/features/diff/useWorkspaceDiff'
import { TabContent } from '../src/features/workbench/TabContent'

const file = (path: string, add = 1, del = 0): DiffFile => ({
  path,
  status: 'modified',
  add,
  del,
  binary: false,
  lines: [],
})

const repo = (path: string, o: Partial<DiffRepo> = {}): DiffRepo => ({
  path,
  kind: path ? 'submodule' : 'root',
  branch: 'main',
  base: null,
  truncated: false,
  ...o,
})

describe('groupByRepo', () => {
  it('puts each file in the repo with the longest matching path, keeping the repo order', () => {
    const files = ['README.md', 'lib/x.ts', 'lib/sub/y.ts', 'libs/z.ts'].map((p) => file(p))
    const repos = [repo(''), repo('lib'), repo('lib/sub', { kind: 'nested' }), repo('vendor')]
    const groups = groupByRepo(files, repos)
    expect(groups.map((g) => [g.repo.path, g.files.map((f) => f.path)])).toEqual([
      ['', ['README.md', 'libs/z.ts']],
      ['lib', ['lib/x.ts']],
      ['lib/sub', ['lib/sub/y.ts']],
      ['vendor', []],
    ])
  })

  it('sums the +/− counts per repo', () => {
    const [root, lib] = groupByRepo(
      [file('a', 2, 1), file('lib/b', 3, 4), file('c', 1, 1)],
      [repo(''), repo('lib')],
    )
    expect([root?.add, root?.del, lib?.add, lib?.del]).toEqual([3, 2, 3, 4])
  })
})

const PATCH = [
  'diff --git a/README.md b/README.md',
  '@@ -1 +1 @@',
  '-old',
  '+root change',
  'diff --git a/lib/src/x.ts b/lib/src/x.ts',
  '@@ -0,0 +1,2 @@',
  '+lib change',
  '+more',
  'diff --git a/lib/src/y.ts b/lib/src/y.ts',
  '@@ -1 +0,0 @@',
  '-gone',
  '',
].join('\n')

const diffOf = (repos: DiffRepo[], patch = PATCH): WorkspaceDiff => ({
  patch,
  files: parsePatch(patch),
  repos,
  base: 'main',
  branch: 'feat/x',
  error: null,
  loading: false,
})

function Pane({
  diff,
  file = null,
  repo: target,
}: {
  diff: WorkspaceDiff
  file?: string | null
  repo?: string
}) {
  return (
    <DiffPane
      diff={diff}
      scope="base"
      turn={false}
      file={file}
      repo={target}
      onScope={() => {}}
      onFile={() => {}}
      onLocate={() => {}}
    />
  )
}

const header = (name: RegExp) => screen.getByRole('button', { name })

describe('DiffPane grouped by repo', () => {
  beforeEach(() => {
    localStorage.clear()
    useDiffLayout.setState({ layout: 'list' })
  })

  it('keeps the flat list when the workspace is a single root repo', () => {
    render(<Pane diff={diffOf([repo('', { base: 'main', branch: 'feat/x' })])} />)
    expect(screen.queryByRole('button', { name: /根仓库/ })).toBeNull()
    expect(screen.getByText('feat/x → main')).toBeTruthy()
    expect(screen.getByRole('button', { name: /x\.ts\s*lib\/src/ })).toBeTruthy()
  })

  it('shows a collapsible header per repo with branch, counts and repo-relative paths', () => {
    const repos = [
      repo('', { branch: 'feat/x', base: 'main' }),
      repo('lib', { branch: 'dev' }),
      repo('vendor/big', { kind: 'nested', truncated: true }),
      repo('docs'),
    ]
    render(<Pane diff={diffOf(repos)} />)
    expect(screen.getByText('4 个仓库')).toBeTruthy()
    const root = header(/^根仓库/)
    expect(root.textContent).toBe('根仓库feat/x → main1 个文件+1−1')
    const lib = header(/^lib/)
    expect(lib.textContent).toBe('libdev2 个文件+2−1')
    expect(lib.getAttribute('aria-expanded')).toBe('true')
    expect(header(/^vendor\/big/).textContent).toBe('vendor/bigmain0 个文件+0−0已截断')
    // A repo without changes has no group.
    expect(screen.queryByRole('button', { name: /^docs/ })).toBeNull()

    // In-group paths drop the repo prefix.
    const x = screen.getByRole('button', { name: /^x\.ts/ })
    expect(within(x).getByText('src')).toBeTruthy()
    fireEvent.click(lib)
    expect(lib.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: /^x\.ts/ })).toBeNull()
    expect(screen.getByRole('button', { name: /README\.md/ })).toBeTruthy()
  })

  it('roots the tree of each group at its repo', () => {
    useDiffLayout.setState({ layout: 'tree' })
    render(<Pane diff={diffOf([repo(''), repo('lib')])} />)
    expect(screen.getByRole('button', { name: /^src$/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^lib/ })?.getAttribute('aria-expanded')).toBe('true')
    expect(screen.queryByRole('button', { name: /^lib\/src$/ })).toBeNull()
  })

  it('shows the first file of the targeted repo', () => {
    render(<Pane diff={diffOf([repo(''), repo('lib')])} repo="lib" />)
    expect(screen.getByText('+lib change')).toBeTruthy()
  })
})

describe('diff tab targeting a repo', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              scope: 'uncommitted',
              patch: PATCH,
              base: null,
              branch: 'main',
              repos: [repo(''), repo('lib')],
            }),
          ),
      ),
    )
    useWorkspace.setState({ bots: [{ id: 'b1', name: '小王的 Claude' } as BotDto] })
    useWorkbench.setState({ groupId: 'g1', open: true, benches: {} })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('opens on the repo first file', async () => {
    const tab: WorkbenchTab = { kind: 'diff', botId: 'b1', scope: 'uncommitted', file: null, repo: 'lib' }
    act(() => {
      useWorkbench.getState().show(tab)
    })
    render(<TabContent tab={tab} active />)
    expect(await screen.findByText('+lib change')).toBeTruthy()
    expect(tabKey(tab)).toBe('diff:b1')
  })
})
