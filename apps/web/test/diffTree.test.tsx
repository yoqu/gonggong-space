import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { DiffFileList, DiffLayoutToggle } from '../src/features/diff/DiffParts'
import { type DiffFile, diffTree } from '../src/features/diff/patch'
import { useDiffLayout } from '../src/features/diff/store'

const file = (path: string): DiffFile => ({
  path,
  status: 'modified',
  add: 1,
  del: 0,
  binary: false,
  lines: [],
})
const files = ['src/b.ts', 'README.md', 'src/a/x.ts', 'src/a/y.ts', 'deep/only/one.ts'].map(file)

describe('diffTree', () => {
  it('groups by directory, folds single-child chains and lists folders first', () => {
    const shape = (nodes: ReturnType<typeof diffTree>): unknown =>
      nodes.map((n) => (n.kind === 'dir' ? { [n.name]: shape(n.children) } : n.name))
    expect(shape(diffTree(files))).toEqual([
      { 'deep/only': ['one.ts'] },
      { src: [{ a: ['x.ts', 'y.ts'] }, 'b.ts'] },
      'README.md',
    ])
  })
})

describe('DiffFileList layout', () => {
  beforeEach(() => {
    localStorage.clear()
    useDiffLayout.setState({ layout: 'list' })
  })

  it('switches between the flat list and a collapsible tree, remembering the choice', () => {
    const picked: string[] = []
    render(
      <>
        <DiffLayoutToggle />
        <DiffFileList files={files} onPick={(p) => picked.push(p)} />
      </>,
    )
    expect(screen.queryByRole('button', { name: /^src$/ })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '以目录树显示' }))
    expect(localStorage.getItem('gonggong.diffLayout')).toBe('tree')
    const src = screen.getByRole('button', { name: /^src$/ })
    expect(src.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: /x\.ts/ }))
    expect(picked).toEqual(['src/a/x.ts'])

    fireEvent.click(src)
    expect(screen.queryByRole('button', { name: /x\.ts/ })).toBeNull()
    expect(screen.getByRole('button', { name: /README\.md/ })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '以列表显示' }))
    expect(localStorage.getItem('gonggong.diffLayout')).toBe('list')
    expect(screen.getByRole('button', { name: /x\.ts/ })).toBeTruthy()
  })
})
