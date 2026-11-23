/**
 * Connects the page: the colour scheme, the session, the Shell, the agent's status and live sync. When the store
 * cannot be reached the page still renders, empty, saying why.
 */

import { startSession, type Session } from './session.ts';
import { startShell } from './shell.ts';
import { watchAgentActivity } from './agent-activity.ts';
import { startLiveFilm } from './live-film.ts';
import { useWorking } from '../stores/working.ts';
import { readOnlyReasonFor } from './view-only.ts';
import { LIVE_SYNC_UNAVAILABLE } from './words.ts';

/** Mirrors a pinned `data-theme` on `<html>` into `data-mode` for the page's own styles. */
export function followColorScheme(doc: Document = document): () => void {
  const root = doc.documentElement;
  const sync = (): void => {
    const theme = root.getAttribute('data-theme');
    if (theme === 'light' || theme === 'dark') root.setAttribute('data-mode', theme);
    else root.removeAttribute('data-mode');
  };
  sync();
  const observer = new MutationObserver(sync);
  observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}

function showUnavailable(reason: string): void {
  useWorking.setState({ sync: 'unavailable', readOnlyReason: reason, canAsk: false });
}

/** Resolves (never rejects) once live sync runs or the fallback shows; the session, when there is one. */
export async function startVideoPage(): Promise<{ stop: () => void; session: Session | null }> {
  const stops: (() => void)[] = [followColorScheme()];
  const stop = (): void => {
    for (const each of stops.reverse()) each();
    stops.length = 0;
  };
  let connected: Session;
  try {
    connected = await startSession();
  } catch (error) {
    console.warn('video: live sync unavailable in this view', error);
    showUnavailable(error instanceof Error && error.message !== '' ? error.message : LIVE_SYNC_UNAVAILABLE);
    return { stop, session: null };
  }
  useWorking.setState({ canAsk: connected.canAsk && connected.agent !== null, readOnlyReason: readOnlyReasonFor(connected.inline, connected.canEdit) });
  stops.push(startShell());
  stops.push(watchAgentActivity(connected.agent));
  try {
    stops.push(startLiveFilm());
  } catch (error) {
    console.error('video (live store): boot failed', error);
    showUnavailable(LIVE_SYNC_UNAVAILABLE);
  }
  return { stop, session: connected };
}
