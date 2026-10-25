import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkspace } from '../src/app/workspace'
import { BotFileViewer } from '../src/features/files/FileViewer'
import { actionsCalled, BASE, benchTabs, done, resetStores, state, status, toasts } from './gitFixtures'
import { mockApi } from './mockApi'

beforeEach(resetStores)
afterEach(() => vi.unstubAllGlobals())

const TEXT = (path: string, text = 'one\nTWO\nthree\nfour\nnew\n') => ({
  path,
  size: text.length,
  binary: false,
  mime: 'text/plain',
  text,
})
/** The work tree against HEAD: line 2 changed, a line taken out before line 4, line 5 added. */
const DIFF = (path: string) => ({
  patch: [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    '@@ -1,5 +1,5 @@',
    ' one',
    '-two',
    '+TWO',
    ' three',
    '-gone',
    ' four',
    '+new',
    '',
  ].join('\n'),
  truncated: false,
})
const marks = () => screen.queryAllByRole('button', { name: /^(新增|修改|删除)：/ })
/** The number of the line a marker sits on. */
const lineOf = (el: Element) => el.closest('.pv-line')?.querySelector('.pv-line__n')?.textContent
const inRepo = (git = status()) => useWorkspace.setState({ botStates: { g1: { b1: state({ git }) } } })

describe('change markers in the file viewer (IDEA’s gutter)', () => {
  it('marks the work tree’s changes against HEAD beside the line numbers', async () => {
    inRepo()
    mockApi({
      'GET /groups/g1/bots/b1/files/text?path=src%2Fa.ts': TEXT('src/a.ts'),
      [`GET ${BASE}/diff?from=HEAD&path=src%2Fa.ts&context=3`]: DIFF('src/a.ts'),
    })
    render(<BotFileViewer botId="b1" path="src/a.ts" />)
    await waitFor(() => expect(marks()).toHaveLength(3))
    expect(marks().map((m) => [m.getAttribute('aria-label'), lineOf(m)])).toEqual([
      ['修改：第 2 行', '2'],
      ['删除：1 行', '4'],
      ['新增：第 5 行', '5'],
    ])
    expect(marks().map((m) => m.closest('[data-kind]')?.getAttribute('data-kind'))).toEqual([
      'modified',
      'deleted',
      'added',
    ])
  })

  it('shows what a change replaced, and rolls it back or opens the diff', async () => {
    inRepo()
    const calls = mockApi({
      'GET /groups/g1/bots/b1/files/text?path=src%2Fa.ts': TEXT('src/a.ts'),
      [`GET ${BASE}/diff?from=HEAD&path=src%2Fa.ts&context=3`]: DIFF('src/a.ts'),
      [`POST ${BASE}/actions`]: done,
    })
    render(<BotFileViewer botId="b1" path="src/a.ts" />)
    fireEvent.click(await screen.findByRole('button', { name: '修改：第 2 行' }))
    const pop = within(await screen.findByRole('dialog', { name: '修改：第 2 行' }))
    expect(pop.getByText('two')).toBeTruthy()
    fireEvent.click(pop.getByRole('button', { name: '回滚' }))
    const patch = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,3 +1,3 @@',
      ' one',
      '-two',
      '+TWO',
      ' three',
      '',
    ].join('\n')
    await waitFor(() =>
      expect(actionsCalled(calls)).toEqual([{ action: 'discard', paths: ['src/a.ts'], patch }]),
    )
    expect(toasts()).toEqual(['已回滚 1 处改动'])

    fireEvent.click(screen.getByRole('button', { name: '新增：第 5 行' }))
    const added = within(await screen.findByRole('dialog', { name: '新增：第 5 行' }))
    fireEvent.click(added.getByRole('button', { name: '显示差异' }))
    expect(benchTabs().at(-1)).toMatchObject({
      kind: 'diff',
      botId: 'b1',
      scope: 'uncommitted',
      file: 'src/a.ts',
      repo: null,
    })
  })

  it('reads a sub-repo file’s changes from its own repo', async () => {
    inRepo(
      status({
        repos: [{ path: 'libs/core', kind: 'submodule', branch: 'dev', ahead: 0, behind: 0, dirty: true }],
      }),
    )
    const calls = mockApi({
      'GET /groups/g1/bots/b1/files/text?path=libs%2Fcore%2Fx.ts': TEXT('libs/core/x.ts'),
      [`GET ${BASE}/diff?from=HEAD&path=x.ts&repo=libs%2Fcore&context=3`]: DIFF('x.ts'),
      [`POST ${BASE}/actions`]: done,
    })
    render(<BotFileViewer botId="b1" path="libs/core/x.ts" />)
    fireEvent.click(await screen.findByRole('button', { name: '新增：第 5 行' }))
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: '新增：第 5 行' })).getByRole('button', {
        name: '回滚',
      }),
    )
    await waitFor(() => expect(actionsCalled(calls)).toHaveLength(1))
    expect(actionsCalled(calls)[0]).toMatchObject({ action: 'discard', paths: ['x.ts'], repo: 'libs/core' })
    expect((actionsCalled(calls)[0] as { patch: string }).patch).toContain('\n+new\n')

    fireEvent.click(screen.getByRole('button', { name: '新增：第 5 行' }))
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: '新增：第 5 行' })).getByRole('button', {
        name: '显示差异',
      }),
    )
    expect(benchTabs().at(-1)).toMatchObject({ kind: 'diff', file: 'libs/core/x.ts', repo: 'libs/core' })
  })

  it('marks nothing on a version or on a file new to git', async () => {
    inRepo()
    const calls = mockApi({
      'GET /groups/g1/bots/b1/git/text?ref=main&path=src%2Fa.ts': TEXT('src/a.ts'),
      'GET /groups/g1/bots/b1/files/text?path=src%2Fnew.ts': TEXT('src/new.ts'),
      [`GET ${BASE}/diff?from=HEAD&path=src%2Fnew.ts&context=3`]: {
        patch: [
          'diff --git a/src/new.ts b/src/new.ts',
          'new file mode 100644',
          '--- /dev/null',
          '+++ b/src/new.ts',
          '@@ -0,0 +1,5 @@',
          '+one',
          '+TWO',
          '+three',
          '+four',
          '+new',
          '',
        ].join('\n'),
        truncated: false,
      },
    })
    const { unmount } = render(<BotFileViewer botId="b1" path="src/a.ts" rev="main" />)
    expect(await screen.findByText('TWO')).toBeTruthy()
    expect(calls.some((c) => c.path.includes('/diff?'))).toBe(false)
    unmount()

    render(<BotFileViewer botId="b1" path="src/new.ts" />)
    expect(await screen.findByText('TWO')).toBeTruthy()
    await waitFor(() => expect(calls.some((c) => c.path.includes('src%2Fnew.ts&context=3'))).toBe(true))
    await act(() => Promise.resolve())
    expect(marks()).toEqual([])
  })

  it('reads the file and its changes again as the work tree changes', async () => {
    inRepo()
    let text = 'one\nTWO\nthree\nfour\nnew\n'
    let diff: unknown = DIFF('src/a.ts')
    mockApi({
      'GET /groups/g1/bots/b1/files/text?path=src%2Fa.ts': () => TEXT('src/a.ts', text),
      [`GET ${BASE}/diff?from=HEAD&path=src%2Fa.ts&context=3`]: () => diff,
    })
    render(<BotFileViewer botId="b1" path="src/a.ts" />)
    await waitFor(() => expect(marks()).toHaveLength(3))

    text = 'one\ntwo\nthree\ngone\nfour\n'
    diff = { patch: '', truncated: false }
    act(() => inRepo(status({ checkedAt: '2026-10-25T00:00:00.000Z' })))
    await waitFor(() => expect(marks()).toEqual([]))
    expect(await screen.findByText('gone')).toBeTruthy()
    expect(screen.queryByText('TWO')).toBeNull()
  })
})
