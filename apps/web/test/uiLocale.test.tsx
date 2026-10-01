import { render, screen } from '@testing-library/react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

beforeAll(() => {
  localStorage.setItem('gg.locale', 'en')
  vi.resetModules()
})

afterAll(() => {
  localStorage.setItem('gg.locale', 'zh')
  vi.resetModules()
})

describe('design system in English', () => {
  it('marks the document and formats times and dates in English', async () => {
    document.title = '共工空间'
    const { ago } = await import('../src/lib/time')
    const { listTime } = await import('../src/ui/im/conversation')
    expect(document.documentElement.lang).toBe('en')
    expect(document.title).toBe('Gonggong Space')
    expect(ago(new Date(Date.now() - 60_000).toISOString())).toBe('1 minute ago')
    expect(ago(new Date(Date.now() - 3 * 3_600_000).toISOString())).toBe('3 hours ago')
    const now = new Date(2026, 8, 30, 12)
    expect(listTime(new Date(2026, 8, 29, 9).toISOString(), now)).toBe('Yesterday')
    expect(listTime(new Date(2025, 8, 20).toISOString(), now)).toBe('Sep 20, 2025')
  })

  it('renders component texts and dates in English', async () => {
    const { Calendar, Composer } = await import('../src/ui')
    render(<Composer recipient="Alice" />)
    expect(screen.getByRole('textbox', { name: 'Message input' }).getAttribute('placeholder')).toBe(
      'Message Alice',
    )
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy()
    render(<Calendar defaultValue="2026-10-08" />)
    expect(screen.getByRole('button', { name: 'Today' })).toBeTruthy()
    expect(screen.getByText('October 2026')).toBeTruthy()
    expect(screen.getByRole('gridcell', { name: 'Thursday, October 8, 2026' })).toBeTruthy()
  })
})
