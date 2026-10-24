import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  commit,
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
      ],
    }),
    'GET git/diff': fakeDiff,
  })
})
afterEach(() => vi.unstubAllGlobals())

const api = (path: string) => `/api/groups/g1/bots/b1/git/${path}`
const title = () => screen.getByRole('heading', { level: 2 }).textContent

describe('compare tab', () => {
  it('lists the commits only on either side, each opening in the log', async () => {
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
    expect(logTab()).toMatchObject({ ref: 'feat/x', commit: hash('2') })
    fireEvent.click(onFrom.getByRole('option', { name: /提交 4/ }))
    expect(logTab()).toMatchObject({ ref: 'main', commit: hash('4') })
  })

  it('swaps the two sides', async () => {
    const tab = open({ kind: 'git-compare', botId: 'b1', from: 'main', to: 'feat/x', file: null })
    fireEvent.click(tab.getByRole('button', { name: '交换两侧' }))
    expect(tabs()[0]).toMatchObject({ from: 'feat/x', to: 'main' })
    expect(title()).toBe('比较 · feat/x ↔ main')
    expect(await tab.findByRole('region', { name: '仅在 main 中' })).toBeTruthy()
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
