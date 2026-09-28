import type { BotDto, DiffScope } from '@gonggong/protocol'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tabKey, useWorkbench, type WorkbenchTab } from '../src/app/workbench'
import { useWorkspace } from '../src/app/workspace'
import { TabContent, TabLabel } from '../src/features/workbench/TabContent'

const PATCHES: Record<string, string> = {
  uncommitted: [
    'diff --git a/src/app/a.ts b/src/app/a.ts',
    '@@ -1 +1 @@',
    '-old',
    '+new',
    'diff --git a/README.md b/README.md',
    '@@ -0,0 +1 @@',
    '+# readme',
    '',
  ].join('\n'),
  base: ['diff --git a/lib/c.ts b/lib/c.ts', '@@ -0,0 +1 @@', '+c', ''].join('\n'),
}

const tab = (o: Partial<Extract<WorkbenchTab, { kind: 'diff' }>> = {}): WorkbenchTab => ({
  kind: 'diff',
  botId: 'b1',
  scope: 'uncommitted',
  file: null,
  ...o,
})
const current = () => useWorkbench.getState().benches.g1?.tabs ?? []

/** Renders the group's tabs as the workbench would: labels and mounted bodies. */
function Bench() {
  const tabs = useWorkbench((s) => s.benches.g1?.tabs ?? [])
  return (
    <>
      {tabs.map((t) => (
        <section key={tabKey(t)}>
          <TabLabel tab={t}>{(m) => <h2 data-icon={m.icon}>{m.title}</h2>}</TabLabel>
          <TabContent tab={t} active />
        </section>
      ))}
    </>
  )
}

let calls: string[]
beforeEach(() => {
  calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url)
      const scope = new URL(url, 'http://x').searchParams.get('scope') as DiffScope
      return new Response(
        JSON.stringify({ scope, patch: PATCHES[scope] ?? null, base: 'main', branch: 'feat/x' }),
      )
    }),
  )
  useWorkspace.setState({ bots: [{ id: 'b1', name: '小王的 Claude' } as BotDto] })
  useWorkbench.setState({ groupId: 'g1', open: true, benches: {} })
})
afterEach(() => vi.unstubAllGlobals())

const open = (t = tab()) => {
  act(() => {
    useWorkbench.getState().show(t)
  })
  return render(<Bench />)
}

describe('diff tab', () => {
  it('shows a bot workspace diff with 未提交 / 对比主分支 only, keeping scope and file in the tab', async () => {
    open()
    expect(screen.getByRole('heading').textContent).toBe('改动 · 小王的 Claude')
    expect(screen.getByRole('heading').dataset.icon).toBe('git-branch')
    expect(await screen.findByText('+new')).toBeTruthy()
    expect(calls[0]).toBe('/api/groups/g1/bots/b1/diff?scope=uncommitted')
    expect(screen.queryByRole('radio', { name: '本轮' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /README\.md/ }))
    expect(current()[0]).toMatchObject({ scope: 'uncommitted', file: 'README.md' })
    expect(await screen.findByText('+# readme')).toBeTruthy()

    fireEvent.click(screen.getByRole('radio', { name: '对比主分支' }))
    expect(current()[0]).toMatchObject({ scope: 'base', file: null })
    expect(await screen.findByText('+c')).toBeTruthy()
    expect(screen.getByText('feat/x → main')).toBeTruthy()
  })

  it('locates a changed file in the bot file browser', async () => {
    open()
    const row = (await screen.findByRole('button', { name: /a\.ts/ })).parentElement!
    fireEvent.click(within(row).getByRole('button', { name: '在文件浏览器中定位' }))
    expect(current().at(-1)).toEqual({ kind: 'files', botId: 'b1', dir: 'src/app', selected: 'src/app/a.ts' })
    expect(useWorkbench.getState().benches.g1?.active).toBe('files:b1')
  })

  it('folds the file list into a dropdown above the diff when narrow', async () => {
    const observers: ResizeObserverCallback[] = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: ResizeObserverCallback) {
          observers.push(cb)
        }
        observe() {}
        disconnect() {}
      },
    )
    const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200)
    open()
    await screen.findByText('+new')
    const pane = screen.getByTestId('diff-pane')
    expect(pane.dataset.layout).toBe('wide')
    expect(screen.getByRole('button', { name: /README\.md/ })).toBeTruthy()

    width.mockReturnValue(600)
    act(() => {
      for (const cb of observers) cb([], {} as ResizeObserver)
    })
    expect(pane.dataset.layout).toBe('narrow')
    expect(screen.queryByRole('button', { name: /README\.md/ })).toBeNull()
    const pick = screen.getByRole('button', { name: /src\/app\/a\.ts/ })
    expect(pick.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(pick)
    fireEvent.click(screen.getByRole('button', { name: /README\.md/ }))
    expect(current()[0]).toMatchObject({ file: 'README.md' })
    expect(await screen.findByText('+# readme')).toBeTruthy()
    expect(screen.getByRole('button', { name: /README\.md/ }).getAttribute('aria-expanded')).toBe('false')
    width.mockRestore()
  })
})
