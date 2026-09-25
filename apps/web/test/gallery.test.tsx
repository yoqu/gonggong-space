import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import UiGallery, { GlassDemo, MotionDemos } from '../src/app/UiGallery'

// The demos render on their own: the full gallery is thousands of nodes, and role queries over it
// are slow enough to time out when the whole suite runs in parallel.
describe('UiGallery', () => {
  it('renders every section', () => {
    render(<UiGallery />)
    expect(screen.getByText('组件库')).toBeTruthy()
    expect(screen.getByTestId('spring-bouncy')).toBeTruthy()
    expect(screen.getByTestId('glass-backdrop')).toBeTruthy()
  })

  it('toggles a demo box per spring token', () => {
    render(<MotionDemos />)
    const box = screen.getByTestId('spring-bouncy')
    expect(box.style.transition).toBe('transform var(--spring-bouncy)')
    expect(box.dataset.on).toBeUndefined()
    fireEvent.click(screen.getByRole('button', { name: 'bouncy' }))
    expect(box.dataset.on).toBe('true')
  })

  it('previews every glass level', () => {
    render(<GlassDemo />)
    const backdrop = screen.getByTestId('glass-backdrop')
    expect(backdrop.dataset.glass).toBe('standard')
    fireEvent.click(screen.getByRole('tab', { name: '着色' }))
    expect(backdrop.dataset.glass).toBe('tinted')
  })
})
