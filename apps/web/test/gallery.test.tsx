import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import UiGallery from '../src/app/UiGallery'

describe('UiGallery', () => {
  it('toggles a demo box per spring token', () => {
    render(<UiGallery />)
    const box = screen.getByTestId('spring-bouncy')
    expect(box.style.transition).toBe('transform var(--spring-bouncy)')
    expect(box.dataset.on).toBeUndefined()
    fireEvent.click(screen.getByRole('button', { name: 'bouncy' }))
    expect(box.dataset.on).toBe('true')
  })

  it('previews every glass level', () => {
    render(<UiGallery />)
    const backdrop = screen.getByTestId('glass-backdrop')
    expect(backdrop.dataset.glass).toBe('standard')
    fireEvent.click(screen.getByRole('tab', { name: '着色' }))
    expect(backdrop.dataset.glass).toBe('tinted')
  })
})
