import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type ChangeGroup, ChangeTree } from '../src/features/git/ChangeTree'

const files = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    path: `outputs/f${String(i).padStart(4, '0')}.md`,
    change: 'added' as const,
    untracked: true,
  }))

afterEach(() => vi.restoreAllMocks())

function tree(groups: ChangeGroup[], onSelect = vi.fn()) {
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(240)
  render(
    <div style={{ overflowY: 'auto' }} data-testid="scroller">
      <ChangeTree
        groups={groups}
        layout="tree"
        selected={null}
        onSelect={onSelect}
        closed={new Set()}
        onToggleFolder={() => {}}
        label="要提交的文件"
      />
    </div>,
  )
  return screen.getByRole('region', { name: '要提交的文件' })
}

const fileRows = (el: HTMLElement) => el.querySelectorAll('[data-gt-file]').length

describe('a long change tree', () => {
  it('renders only the rows in view and follows the scroll', () => {
    const region = tree([{ key: 'untracked', label: '未跟踪的文件', changes: files(5000), checkable: true }])
    expect(fileRows(region)).toBeLessThan(100)
    expect(screen.getByRole('button', { name: '未跟踪：outputs/f0000.md' })).toBeTruthy()

    const scroller = screen.getByTestId('scroller')
    const list = region.querySelector('ul') as HTMLElement
    // Scrolled 2400 rows down: the list's top is 57600px above the scroller's.
    vi.spyOn(list, 'getBoundingClientRect').mockReturnValue({ top: -57_600 } as DOMRect)
    vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue({ top: 0 } as DOMRect)
    fireEvent.scroll(scroller)
    expect(screen.queryByRole('button', { name: '未跟踪：outputs/f0000.md' })).toBeNull()
    expect(screen.getByRole('button', { name: '未跟踪：outputs/f2400.md' })).toBeTruthy()
    expect(fileRows(region)).toBeLessThan(100)
  })

  it('renders every row of a short tree', () => {
    const region = tree([{ key: 'untracked', label: '未跟踪的文件', changes: files(50) }])
    expect(fileRows(region)).toBe(50)
  })
})
