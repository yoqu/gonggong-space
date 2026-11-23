/**
 * Collaboration and the agent on the board: presence (cursors, selections,
 * cursor chat, following, live gestures), the view context the agent reads, requests to
 * the agent and their status, the agent's claims and activity, comments,
 * ideas and the empty board's guidance.
 *
 * {@link startCollab} starts every service once the session (and the
 * Shell bridge) has started; the three components draw it:
 * {@link CollabBoardLayer} in board units inside the camera layer,
 * {@link CollabOverlay} in screen units inside the board's overlay, and
 * {@link CollabChrome} for the panels.
 */

import { startActivity } from './activity.ts';
import { startAreaPick } from './area-pick.ts';
import { startAskKeys } from './AskPanel.tsx';
import { startAsks } from './asks.ts';
import { startClaims } from './claims.ts';
import { startPeerColors } from './colors.ts';
import { startComments } from './comments.ts';
import { startCursorChat } from './cursor-chat.ts';
import { startFollow } from './follow.ts';
import { startIdeas } from './ideas.ts';
import { startLiveGestures } from './live-gestures.ts';
import { startMovingWatch } from './moving.ts';
import { startPresence } from './presence.ts';
import { startUploads } from './uploads.ts';
import { startViewContext } from './publish-context.ts';

export { CollabBoardLayer } from './CollabBoardLayer.tsx';
export { CollabChrome } from './CollabChrome.tsx';
export { CollabOverlay } from './CollabOverlay.tsx';
export { UploadPlaceholders } from './UploadPlaceholders.tsx';
export { useAgentActivity } from './activity.ts';
export { useAreaPick } from './area-pick.ts';
export { askAgent, useAsks, type AskTarget, type AskVia, type LocalAsk } from './asks.ts';
export { useClaims } from './claims.ts';
export { useComments } from './comments.ts';
export { useCursorChat } from './cursor-chat.ts';
export { useIdea } from './ideas.ts';
export { usePeerGestures, type PeerHand } from './live-gestures.ts';
export { useMoving } from './moving.ts';
export { useCollabPeers, type CollabPeer } from './peers.ts';
export { currentViewContext, flushViewContext } from './publish-context.ts';
export type { BoardViewContext } from './view-context.ts';

/**
 * Starts collaboration: call after the session (and `startShell()`) has
 * started. Every part is a no-op where its capability is missing (no room,
 * no comments, no agent). Returns a function that stops everything.
 */
export function startCollab(): () => void {
  const stops = [
    startPresence(),
    startPeerColors(),
    startLiveGestures(),
    startUploads(),
    startMovingWatch(),
    startAsks(),
    startViewContext(),
    startClaims(),
    startComments(),
    startFollow(),
    startCursorChat(),
    startAreaPick(),
    startAskKeys(),
    startIdeas(),
    startActivity(),
  ];
  return () => {
    for (const stop of stops.reverse()) stop();
  };
}
