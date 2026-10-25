import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tabKey, useWorkbench } from '../src/app/workbench'
import {
  commit,
  dialog,
  diffText,
  fakeDiff,
  hash,
  logTab,
  open,
  REFS,
  seed,
  serve,
  tabs,
  width,
} from './gitLogFixture'

let server: ReturnType<typeof serve>
beforeEach(() => {
  seed()
  server = serve({
    'GET git/refs': () => REFS,
    'GET git/log': (q) => ({
      commits:
        q.get('ref') === 'main..feat/x'
          ? [commit('1', { parents: [hash('2')] }), commit('2', { parents: [hash('4')] })]
          : q.get('ref') === 'feat/x..main'
            ? [commit('4', { parents: [hash('6')] })]
            : [],
      hasMore: false,
    }),
    'GET git/compare': () => ({
      changes: [
        { path: 'src/a.ts', change: 'modified', oldPath: null },
        { path: 'README.md', change: 'added', oldPath: null },
        { path: 'src/b.ts', change: 'renamed', oldPath: 'src/old.ts' },
      ],
    }),
    'GET git/diff': fakeDiff,
    'GET git/show': (q) => {
      const c =
        [commit('1', { parents: [hash('2')] }), commit('2', { parents: [hash('4')] })].find(
          (x) => x.hash === q.get('commit'),
        ) ?? commit('4', { parents: [hash('6')] })
      return {
        commit: c,
        body: c.subject,
        committer: '小王',
        committerEmail: 'w@corp',
        committedAt: c.at,
        branches: [],
      }
    },
  })
})
afterEach(() => vi.unstubAllGlobals())

const api = (path: string) => `/api/groups/g1/bots/b1/git/${path}`
const title = () => screen.getByRole('heading', { level: 2 }).textContent

describe('compare tab', () => {
  it('lists the commits only on either side, the picked one’s details shown in the tab', async () => {
    const tab = open({ kind: 'git-compare', botId: 'b1', from: 'main', to: 'feat/x', file: null })
    expect(title()).toBe('比较 · main ↔ feat/x')
    const onTo = within(await tab.findByRole('region', { name: '仅在 feat/x 中' }))
    expect(await onTo.findByRole('option', { name: /提交 1/ })).toBeTruthy()
    expect(onTo.getByRole('option', { name: /提交 2/ })).toBeTruthy()
    const onFrom = within(tab.getByRole('region', { name: '仅在 main 中' }))
    expect(await onFrom.findByRole('option', { name: /提交 4/ })).toBeTruthy()
    expect(server.calls).toContain(api('log?ref=main..feat%2Fx&skip=0'))
    expect(server.calls).toContain(api('log?ref=feat%2Fx..main&skip=0'))

    fireEvent.click(onTo.getByRole('option', { name: /提交 2/ }))
    expect(tabs()).toHaveLength(1)
    expect(tabs()[0]).toMatchObject({ commit: hash('2') })
    const info = within(await tab.findByRole('region', { name: '提交详情' }))
    expect(info.getByRole('heading', { name: '提交 2' })).toBeTruthy()
    await waitFor(() => expect(diffText(tab)).toContain(`+${hash('2')}:src/a.ts`))
    expect(server.calls).toContain(api(`compare?from=${hash('4')}&to=${hash('2')}`))

    fireEvent.click(onFrom.getByRole('option', { name: /提交 4/ }))
    await waitFor(() =>
      expect(within(tab.getByRole('region', { name: '提交详情' })).getByRole('heading', { name: '提交 4' })),
    )
    expect(logTab()).toBeUndefined()
  })

  it('offers the log’s commit menu on either side', async () => {
    const tab = open({ kind: 'git-compare', botId: 'b1', from: 'main', to: 'feat/x', file: null })
    const onTo = within(await tab.findByRole('region', { name: '仅在 feat/x 中' }))
    fireEvent.contextMenu(await onTo.findByRole('option', { name: /提交 2/ }))
    expect(tabs()[0]).toMatchObject({ commit: hash('2') })
    fireEvent.click(screen.getByRole('menuitem', { name: '新建分支…' }))
    expect(dialog()).toEqual({ kind: 'branch-create', from: hash('2') })
    fireEvent.contextMenu(onTo.getByRole('option', { name: /提交 1/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: '优选' }))
    expect(dialog()).toMatchObject({ kind: 'confirm', confirm: { req: { commits: [hash('1')] } } })
    fireEvent.contextMenu(onTo.getByRole('option', { name: /提交 1/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: '转到父提交' }))
    expect(tabs()[0]).toMatchObject({ commit: hash('2') })
  })

  it('swaps the two sides', async () => {
    const tab = open({ kind: 'git-compare', botId: 'b1', from: 'main', to: 'feat/x', file: null })
    fireEvent.click(tab.getByRole('button', { name: '交换两侧' }))
    expect(tabs()).toHaveLength(1)
    expect(tabs()[0]).toMatchObject({ from: 'feat/x', to: 'main' })
    expect(useWorkbench.getState().benches.g1?.active).toBe('git-compare:b1::feat/x:main')
    expect(title()).toBe('比较 · feat/x ↔ main')
  })

  it('opens each pair of versions in a tab of its own, going back to one already open', () => {
    const s = useWorkbench.getState()
    s.show({ kind: 'git-compare', botId: 'b1', from: 'main', to: 'feat/x', file: null })
    s.show({ kind: 'git-compare', botId: 'b1', from: hash('2'), to: null, file: 'a.ts' })
    s.show({ kind: 'git-compare', botId: 'b1', repo: 'libs/core', from: 'main', to: 'feat/x', file: null })
    s.show({ kind: 'git-compare', botId: 'b1', from: 'main', to: 'feat/x', file: 'b.ts' })
    expect(tabs().map(tabKey)).toEqual([
      'git-compare:b1::main:feat/x',
      `git-compare:b1::${hash('2')}:`,
      'git-compare:b1:libs/core:main:feat/x',
    ])
    expect(useWorkbench.getState().benches.g1?.active).toBe('git-compare:b1::main:feat/x')
  })

  it('shows the files that differ and the picked one’s diff, kept in the tab', async () => {
    const tab = open({ kind: 'git-compare', botId: 'b1', from: 'main', to: 'feat/x', file: null })
    fireEvent.click(tab.getByRole('radio', { name: '文件' }))
    const files = within(await tab.findByRole('region', { name: '变更文件' }))
    expect(server.calls).toContain(api('compare?from=main&to=feat%2Fx'))
    await waitFor(() => expect(diffText(tab)).toContain('+feat/x:src/a.ts'))
    fireEvent.click(files.getByRole('button', { name: '新增：README.md' }))
    expect(tabs()[0]).toMatchObject({ file: 'README.md' })
    await waitFor(() => expect(diffText(tab)).toContain('+feat/x:README.md'))
    expect(server.calls).toContain(api('diff?from=main&to=feat%2Fx&path=README.md&context=100000'))
    fireEvent.click(files.getByRole('button', { name: '重命名：src/b.ts' }))
    await waitFor(() =>
      expect(server.calls).toContain(
        api('diff?from=main&to=feat%2Fx&path=src%2Fb.ts&oldPath=src%2Fold.ts&context=100000'),
      ),
    )
  })

  it('compares with the work tree by files only', async () => {
    const tab = open({ kind: 'git-compare', botId: 'b1', from: hash('2'), to: null, file: 'src/a.ts' })
    expect(title()).toBe('比较 · 2222222 ↔ 工作区')
    expect(tab.queryByRole('radio', { name: '提交' })).toBeNull()
    expect(tab.queryByRole('button', { name: '交换两侧' })).toBeNull()
    await waitFor(() => expect(diffText(tab)).toContain(`-${hash('2')}:src/a.ts`))
    expect(server.calls).toContain(api(`compare?from=${hash('2')}`))
    expect(server.calls).toContain(api(`diff?from=${hash('2')}&path=src%2Fa.ts&context=100000`))
  })

  it('names a stash’s versions short and opens on the file it was given', async () => {
    const tab = open({
      kind: 'git-compare',
      botId: 'b1',
      from: `${hash('a')}^1`,
      to: hash('a'),
      file: 'README.md',
    })
    expect(title()).toBe('比较 · aaaaaaa^1 ↔ aaaaaaa')
    expect(tab.getByRole('radio', { name: '文件' }).getAttribute('aria-checked')).toBe('true')
    await waitFor(() => expect(diffText(tab)).toContain(`+${hash('a')}:README.md`))
  })

  it('walks from the files to a diff and back on a phone', async () => {
    const w = width(600)
    const tab = open({ kind: 'git-compare', botId: 'b1', from: 'main', to: null, file: null })
    const files = within(await tab.findByRole('region', { name: '变更文件' }))
    expect(tab.queryByTestId('git-diff')).toBeNull()
    fireEvent.click(files.getByRole('button', { name: '修改：src/a.ts' }))
    await waitFor(() => expect(diffText(tab)).toContain('-main:src/a.ts'))
    expect(tab.queryByRole('region', { name: '变更文件' })).toBeNull()
    fireEvent.click(tab.getByRole('button', { name: '返回文件列表' }))
    expect(tabs()[0]).toMatchObject({ file: null })
    expect(await tab.findByRole('region', { name: '变更文件' })).toBeTruthy()
    w.mockRestore()
  })
})
