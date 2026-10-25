import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkbench } from '../src/app/workbench'
import { useWorkspace } from '../src/app/workspace'
import { GitFileDiff } from '../src/features/diff/GitFileDiff'
import { useDiffSettings } from '../src/features/diff/store'
import { gitUrls } from '../src/features/git/api'
import { stashDiff } from '../src/features/git/StashView'
import { GitTab } from '../src/features/workbench/tabs/GitTab'
import { useToasts } from '../src/ui'
import { actionsCalled, BASE, done, op, resetStores, routes, setMe, state, toasts } from './gitFixtures'
import { mockApi } from './mockApi'

const URL = `${BASE}/diff?from=HEAD&path=a.txt`
const WHOLE = `${URL}&context=100000`
const reply = (...lines: string[]) => ({
  patch: ['diff --git a/a.txt b/a.txt', ...lines, ''].join('\n'),
  truncated: false,
})
const TWO = reply('@@ -1,8 +1,8 @@', '-a', '+A', ' b', ' c', ' d', ' e', ' f', '-g', '+G', ' h')
const FIRST = ['diff --git a/a.txt b/a.txt', '--- a/a.txt', '+++ b/a.txt', '@@ -1,4 +1,4 @@']
const LAST = ['diff --git a/a.txt b/a.txt', '--- a/a.txt', '+++ b/a.txt']
const TARGET = { groupId: 'g1', botId: 'b1', repo: null }
const reverts = () => screen.queryAllByRole('button', { name: '回滚此处改动' })

beforeEach(() => {
  resetStores()
  useDiffSettings.setState({ view: 'unified', whitespace: 'none', highlight: 'words', fullContext: false })
})
afterEach(() => vi.unstubAllGlobals())

describe('rolling back one change of the work tree (IDEA’s revert arrow)', () => {
  it('reverts just that change with a patch of it, then offers to undo it', async () => {
    const calls = mockApi({ [`GET ${WHOLE}`]: TWO, [`POST ${BASE}/actions`]: done })
    render(<GitFileDiff url={URL} path="a.txt" revert={TARGET} />)
    await waitFor(() => expect(reverts()).toHaveLength(2))
    // Each sits on the first line of its change.
    expect(reverts()[1]?.closest('.diff__line')?.textContent).toBe('-g')

    fireEvent.click(reverts()[1] as HTMLElement)
    const patch = [...LAST, '@@ -4,5 +4,5 @@', ' d', ' e', ' f', '-g', '+G', ' h', ''].join('\n')
    await waitFor(() =>
      expect(actionsCalled(calls)).toEqual([{ action: 'discard', paths: ['a.txt'], patch }]),
    )
    expect(toasts()).toEqual(['已回滚 1 处改动'])
    const [shown] = useToasts.getState().items
    const [undoAction] = [shown?.action ?? []].flat()
    expect(undoAction?.label).toBe('撤销')

    undoAction?.onClick()
    const undo = [...LAST, '@@ -4,5 +4,5 @@', ' d', ' e', ' f', '+g', '-G', ' h', ''].join('\n')
    await waitFor(() =>
      expect(actionsCalled(calls)[1]).toEqual({ action: 'discard', paths: ['a.txt'], patch: undo }),
    )
    await waitFor(() => expect(toasts()).toContain('已撤销回滚'))
  })

  it('reverts in a sub-repo, and is a request from anyone but the owner', async () => {
    setMe('u2')
    const calls = mockApi({
      [`GET ${WHOLE}`]: TWO,
      [`POST ${BASE}/actions`]: op({ action: 'discard' }),
    })
    render(<GitFileDiff url={URL} path="a.txt" revert={{ ...TARGET, repo: 'lib' }} />)
    await waitFor(() => expect(reverts()).toHaveLength(2))
    fireEvent.click(reverts()[0] as HTMLElement)
    const patch = [...FIRST, '-a', '+A', ' b', ' c', ' d', ''].join('\n')
    await waitFor(() =>
      expect(actionsCalled(calls)).toEqual([{ action: 'discard', paths: ['a.txt'], patch, repo: 'lib' }]),
    )
    await waitFor(() => expect(toasts()).toEqual(['已提交申请，等待 Bot 主人 小王 审批']))
  })

  it('is offered side by side too, on the change’s first line', async () => {
    useDiffSettings.setState({ view: 'split' })
    mockApi({ [`GET ${WHOLE}`]: reply('@@ -1,2 +1,3 @@', ' a', '+b', ' c') })
    render(<GitFileDiff url={URL} path="a.txt" revert={TARGET} />)
    await waitFor(() => expect(reverts()).toHaveLength(1))
    expect(reverts()[0]?.closest('[data-side]')?.getAttribute('data-side')).toBe('new')
  })

  it.each([
    ['a diff not of the work tree', null, TWO],
    [
      'a new file',
      TARGET,
      reply('new file mode 100644', '--- /dev/null', '+++ b/a.txt', '@@ -0,0 +1 @@', '+a'),
    ],
    ['a binary file', TARGET, reply('index 1..2 100644', 'Binary files a/a.txt and b/a.txt differ')],
  ])('is not offered for %s', async (_, target, body) => {
    mockApi({ [`GET ${WHOLE}`]: body })
    render(<GitFileDiff url={URL} path="a.txt" revert={target ?? undefined} />)
    await waitFor(() => expect(document.querySelector('.diff, .ui-empty')).toBeTruthy())
    expect(reverts()).toEqual([])
  })

  it('is not offered while whitespace is left out: git could not apply that patch back', async () => {
    useDiffSettings.setState({ whitespace: 'ignore' })
    mockApi({ [`GET ${URL}&whitespace=ignore&context=100000`]: TWO })
    render(<GitFileDiff url={URL} path="a.txt" revert={TARGET} />)
    await waitFor(() => expect(document.querySelectorAll('[data-change]')).toHaveLength(2))
    expect(reverts()).toEqual([])
  })
})

describe('a renamed file’s diff', () => {
  it('names both paths', async () => {
    mockApi({
      [`GET ${BASE}/diff?from=HEAD&path=b.ts&oldPath=old.ts&context=100000`]: {
        patch: [
          'diff --git a/old.ts b/b.ts',
          'similarity index 90%',
          'rename from old.ts',
          'rename to b.ts',
          '--- a/old.ts',
          '+++ b/b.ts',
          '@@ -1 +1 @@',
          '-a',
          '+b',
          '',
        ].join('\n'),
        truncated: false,
      },
    })
    render(<GitFileDiff url={`${BASE}/diff?from=HEAD&path=b.ts&oldPath=old.ts`} path="b.ts" />)
    await waitFor(() => expect(document.querySelector('.diff__name')?.textContent).toBe('old.ts → b.ts'))
  })
})

describe('in the Git tab', () => {
  function Bench() {
    const tab = useWorkbench((s) => s.benches.g1?.tabs.find((t) => t.kind === 'git'))
    return tab?.kind === 'git' ? <GitTab tab={tab} tabKey={`git:${tab.botId}`} active /> : null
  }

  it('rolls back one change of the picked file from the diff beside the list', async () => {
    useWorkspace.setState({ botStates: { g1: { b1: state() } } })
    useWorkbench.getState().show({ kind: 'git', botId: 'b1' })
    const calls = mockApi(
      routes({
        [`GET ${BASE}/diff?from=HEAD&path=src%2Fa.ts&context=100000`]: {
          patch: ['diff --git a/src/a.ts b/src/a.ts', '@@ -1,2 +1,2 @@', '-a', '+A', ' b', ''].join('\n'),
          truncated: false,
        },
        [`POST ${BASE}/actions`]: done,
      }),
    )
    render(<Bench />)
    fireEvent.click(await screen.findByRole('button', { name: '回滚此处改动' }))
    const patch = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,2 +1,2 @@',
      '-a',
      '+A',
      ' b',
      '',
    ].join('\n')
    await waitFor(() =>
      expect(actionsCalled(calls)).toEqual([{ action: 'discard', paths: ['src/a.ts'], patch }]),
    )
  })
})

describe('diff urls of a rename', () => {
  it('carry the old path', () => {
    expect(gitUrls.diff(BASE, 'HEAD', null, 'b.ts', 'lib', 'a.ts')).toBe(
      `${BASE}/diff?from=HEAD&path=b.ts&oldPath=a.ts&repo=lib`,
    )
    const stash = { index: 0, hash: 's0', message: 'm', branch: null, at: '', untracked: false }
    expect(stashDiff(TARGET, stash, { path: 'b.ts', change: 'renamed', oldPath: 'a.ts' })).toBe(
      `${BASE}/diff?from=s0%5E1&to=s0&path=b.ts&oldPath=a.ts`,
    )
  })
})
