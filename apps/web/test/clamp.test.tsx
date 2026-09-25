import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Clamp } from '../src/features/chat/Clamp'

const height = (px: number) =>
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => px)

afterEach(() => vi.restoreAllMocks())

describe('Clamp', () => {
  it('folds long output behind 展开全文 and unfolds on demand', () => {
    height(2000)
    const { container } = render(<Clamp>很长的输出</Clamp>)
    const root = container.firstElementChild as HTMLElement
    expect(root.hasAttribute('data-clamped')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '展开全文' }))
    expect(root.hasAttribute('data-clamped')).toBe(false)
    expect(screen.getByRole('button', { name: '收起' }).getAttribute('aria-expanded')).toBe('true')
  })

  it('leaves normal replies alone', () => {
    height(200)
    render(<Clamp>短回复</Clamp>)
    expect(screen.queryByRole('button', { name: '展开全文' })).toBeNull()
  })
})
