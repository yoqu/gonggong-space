import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import {
  getTheme,
  initTheme as initWebTheme,
  setTheme as setWebTheme,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from '@web/app/theme'

// The webview switch alone leaves the native title bar / traffic-light area behind;
// Tauri's setTheme updates the NSWindow appearance (null = follow the OS).
const syncNative = (preference: ThemePreference) => {
  if (!isTauri()) return
  getCurrentWindow()
    .setTheme(preference === 'system' ? null : preference)
    .catch(() => {})
}

export const initTheme = (): void => {
  initWebTheme()
  syncNative(getTheme())
}

export const setTheme = (preference: ThemePreference): void => {
  setWebTheme(preference)
  syncNative(preference)
}

export { getTheme, THEME_STORAGE_KEY, type ThemePreference }
