import { afterEach, describe, expect, it, vi } from 'vitest'
import { localDate, localDateTime, pad } from '../src/lib/time'

const SAMPLE = '2026-08-15T09:05:03.000Z'

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.setItem('gg.locale', 'zh')
})

describe('time helpers', () => {
  it('formats dates and datetimes with explicit zh-CN locale when app locale is zh', () => {
    const dateSpy = vi.spyOn(Date.prototype, 'toLocaleDateString')
    const dtSpy = vi.spyOn(Date.prototype, 'toLocaleString')

    const d = localDate(SAMPLE)
    const dt = localDateTime(SAMPLE)

    expect(dateSpy).toHaveBeenCalledWith('zh-CN')
    expect(dtSpy).toHaveBeenCalledWith('zh-CN')
    expect(d).toBe(new Date(SAMPLE).toLocaleDateString('zh-CN'))
    expect(dt).toBe(new Date(SAMPLE).toLocaleString('zh-CN'))
  })

  it('formats dates and datetimes with explicit en-US locale when app locale is en', async () => {
    localStorage.setItem('gg.locale', 'en')
    vi.resetModules()
    const mod = await import('../src/lib/time')
    const dateSpy = vi.spyOn(Date.prototype, 'toLocaleDateString')
    const dtSpy = vi.spyOn(Date.prototype, 'toLocaleString')

    expect(mod.dateLocale).toBe('en-US')
    expect(mod.localDate(SAMPLE)).toBe(new Date(SAMPLE).toLocaleDateString('en-US'))
    expect(mod.localDateTime(SAMPLE)).toBe(new Date(SAMPLE).toLocaleString('en-US'))
    expect(dateSpy).toHaveBeenCalledWith('en-US')
    expect(dtSpy).toHaveBeenCalledWith('en-US')
    vi.resetModules()
  })

  it('pads both numbers and strings to two digits', () => {
    expect(pad(5)).toBe('05')
    expect(pad(12)).toBe('12')
    expect(pad('9')).toBe('09')
    expect(pad('15')).toBe('15')
  })
})
