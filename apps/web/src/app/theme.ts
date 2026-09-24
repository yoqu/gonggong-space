export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'aiws.theme'
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'light'

const MEDIA_QUERY = '(prefers-color-scheme: dark)'

const isThemePreference = (value: unknown): value is ThemePreference =>
  value === 'light' || value === 'dark' || value === 'system'

const readStored = (): ThemePreference | null => {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY)
    return isThemePreference(value) ? value : null
  } catch {
    return null
  }
}

export const getTheme = (): ThemePreference => readStored() ?? DEFAULT_THEME_PREFERENCE

const systemTheme = (): ResolvedTheme => {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia(MEDIA_QUERY).matches
      ? 'dark'
      : 'light'
  } catch {
    return 'light'
  }
}

export const resolveTheme = (preference: ThemePreference = getTheme()): ResolvedTheme =>
  preference === 'system' ? systemTheme() : preference

const applyDataset = (theme: ResolvedTheme) => {
  document.documentElement.dataset.theme = theme
}

let mediaQueryList: MediaQueryList | null = null

const onSystemChange = () => {
  if (getTheme() === 'system') applyDataset(systemTheme())
}

const syncSystemListener = (preference: ThemePreference) => {
  if (typeof window.matchMedia !== 'function') return
  if (preference === 'system' && !mediaQueryList) {
    mediaQueryList = window.matchMedia(MEDIA_QUERY)
    mediaQueryList.addEventListener('change', onSystemChange)
  } else if (preference !== 'system' && mediaQueryList) {
    mediaQueryList.removeEventListener('change', onSystemChange)
    mediaQueryList = null
  }
}

export const setTheme = (preference: ThemePreference): void => {
  const sanitized = isThemePreference(preference) ? preference : DEFAULT_THEME_PREFERENCE
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, sanitized)
  } catch {
    // storage can be unavailable (private mode); the visual switch still applies
  }
  syncSystemListener(sanitized)
  const apply = () => applyDataset(resolveTheme(sanitized))
  const reduced =
    typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (typeof document.startViewTransition === 'function' && !reduced) document.startViewTransition(apply)
  else apply()
}

// Call once at startup (main.tsx) so a stored 'system' preference keeps following the OS.
export const initTheme = (): void => {
  const preference = getTheme()
  syncSystemListener(preference)
  applyDataset(resolveTheme(preference))
}
