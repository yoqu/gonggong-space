import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuditPanel } from '../src/features/admin/AuditPage'
import { TeamsPage } from '../src/features/admin/TeamsPage'
import { ConflictDialog } from '../src/features/sync/ConflictDialog'
import { syncApi } from '../src/features/sync/store'
import { api } from '../src/lib/api'

const ROOT = resolve(import.meta.dirname, '..')

describe('audit, teams archive & sync conflict UX fixes', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('adds horizontal scroll class for AuditPanel filters, guards race conditions, and prevents duplicate loadMore', async () => {
    const page1 = Array.from({ length: 50 }, (_, i) => ({
      id: 100 - i,
      at: '2026-11-21T10:00:00.000Z',
      category: 'admin',
      actorName: '系统',
      groupName: null,
      summary: `记录 ${i + 1}`,
      detail: {},
    }))
    let resolveMore!: (v: typeof page1) => void
    let call = 0
    const getSpy = vi.spyOn(api, 'get').mockImplementation(() => {
      call += 1
      if (call === 1) return Promise.resolve(page1)
      return new Promise((r) => {
        resolveMore = r
      })
    })

    const { container } = render(<AuditPanel base="/admin/audit" />)

    await waitFor(() => {
      expect(screen.getByText('记录 1')).toBeTruthy()
    })
    expect(container.querySelector('.admin-audit__filters')).not.toBeNull()
    const auditCss = readFileSync(resolve(ROOT, 'src/features/admin/audit.css'), 'utf8')
    expect(auditCss).toContain('.admin-audit__filters .ui-seg')
    expect(auditCss).toContain('overflow-x: auto')

    // Click load more twice while in-flight -> only 1 extra request
    const moreBtn = screen.getByRole('button', { name: '加载更多' })
    fireEvent.click(moreBtn)
    await waitFor(() => {
      expect((screen.getByRole('button', { name: '加载中' }) as HTMLButtonElement).disabled).toBe(true)
    })
    fireEvent.click(screen.getByRole('button', { name: '加载中' }))
    expect(getSpy).toHaveBeenCalledTimes(2)

    resolveMore([])
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '加载更多' })).toBeNull()
    })
  })

  it('requires confirmation dialog before archiving a team', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([
      {
        id: 't-1',
        name: '产品设计组',
        avatar: null,
        ownerName: '管理员',
        members: 3,
        createdAt: '2026-11-01T00:00:00.000Z',
        archivedAt: null,
      },
    ])
    const postSpy = vi.spyOn(api, 'post').mockResolvedValue({})

    render(
      <MemoryRouter>
        <TeamsPage />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('产品设计组')).toBeTruthy()
    })

    // Open row actions menu and click archive
    const actionBtn = screen.getByRole('button', { name: '操作' })
    fireEvent.click(actionBtn)
    fireEvent.click(await screen.findByRole('menuitem', { name: '归档团队' }))

    // Confirmation dialog appears; API not yet called
    await waitFor(() => {
      expect(screen.getByText('要归档团队「产品设计组」吗？')).toBeTruthy()
    })
    expect(postSpy).not.toHaveBeenCalled()

    // Confirm triggers archive API
    fireEvent.click(screen.getByRole('button', { name: '归档团队' }))
    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith('/admin/teams/t-1/archive')
    })
  })

  it('shows error state with retry instead of "冲突已处理" when ConflictDialog fails to load', async () => {
    const spy = vi
      .spyOn(syncApi, 'conflicts')
      .mockRejectedValueOnce(new Error('网络中断'))
      .mockResolvedValueOnce([])

    render(<ConflictDialog groupId="g-1" botId="b-1" botName="共字君" onClose={() => {}} />)

    await waitFor(() => {
      expect(screen.getByText('读取冲突失败')).toBeTruthy()
    })
    expect(screen.queryByText('冲突已处理')).toBeNull()
    expect(screen.getByText('网络中断')).toBeTruthy()

    // Clicking retry reloads and shows resolved empty state
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => {
      expect(screen.getByText('冲突已处理')).toBeTruthy()
    })
    expect(spy).toHaveBeenCalledTimes(2)
  })
})
