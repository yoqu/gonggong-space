/**
 * A rebuild replaces the editor's files while a page running the old ones stays open. The old page's parts that load
 * on demand (the video exporter, Flash, the GIF jobs) are then gone from the server, and only a reload brings the new
 * ones, so the first part that fails to load says so once, over the player, with a Reload button.
 */

import { create } from 'zustand';
import { useUi } from '../stores/ui.ts';
import { EDITOR_UPDATED, RELOAD } from './words.ts';

export const STALE_BUILD_NOTICE_ID = 'stale-build';

/** The errors a part that failed to load threw, so an export that hits one can tell it from its own failures. */
const failures = new WeakSet<object>();

export const useStaleBuild = create<{ stale: boolean }>()(() => ({ stale: false }));

export function reloadPage(): void {
  location.reload();
}

export function isStaleBuildError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && failures.has(error);
}

/** Vite fires `vite:preloadError` on the window when a part loaded on demand cannot be fetched, then rethrows the error. */
export function watchStaleBuild(target: Window): () => void {
  const onPreloadError = (event: Event): void => {
    const payload: unknown = Reflect.get(event, 'payload');
    if (typeof payload === 'object' && payload !== null) failures.add(payload);
    if (useStaleBuild.getState().stale) return;
    useStaleBuild.setState({ stale: true });
    useUi.getState().addNotice({ id: STALE_BUILD_NOTICE_ID, tone: 'warning', text: EDITOR_UPDATED, action: { label: RELOAD, run: reloadPage } });
  };
  target.addEventListener('vite:preloadError', onPreloadError);
  return () => target.removeEventListener('vite:preloadError', onPreloadError);
}
