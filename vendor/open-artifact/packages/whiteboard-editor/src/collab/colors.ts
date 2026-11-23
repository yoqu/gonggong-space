/**
 * This page's color among the people online: a {@link createPeerColorKeeper}
 * fed by the parsed peers, publishing the `color` presence key, so cursors,
 * selections and claim frames of people on the board at once do not share a
 * color. The color settled on is kept in local storage, so a person comes
 * back in the color they wore. Without a room the page wears the color its
 * person's id hashes to (or the kept one).
 */

import { create } from 'zustand';
import { PEER_COLOR_TIMERS, createPeerColorKeeper, keptPeerColor, leastUsedPeerColor, normalizePeerColor, peerColorFromId } from '@open-artifact/editor-kit';
import { maybeSession } from '../services/session.ts';
import { peerColorClaims, useCollabPeers } from './peers.ts';
import { publishPresence } from './presence.ts';

/** The color this person last settled on, kept in local storage. */
const kept = keptPeerColor('whiteboard.peer-color');

/** The color this page wears without others to avoid: the kept one, else its person's id's. */
function aloneColor(id: string): string {
  return leastUsedPeerColor(normalizePeerColor(kept.read()) ?? peerColorFromId(id), []);
}

interface OwnColorState {
  /** The color this page wears. */
  color: string;
}

/** This page's color. */
export const useOwnColor = create<OwnColorState>()(() => ({ color: aloneColor(maybeSession()?.viewer.id ?? 'viewer') }));

/**
 * Starts keeping this page's color: call after presence started (it
 * publishes through it). Returns a function that stops.
 */
export function startPeerColors(): () => void {
  const session = maybeSession();
  const id = session?.viewer.id ?? 'viewer';
  if (!session?.room) {
    useOwnColor.setState({ color: aloneColor(id) });
    return () => {};
  }
  const keeper = createPeerColorKeeper(
    {
      id,
      peer: session.peerId,
      publish: (claim) => publishPresence({ color: claim }),
      claims: () => peerColorClaims(useCollabPeers.getState().peers.values(), id),
      kept,
      ...PEER_COLOR_TIMERS,
    },
    () => useOwnColor.setState({ color: keeper.worn() }),
  );
  useOwnColor.setState({ color: keeper.worn() });
  const offPeers = useCollabPeers.subscribe((state, previous) => {
    if (state.peers !== previous.peers) keeper.heard();
  });
  const onVisibility = (): void => (document.visibilityState === 'hidden' ? keeper.away() : keeper.here());
  document.addEventListener('visibilitychange', onVisibility);
  onVisibility();
  return () => {
    offPeers();
    document.removeEventListener('visibilitychange', onVisibility);
    keeper.dispose();
  };
}
