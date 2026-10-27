import { beforeEach, expect, it, vi } from 'vitest'

beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
})

it('restores an open workbench and its active terminal after a page reload', async () => {
  localStorage.setItem(
    'gonggong.workbench',
    JSON.stringify({
      open: true,
      mode: 'split',
      benches: {
        g1: {
          tabs: [{ kind: 'terminal', botId: 'b1', sessionId: 's1' }],
          active: 'terminal:b1',
          used: { 'terminal:b1': 1 },
        },
      },
    }),
  )

  const { useWorkbench } = await import('../src/app/workbench')

  expect(useWorkbench.getState()).toMatchObject({
    open: true,
    benches: { g1: { active: 'terminal:b1' } },
  })
  expect(useWorkbench.getState().benches.g1?.tabs).toEqual([
    { kind: 'terminal', botId: 'b1', sessionId: 's1' },
  ])
  useWorkbench.getState().setGroup(null)
  expect(useWorkbench.getState().open).toBe(true)
  useWorkbench.getState().setGroup('g1')
  expect(useWorkbench.getState().open).toBe(true)
  useWorkbench.getState().setOpen(false)
  expect(JSON.parse(localStorage.getItem('gonggong.workbench')!).open).toBe(false)
  useWorkbench.getState().setOpen(true)
  useWorkbench.getState().closeTab('terminal:b1')
  expect(JSON.parse(localStorage.getItem('gonggong.workbench')!).open).toBe(false)
})

it('keeps a closed workbench hidden after a page reload', async () => {
  localStorage.setItem('gonggong.workbench', JSON.stringify({ open: false, benches: {} }))

  const { useWorkbench } = await import('../src/app/workbench')

  expect(useWorkbench.getState().open).toBe(false)
})
