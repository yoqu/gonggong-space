/**
 * The color scheme the board paints in: the system's light or dark mode,
 * unless the page root pins `data-theme`. Element colors are computed per
 * scheme (see whiteboard-core's theme), so components select it here.
 */

import { create } from 'zustand';
import type { ColorScheme } from '@open-artifact/whiteboard-core';

function currentScheme(): ColorScheme {
  if (typeof document === 'undefined') return 'light';
  const pinned = document.documentElement.dataset.theme;
  if (pinned === 'light' || pinned === 'dark') return pinned;
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export interface ThemeState {
  scheme: ColorScheme;
}

export const useTheme = create<ThemeState>()(() => ({ scheme: currentScheme() }));

/** Starts following the system scheme and `data-theme`; returns a stop function. */
export function followColorScheme(): () => void {
  const update = (): void => {
    const scheme = currentScheme();
    if (useTheme.getState().scheme !== scheme) useTheme.setState({ scheme });
  };
  const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  media?.addEventListener('change', update);
  const observer = new MutationObserver(update);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  update();
  return () => {
    media?.removeEventListener('change', update);
    observer.disconnect();
  };
}

/** The current scheme (React). */
export function useColorScheme(): ColorScheme {
  return useTheme((state) => state.scheme);
}
