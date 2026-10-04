import { render, screen, within } from '@testing-library/react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mockApi } from './mockApi'

beforeAll(() => {
  localStorage.setItem('gg.locale', 'en')
  vi.resetModules()
  vi.stubGlobal('WebSocket', class {})
})

afterAll(() => {
  localStorage.setItem('gg.locale', 'zh')
  vi.resetModules()
  vi.unstubAllGlobals()
})

const replica = (botId: string, state: string) => ({
  botId,
  botName: botId,
  machineName: null,
  version: 3,
  state,
  updatedAt: null,
  files: [],
  reason: null,
})

describe('sync in English', () => {
  it('translates the status bar and replica states', async () => {
    mockApi({
      'GET /groups/g1/sync': {
        groupId: 'g1',
        headVersion: 3,
        consistent: 1,
        total: 3,
        replicas: [replica('b1', 'consistent'), replica('b2', 'conflict'), replica('b3', 'drift')],
      },
    })
    const { SyncBar } = await import('../src/features/sync/SyncBar')
    const { SyncPanel } = await import('../src/features/sync/SyncPanel')
    render(<SyncBar group={{ id: 'g1', mode: 'force' }} />)
    const bar = await screen.findByRole('button', { name: /Force sync · v3 · 1\/3 in sync/ })
    expect(bar.textContent).toContain('1 conflict')
    expect(bar.textContent).toContain('1 Bot has local changes')
    render(<SyncPanel groupId="g1" onClose={() => {}} />)
    expect(within(await screen.findByTestId('replica-b2')).getByText('Conflict pending')).toBeTruthy()
    expect(within(screen.getByTestId('replica-b3')).getByText('Local changes')).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Version history' })).toBeTruthy()
  })
})
