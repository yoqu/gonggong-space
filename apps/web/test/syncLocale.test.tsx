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

  it("shows failure reasons in the viewer's language, whatever the machine's", async () => {
    const secret = {
      key: '疑似密钥文件 {path}，未被 git 跟踪，请加入 .gitignore 或移出工作区',
      params: { path: '.env' },
    }
    mockApi({
      'GET /groups/g1/sync': {
        groupId: 'g1',
        headVersion: 3,
        consistent: 0,
        total: 2,
        replicas: [
          { ...replica('b1', 'error'), issue: 'error', reason: secret.key, reasonI18n: secret },
          {
            ...replica('b2', 'excluded'),
            reason: 'daemon 版本过旧，请升级',
            reasonI18n: { key: 'daemon 版本过旧，请升级' },
          },
        ],
      },
    })
    const { resetSync } = await import('../src/features/sync/store')
    resetSync()
    const { SyncPanel } = await import('../src/features/sync/SyncPanel')
    const { RunSyncLine } = await import('../src/features/sync/RunSyncLine')
    render(<SyncPanel groupId="g1" onClose={() => {}} />)
    const b1 = await screen.findByTestId('replica-b1')
    expect(
      within(b1).getByText(
        ".env looks like a secret file and isn't tracked by git; add it to .gitignore or move it out of the workspace",
      ),
    ).toBeTruthy()
    expect(
      within(screen.getByTestId('replica-b2')).getByText('The daemon is too old to sync, please upgrade'),
    ).toBeTruthy()
    const line = (sync: unknown) =>
      render(<RunSyncLine run={{ groupId: 'g1', botId: 'b1', sync } as never} />).container.textContent
    expect(line({ outcome: 'error', reason: '.env …', reasonI18n: secret })).toBe(
      "Sync failed: .env looks like a secret file and isn't tracked by git; add it to .gitignore or move it out of the workspace",
    )
    const rejected = { key: '同步提交被拒绝：超过单版体积上限' }
    expect(line({ outcome: 'error', reason: rejected.key, reasonI18n: rejected })).toBe(
      'Sync submit rejected: over the per-version size limit',
    )
    expect(line({ outcome: 'error', reason: 'Disk full', reasonI18n: null })).toBe('Sync failed: Disk full')
  })
})
