import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkbench } from '../src/app/workbench'
import { useWorkspace } from '../src/app/workspace'
import { BotFileViewer } from '../src/features/files/FileViewer'
import { BASE, benchTabs, resetStores, state, status } from './gitFixtures'
import { mockApi } from './mockApi'

beforeEach(resetStores)
afterEach(() => vi.unstubAllGlobals())

const TEXT = {
  path: 'src/a.ts',
  size: 30,
  binary: false,
  mime: 'text/plain',
  text: 'one\ntwo\nthree\nfour\n',
}
const BLAME = {
  ranges: [
    { start: 1, count: 2, commit: 'a'.repeat(40) },
    { start: 3, count: 1, commit: '' },
    { start: 4, count: 1, commit: 'a'.repeat(40) },
  ],
  commits: [
    {
      hash: 'a'.repeat(40),
      shortHash: 'aaaaaaa',
      author: '张三',
      email: 'z@corp',
      at: new Date().toISOString(),
      subject: '首次提交',
    },
  ],
}

describe('annotate (git blame) and history in the file viewer', () => {
  it('shows who last changed each run of lines; a commit opens the log at it, history the file’s log', async () => {
    useWorkspace.setState({ botStates: { g1: { b1: state() } } })
    const calls = mockApi({
      'GET /groups/g1/bots/b1/files/text?path=src%2Fa.ts': TEXT,
      [`GET ${BASE}/blame?path=src%2Fa.ts`]: BLAME,
    })
    render(<BotFileViewer botId="b1" path="src/a.ts" />)
    fireEvent.click(await screen.findByRole('button', { name: '注解（Git Blame）' }))
    await waitFor(() => expect(document.querySelectorAll('.pv-line__blame')).toHaveLength(4))
    const cells = [...document.querySelectorAll('.pv-line__blame')].map((c) => c.textContent)
    expect(cells).toEqual(['aaaaaaa 张三 刚刚', '', '未提交', 'aaaaaaa 张三 刚刚'])
    expect(calls.some((c) => c.path === `${BASE}/blame?path=src%2Fa.ts`)).toBe(true)
    fireEvent.click(screen.getAllByRole('button', { name: 'aaaaaaa 张三 刚刚' })[0] as HTMLElement)
    expect(benchTabs().at(-1)).toMatchObject({
      kind: 'git-log',
      botId: 'b1',
      path: 'src/a.ts',
      commit: 'a'.repeat(40),
    })
    fireEvent.click(screen.getByRole('button', { name: '显示历史' }))
    // The file's history is the tab the commit opened in, brought forward as it is.
    expect(benchTabs()).toEqual([
      expect.objectContaining({ kind: 'git-log', path: 'src/a.ts', commit: 'a'.repeat(40) }),
    ])
    fireEvent.click(screen.getByRole('button', { name: '注解（Git Blame）' }))
    expect(document.querySelectorAll('.pv-line__blame')).toHaveLength(0)
  })

  it('annotates a sub-repo file against its own repo, and a version at its revision', async () => {
    useWorkspace.setState({
      botStates: {
        g1: {
          b1: state({
            git: status({
              repos: [
                { path: 'libs/core', kind: 'submodule', branch: 'dev', ahead: 0, behind: 0, dirty: false },
              ],
            }),
          }),
        },
      },
    })
    const calls = mockApi({
      'GET /groups/g1/bots/b1/git/text?ref=v1&path=x.ts&repo=libs%2Fcore': {
        ...TEXT,
        path: 'libs/core/x.ts',
      },
      [`GET ${BASE}/blame?path=x.ts&ref=v1&repo=libs%2Fcore`]: BLAME,
    })
    render(<BotFileViewer botId="b1" path="libs/core/x.ts" rev="v1" />)
    fireEvent.click(await screen.findByRole('button', { name: '注解（Git Blame）' }))
    await waitFor(() =>
      expect(calls.some((c) => c.path === `${BASE}/blame?path=x.ts&ref=v1&repo=libs%2Fcore`)).toBe(true),
    )
    fireEvent.click(screen.getByRole('button', { name: '显示历史' }))
    expect(benchTabs().at(-1)).toMatchObject({ kind: 'git-log', repo: 'libs/core', path: 'x.ts', ref: 'v1' })
  })

  it('opens annotated when asked to (IDEA’s Annotate from the commit window), each time it is asked', async () => {
    useWorkspace.setState({ botStates: { g1: { b1: state() } } })
    mockApi({
      'GET /groups/g1/bots/b1/files/text?path=src%2Fa.ts': TEXT,
      [`GET ${BASE}/blame?path=src%2Fa.ts`]: BLAME,
    })
    const { rerender } = render(<BotFileViewer botId="b1" path="src/a.ts" annotate={1} />)
    await waitFor(() => expect(document.querySelectorAll('.pv-line__blame')).toHaveLength(4))
    fireEvent.click(screen.getByRole('button', { name: '注解（Git Blame）' }))
    expect(document.querySelectorAll('.pv-line__blame')).toHaveLength(0)
    rerender(<BotFileViewer botId="b1" path="src/a.ts" annotate={2} />)
    await waitFor(() => expect(document.querySelectorAll('.pv-line__blame')).toHaveLength(4))
  })

  it('has no git buttons outside a repo', async () => {
    useWorkspace.setState({ botStates: { g1: { b1: state({ git: null }) } } })
    useWorkbench.setState({ groupId: 'g1' })
    mockApi({ 'GET /groups/g1/bots/b1/files/text?path=src%2Fa.ts': TEXT })
    render(<BotFileViewer botId="b1" path="src/a.ts" />)
    expect(await screen.findByText('one')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '注解（Git Blame）' })).toBeNull()
    expect(screen.queryByRole('button', { name: '显示历史' })).toBeNull()
  })
})
