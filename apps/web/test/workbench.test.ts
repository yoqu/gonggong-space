import { beforeEach, describe, expect, it, vi } from 'vitest'
import { holdTab, liveFrames, tabKey, useWorkbench, WORKBENCH_MAX_TABS } from '../src/app/workbench'
import { openTab } from '../src/features/workbench/open'
import { useToasts } from '../src/ui'

const bench = () => {
  const s = useWorkbench.getState()
  return s.benches[s.groupId ?? ''] ?? { tabs: [], active: null, used: {} }
}
const web = (id: string) => ({ kind: 'web', previewId: id, path: '/' }) as const
const run = (id: string) => ({ kind: 'run', runId: id, view: 'process', file: null }) as const

beforeEach(() => {
  localStorage.clear()
  useWorkbench.setState({ groupId: 'g1', open: false, mode: 'split', previous: 'split', benches: {} })
  useToasts.setState({ items: [] })
})

describe('workbench store', () => {
  it('dedupes tabs by key and focuses the existing one', () => {
    const s = useWorkbench.getState()
    s.show(run('r1'))
    s.show(web('p1'))
    s.show({ ...run('r1'), view: 'diff' })
    expect(bench().tabs.map(tabKey)).toEqual(['run:r1', 'web:p1'])
    expect(bench().active).toBe('run:r1')
    expect(bench().tabs[0]).toMatchObject({ view: 'diff' })
  })

  it('opens a web tab in focus mode, other tabs keep the mode', () => {
    useWorkbench.getState().show(run('r1'))
    expect(useWorkbench.getState()).toMatchObject({ open: true, mode: 'split' })
    useWorkbench.getState().show(web('p1'))
    expect(useWorkbench.getState().mode).toBe('focus')
  })

  it('keeps tabs per group and restores them', () => {
    useWorkbench.getState().show(run('r1'))
    useWorkbench.getState().setGroup('g2')
    expect(bench().tabs).toEqual([])
    expect(useWorkbench.getState().open).toBe(false)
    useWorkbench.getState().setGroup('g1')
    expect(bench().tabs.map(tabKey)).toEqual(['run:r1'])
    expect(JSON.parse(localStorage.getItem('gonggong.workbench') ?? '{}').benches.g1.tabs).toHaveLength(1)
  })

  it('activates the neighbour when the active tab closes', () => {
    const s = useWorkbench.getState()
    s.show(run('a'))
    s.show(run('b'))
    s.show(run('c'))
    s.activate('run:b')
    s.closeTab('run:b')
    expect(bench().active).toBe('run:c')
  })

  it('refuses a new tab beyond the limit', () => {
    const s = useWorkbench.getState()
    for (let i = 0; i < WORKBENCH_MAX_TABS; i++) expect(s.show(run(`r${i}`))).toBe(true)
    expect(s.show(run('extra'))).toBe(false)
    expect(s.show(run('r0'))).toBe(true)
  })

  it('keeps only the most recently used web frames live', () => {
    const s = useWorkbench.getState()
    for (const id of ['a', 'b', 'c', 'd', 'e']) s.show(web(id))
    const b = bench()
    const used = Object.fromEntries(['a', 'b', 'c', 'd', 'e'].map((id, i) => [`web:${id}`, i]))
    expect([...liveFrames({ ...b, used })].sort()).toEqual(['web:b', 'web:c', 'web:d', 'web:e'])
  })

  it('remembers the mode left by full screen', () => {
    const s = useWorkbench.getState()
    s.setMode('focus')
    s.setMode('full')
    expect(useWorkbench.getState().previous).toBe('focus')
  })
})

describe('openTab', () => {
  it('closes the least recently used inactive tab when full', () => {
    let now = 1
    vi.spyOn(Date, 'now').mockImplementation(() => now++)
    const link = (i: number) => ({ kind: 'link', url: `https://x/${i}`, title: `页面${i}` }) as const
    for (let i = 0; i < WORKBENCH_MAX_TABS; i++) expect(openTab(link(i))).toBe(true)
    useWorkbench.getState().activate('link:https://x/0')
    useWorkbench.getState().activate('link:https://x/5')
    expect(openTab(link(99))).toBe(true)
    const keys = bench().tabs.map(tabKey)
    expect(keys).toHaveLength(WORKBENCH_MAX_TABS)
    expect(keys).not.toContain('link:https://x/1')
    expect(keys).toContain('link:https://x/0')
    expect(bench().active).toBe('link:https://x/99')
    expect(useToasts.getState().items.map((x) => x.message)).toContain('已关闭最久未用的「页面1」')
    vi.restoreAllMocks()
  })

  it('never closes a tab that may hold unsaved work, and reopens the closed one from the toast', () => {
    let now = 1
    vi.spyOn(Date, 'now').mockImplementation(() => now++)
    const art = (i: number) => ({ kind: 'artifact', artifactId: `a${i}`, title: `原型${i}` }) as const
    for (let i = 0; i < WORKBENCH_MAX_TABS - 1; i++) openTab(art(i))
    openTab(run('r1'))
    useWorkbench.getState().activate('artifact:a0')
    expect(openTab(run('r2'))).toBe(true)
    const keys = bench().tabs.map(tabKey)
    expect(keys).not.toContain('run:r1')
    expect(keys.filter((k) => k.startsWith('artifact:'))).toHaveLength(WORKBENCH_MAX_TABS - 1)
    const [shown] = useToasts.getState().items
    const action = shown?.action as { label: string; onClick: () => void }
    expect(action.label).toBe('重新打开')

    // Only prototypes left besides the active tab: nothing is closed, the user is told the bench is full.
    useWorkbench.getState().activate('run:r2')
    expect(openTab(run('r3'))).toBe(false)
    expect(bench().tabs.map(tabKey)).toEqual(keys)
    expect(useToasts.getState().items[0]?.message).toBe(
      `标签页已满（最多 ${WORKBENCH_MAX_TABS} 个），请先关闭一些`,
    )

    useWorkbench.getState().activate('artifact:a1')
    action.onClick()
    expect(bench().tabs.map(tabKey)).toContain('run:r1')
    expect(bench().tabs.map(tabKey)).not.toContain('run:r2')
    vi.restoreAllMocks()
  })

  it('never closes a run tab holding an unanswered question', () => {
    let now = 1
    vi.spyOn(Date, 'now').mockImplementation(() => now++)
    for (let i = 0; i < WORKBENCH_MAX_TABS; i++) openTab(run(`r${i}`))
    holdTab('run:r0', true)
    expect(openTab(web('p1'))).toBe(true)
    const keys = bench().tabs.map(tabKey)
    expect(keys).toContain('run:r0')
    expect(keys).not.toContain('run:r1')
    holdTab('run:r0', false)
    expect(openTab(web('p2'))).toBe(true)
    expect(bench().tabs.map(tabKey)).not.toContain('run:r0')
    vi.restoreAllMocks()
  })

  it('reopens a closed tab in the group it was closed in, even after switching groups', () => {
    let now = 1
    vi.spyOn(Date, 'now').mockImplementation(() => now++)
    for (let i = 0; i < WORKBENCH_MAX_TABS; i++) openTab(run(`r${i}`))
    openTab(web('p1'))
    const action = useToasts.getState().items[0]?.action as { onClick: () => void }
    useWorkbench.getState().setGroup('g2')
    action.onClick()
    expect(useWorkbench.getState().benches.g2).toBeUndefined()
    expect(useWorkbench.getState().groupId).toBe('g2')
    expect(useWorkbench.getState().benches.g1!.tabs.map(tabKey)).toContain('run:r0')
    vi.restoreAllMocks()
  })
})
