/**
 * Where a request to the agent stands, as this page tracks it.
 *
 * A request is sent (`sending`), then the host either hands it to the agent
 * (`delivered`) or keeps it for later (`queued`). Once the agent claims
 * ground on the board with the request's claim key, the request is
 * `working`; when the agent deletes that claim it is `done`. A claim that
 * expires because the agent never deleted it ends the request as `stopped`,
 * and a request the host could not take is `failed`.
 *
 * Pure: no stores, no DOM, so the transitions are unit-tested.
 */

import type { AgentSendResult } from '@open-artifact/runtime';

/** Where a request stands. */
export type AskStatus = 'sending' | 'queued' | 'delivered' | 'working' | 'done' | 'stopped' | 'failed';

/** Every status, in the order a request moves through them. */
export const ASK_STATUSES: readonly AskStatus[] = ['sending', 'queued', 'delivered', 'working', 'done', 'stopped', 'failed'];

/** Short labels shown on the board next to a request. */
export const ASK_STATUS_LABELS: Readonly<Record<AskStatus, string>> = {
  sending: 'Sending…',
  queued: 'Queued',
  delivered: 'Sent',
  working: 'Working…',
  done: 'Done',
  stopped: 'Stopped',
  failed: 'Could not send',
};

/** The label of a request's status; a queued one says it waits for the next turn when the agent is not woken while it idles. */
export function askStatusLabel(status: AskStatus, wakesIdle?: boolean): string {
  return status === 'queued' && wakesIdle === false ? 'Queued for its next turn' : ASK_STATUS_LABELS[status];
}

/** How long a finished request stays drawn before it fades (ms). */
export const ASK_LINGER_MS = 3000;

/** How long a request's area takes to fade in or out (ms). */
export const ASK_FADE_MS = 420;

/** Most characters of a typed request. */
export const MAX_ASK_TEXT = 20_000;

/** Most characters of a request's words shared with other viewers. */
export const MAX_SHARED_ASK_TEXT = 120;

/** How often pending requests are published again to other viewers (ms). */
export const SHARED_ASK_REBROADCAST_MS = 25_000;

/** True once a request will not change any more. */
export function isAskSettled(status: AskStatus): boolean {
  return status === 'done' || status === 'stopped' || status === 'failed';
}

/** True while a request waits for, or is being worked on by, the agent. */
export function isAskPending(status: AskStatus): boolean {
  return !isAskSettled(status);
}

/** The status right after the host answered a send. */
export function askStatusAfterSend(result: Pick<AgentSendResult, 'status'>): AskStatus {
  switch (result.status) {
    case 'delivered':
      return 'delivered';
    case 'queued':
    case 'staged':
      return 'queued';
    default:
      return 'failed';
  }
}

/**
 * The status after the board's claims changed.
 *
 * @param status - The request's current status.
 * @param claimed - The board holds a claim with the request's key.
 * @param expired - The claim with the request's key was just dropped by expiry
 *   (nobody rewrote it for too long) rather than deleted by the agent.
 */
export function askStatusAfterClaims(status: AskStatus, claimed: boolean, expired = false): AskStatus {
  if (isAskSettled(status)) return status;
  if (claimed) return 'working';
  if (status === 'working') return expired ? 'stopped' : 'done';
  return status;
}

/**
 * The status after the agent went idle. A request it had in hand but never
 * claimed ground for (it answered in the conversation instead) is done.
 */
export function askStatusAfterIdle(status: AskStatus, claimed: boolean): AskStatus {
  if (claimed || isAskSettled(status)) return status;
  return status === 'delivered' || status === 'working' ? 'done' : status;
}
