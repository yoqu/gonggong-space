import { beforeEach, describe, expect, it } from 'vitest'
import { liveFrames, tabKey, useWorkbench, WORKBENCH_MAX_TABS } from '../src/app/workbench'

const bench = () => {
  const s = useWorkbench.getState()
  return s.benches[s.groupId ?? ''] ?? { tabs: [], active: null, used: {} }
}
const web = (id: string) => ({ kind: 'web', previewId: id, path: '/' }) as const
const run = (id: string) => ({ kind: 'run', runId: id, view: 'process', file: null }) as const

beforeEach(() => {
  localStorage.clear()
  useWorkbench.setState({ groupId: 'g1', open: false, mode: 'split', previous: 'split', benches: {} })
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
