import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FeishuAdminPage } from '../src/features/feishu/FeishuAdminPage'
import { api } from '../src/lib/api'

const ROOT = resolve(import.meta.dirname, '..')

describe('feishu admin mobile UX fixes', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('adds mobile single-column and non-overflowing rules for FeishuAdminPage', async () => {
    vi.spyOn(api, 'get').mockImplementation((path: string) => {
      if (path === '/admin/params') {
        return Promise.resolve({
          feishuAutoSignup: true,
          publicUrl: '',
        })
      }
      if (path === '/admin/feishu/overview') {
        return Promise.resolve({
          publicUrl: '',
          main: null,
          othersLinked: false,
          linkedUsers: 0,
          bots: [],
          chats: [],
        })
      }
      if (path === '/admin/feishu') return Promise.resolve(null)
      return Promise.resolve([])
    })

    const { container } = render(
      <MemoryRouter>
        <FeishuAdminPage />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(container.querySelector('.feishu-url-row')).not.toBeNull()
    })
    // GroupRow's own stacked layout: the phone wrap rules (180px basis) never turn into a tall gap above the field.
    expect(container.querySelector('.feishu-url-row')?.className).toContain('ui-group__row--stacked')

    const feishuCss = readFileSync(resolve(ROOT, 'src/features/feishu/feishu.css'), 'utf8')
    expect(feishuCss).not.toContain('.ui-group__row.feishu-url-row')
    // The copy button stays beside the long redirect URL instead of dropping to a line of its own.
    expect(feishuCss).toMatch(/\.feishu-url-line--copy\s*\{[^}]*flex-wrap:\s*nowrap/)
    expect(feishuCss).toContain('.feishu-app__fields')
    expect(feishuCss).toContain('grid-template-columns: 1fr')
    expect(feishuCss).toContain('overflow-wrap: anywhere')
  })
})
