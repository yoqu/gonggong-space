/**
 * The agent's claims on the board: where it is working right now.
 *
 * The agent writes `content.claimed` (one entry per request, keyed by the
 * claim key the asker's view context offered) while it works and removes
 * it when done. The board frames each claim in the asker's color with what
 * the agent is doing, so everyone sees where not to edit.
 *
 * This module keeps the track (`claim-frames.ts` holds the rules): it
 * hears the board after every change (telling remote changes after load
 * apart, as only those frame claims and grow them), settles idle and
 * expired claims on a timer, and, on an editor's page with a claim of its
 * own, drops that claim {@link OUTSIDE_CLAIM_BESIDE_MS} after the agent
 * stops working (an agent that lost its connection never removes it).
 */

import { create } from 'zustand';
import { OUTSIDE_CLAIM_BESIDE_MS, WORKING_QUIET_MS, withClaimed } from '@open-artifact/whiteboard-core';
import { useAgent } from '../services/agent.ts';
import { maybeSession } from '../services/session.ts';
import { changeBoard, onRemoteChange, useBoard } from '../state/board.ts';
import { useMeasures } from '../state/measures.ts';
import { noteExpiredClaims, useAsks } from './asks.ts';
import { EMPTY_CLAIM_TRACK, besideDrops, hearClaims, markBeside, nextClaimDue, settleClaims, type ClaimTrack } from './claim-frames.ts';

export { AGENT_COLOR, claimFrame, claimOwner, isClaimIdle, trackedClaimFrame, type ClaimOwner, type ClaimTrack, type TrackedClaim } from './claim-frames.ts';

interface ClaimsState {
  /** The shared claims as this page tracks them. */
  track: ClaimTrack;
}

/** The tracked claims (which are framed, what joined them). */
export const useClaims = create<ClaimsState>()(() => ({ track: EMPTY_CLAIM_TRACK }));

/** What the agent is doing for this page, as far as it can tell. */
type AgentActivity = 'working' | 'idle' | 'unknown';

/** The agent's activity; unknown while the page is hidden or the agent out of reach. */
function agentActivity(): AgentActivity {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return 'unknown';
  const { available, busy } = useAgent.getState();
  return !available ? 'unknown' : busy ? 'working' : 'idle';
}

/**
 * Drops claims from the board (editors only). Expired ones note their
 * requests as stopped; this page's own claims, dropped once the agent is
 * done, do not.
 */
function dropClaims(keys: readonly string[], expired: boolean): void {
  if (keys.length === 0) return;
  if (expired) noteExpiredClaims(keys);
  const gone = new Set(keys);
  changeBoard(
    (board) => {
      const claimed = board.content.claimed ?? [];
      const kept = claimed.filter((claim) => !gone.has(claim.key));
      return kept.length === claimed.length ? board : { ...board, content: withClaimed(board.content, kept) };
    },
    { history: false },
  );
}

/** Starts tracking claims; returns a function that stops. */
export function startClaims(): () => void {
  const canEdit = maybeSession()?.canEdit ?? false;
  let stopped = false;
  let lastElements = useBoard.getState().board.content.elements;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  let besideTimer: ReturnType<typeof setTimeout> | undefined;
  let stopWatching: (() => void) | undefined;
  let activity: AgentActivity = 'unknown';
  /** When the agent last stopped working for this page (epoch ms). */
  let stoppedAt = -Infinity;

  const own = (key: string): boolean => {
    const { asks, tabKey } = useAsks.getState();
    return asks.has(key) || key === tabKey;
  };

  const settle = (): void => {
    settleTimer = undefined;
    const { elements } = useBoard.getState().board.content;
    const { track, expired } = settleClaims(useClaims.getState().track, Date.now(), canEdit, elements, useMeasures.getState().measures);
    update(track);
    if (canEdit) dropClaims(expired, true);
  };

  const besideDue = (): void => {
    besideTimer = undefined;
    const { track, drops } = besideDrops(useClaims.getState().track, stoppedAt);
    update(track);
    dropClaims(drops, false);
  };

  // While this page has a claim of its own (editors only), watch the agent stop working.
  const onActivity = (): void => {
    const previous = activity;
    activity = agentActivity();
    if (besideTimer !== undefined) clearTimeout(besideTimer);
    besideTimer = undefined;
    if (activity === 'unknown') return;
    if (activity === 'working') {
      update(markBeside(useClaims.getState().track));
      return;
    }
    if (previous === 'working') stoppedAt = Date.now();
    else if (![...useClaims.getState().track.claims.values()].some((tracked) => tracked.own && tracked.beside)) return;
    besideTimer = setTimeout(besideDue, OUTSIDE_CLAIM_BESIDE_MS);
  };
  const watch = (): void => {
    const want = canEdit && !stopped && [...useClaims.getState().track.claims.values()].some((tracked) => tracked.own);
    if (want && stopWatching === undefined) {
      const changed = (): void => {
        if (agentActivity() !== activity) onActivity();
      };
      const offAgent = useAgent.subscribe(changed);
      document.addEventListener('visibilitychange', changed);
      stopWatching = () => {
        offAgent();
        document.removeEventListener('visibilitychange', changed);
      };
      onActivity();
    } else if (!want && stopWatching !== undefined) {
      stopWatching();
      stopWatching = undefined;
      activity = 'unknown';
      if (besideTimer !== undefined) clearTimeout(besideTimer);
      besideTimer = undefined;
    }
  };

  /** Stores the track, then re-times the settle and the activity watch. */
  function update(track: ClaimTrack): void {
    if (stopped) return;
    if (track !== useClaims.getState().track) useClaims.setState({ track });
    if (settleTimer !== undefined) clearTimeout(settleTimer);
    const due = nextClaimDue(track, canEdit);
    settleTimer = due === undefined ? undefined : setTimeout(settle, Math.max(0, due - Date.now()) + 1);
    watch();
  }

  const hear = (changed: boolean): void => {
    const { elements, claimed } = useBoard.getState().board.content;
    const previous = lastElements;
    lastElements = elements;
    const now = Date.now();
    const working = agentActivity() === 'working' || now - stoppedAt <= WORKING_QUIET_MS;
    update(hearClaims(useClaims.getState().track, { claimed, elements, previous, changed, now, measures: useMeasures.getState().measures, own, working }));
  };

  // Hear once per change, after the sync engine said whether it was remote.
  let pending = false;
  let remote = false;
  let wasReady = false;
  const flush = (): void => {
    pending = false;
    // Only a loaded board counts: claims in a stale snapshot are neither framed nor swept.
    if (!stopped && useBoard.getState().status === 'ready') hear(remote && wasReady);
  };
  const offBoard = useBoard.subscribe((state, previous) => {
    if (state.board.content === previous.board.content && state.status === previous.status) return;
    if (pending) return;
    [pending, remote, wasReady] = [true, false, previous.status === 'ready'];
    queueMicrotask(flush);
  });
  const offRemote = onRemoteChange(() => {
    remote = true;
  });
  if (useBoard.getState().status === 'ready') hear(false);

  return () => {
    stopped = true;
    offBoard();
    offRemote();
    stopWatching?.();
    stopWatching = undefined;
    if (settleTimer !== undefined) clearTimeout(settleTimer);
    if (besideTimer !== undefined) clearTimeout(besideTimer);
    useClaims.setState({ track: EMPTY_CLAIM_TRACK });
  };
}
