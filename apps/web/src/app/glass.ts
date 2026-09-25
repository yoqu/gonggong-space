export type GlassPreference = 'clear' | 'standard' | 'tinted'

export const GLASS_STORAGE_KEY = 'gonggong.glass'
export const DEFAULT_GLASS_PREFERENCE: GlassPreference = 'standard'

const isGlassPreference = (value: unknown): value is GlassPreference =>
  value === 'clear' || value === 'standard' || value === 'tinted'

export const getGlass = (): GlassPreference => {
  try {
    const value = window.localStorage.getItem(GLASS_STORAGE_KEY)
    return isGlassPreference(value) ? value : DEFAULT_GLASS_PREFERENCE
  } catch {
    return DEFAULT_GLASS_PREFERENCE
  }
}

export const applyGlass = (preference: GlassPreference = getGlass()): void => {
  document.documentElement.dataset.glass = preference
}

export const setGlass = (preference: GlassPreference): void => {
  const sanitized = isGlassPreference(preference) ? preference : DEFAULT_GLASS_PREFERENCE
  try {
    window.localStorage.setItem(GLASS_STORAGE_KEY, sanitized)
  } catch {
    // storage can be unavailable (private mode); the visual switch still applies
  }
  applyGlass(sanitized)
}
