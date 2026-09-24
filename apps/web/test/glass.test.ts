import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyGlass, GLASS_STORAGE_KEY, getGlass, setGlass } from '../src/app/glass'

const reset = () => {
  window.localStorage.clear()
  document.documentElement.removeAttribute('data-glass')
}

beforeEach(reset)
afterEach(reset)

describe('glass preference', () => {
  it('defaults to standard when nothing is stored', () => {
    expect(getGlass()).toBe('standard')
    applyGlass()
    expect(document.documentElement.dataset.glass).toBe('standard')
  })

  it('setGlass persists the level and updates data-glass', () => {
    setGlass('clear')
    expect(window.localStorage.getItem(GLASS_STORAGE_KEY)).toBe('clear')
    expect(getGlass()).toBe('clear')
    expect(document.documentElement.dataset.glass).toBe('clear')

    setGlass('tinted')
    expect(window.localStorage.getItem(GLASS_STORAGE_KEY)).toBe('tinted')
    expect(document.documentElement.dataset.glass).toBe('tinted')
  })

  it('applyGlass re-applies the stored level on startup', () => {
    window.localStorage.setItem(GLASS_STORAGE_KEY, 'tinted')
    applyGlass()
    expect(document.documentElement.dataset.glass).toBe('tinted')
  })

  it('falls back to standard for an invalid stored or runtime value', () => {
    window.localStorage.setItem(GLASS_STORAGE_KEY, 'frosted')
    expect(getGlass()).toBe('standard')
    applyGlass()
    expect(document.documentElement.dataset.glass).toBe('standard')

    setGlass('frosted' as Parameters<typeof setGlass>[0])
    expect(window.localStorage.getItem(GLASS_STORAGE_KEY)).toBe('standard')
    expect(document.documentElement.dataset.glass).toBe('standard')
  })
})
