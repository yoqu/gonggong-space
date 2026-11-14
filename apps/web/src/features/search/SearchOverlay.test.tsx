import type { SearchResultDto } from '@gonggong/protocol'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mockApi } from '../../../test/mockApi'
import { useWorkspace } from '../../app/workspace'
import { SearchOverlay } from './SearchOverlay'

function Where() {
  const l = useLocation()
  return <div data-testid="where">{l.pathname + l.search}</div>
}

const hit = (o: Partial<SearchResultDto>): SearchResultDto => ({
  kind: 'run',
  title: '小王的 Claude · 迁移',
  sub: '陈晨 · 支付服务重构',
  groupId: 'g1',
  messageId: null,
  runId: 'r7',
  at: '2026-09-23T02:21:00.000Z',
  ...o,
})

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  useWorkspace.setState({ groups: [] })
})
afterEach(() => vi.unstubAllGlobals())

it('returns focus to the input after picking a tab, so arrows and Enter still drive the results', async () => {
  mockApi({
    'GET /search?q=%E9%80%80%E6%AC%BE&tab=msg': [],
    'GET /search?q=%E9%80%80%E6%AC%BE&tab=run': [hit({}), hit({ title: '退款二', runId: 'r8' })],
  })
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <SearchOverlay onClose={() => {}} />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
  const input = screen.getByPlaceholderText('搜索会话、消息、文件、运行')
  fireEvent.change(input, { target: { value: '退款' } })
  const tab = screen.getByRole('tab', { name: '运行' })
  tab.focus()
  fireEvent.click(tab)
  expect(document.activeElement).toBe(input)

  const rows = await within(screen.getByTestId('search-results')).findAllByRole('option')
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
  expect(rows[1]!.getAttribute('aria-selected')).toBe('true')
  fireEvent.keyDown(document.activeElement!, { key: 'Enter' })
  expect(screen.getByTestId('where').textContent).toBe('/g/g1?run=r8')
})
