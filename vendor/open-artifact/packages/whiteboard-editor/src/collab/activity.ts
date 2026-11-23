/**
 * The agent's activity as the board shows it: what it is doing ("Writing",
 * "Connecting", from the kind of element it just wrote), spoken to screen
 * readers ("The agent is writing on the board."), and new elements fading
 * in one after another rather than popping in at once.
 *
 * An element counts as the agent's new one when the agent wrote its
 * document and it appeared on the board at about the same time; the two
 * signals may come in either order, so each is remembered briefly.
 */

import { create } from 'zustand';
import { ELEMENT_TYPES, type ElementType } from '@open-artifact/whiteboard-core';
import { useAgent } from '../services/agent.ts';
import { maybeSession } from '../services/session.ts';
import { useBoard } from '../state/board.ts';
import { announce } from './announce.ts';
import { APPEAR_DURATION_MS, activityAnnouncement, appearDelays, elementActivity } from './activity-labels.ts';

/** Least time between two spoken activity lines (ms). */
const ANNOUNCE_GAP_MS = 4000;

/** How long one signal waits for the other (ms). */
const MATCH_WINDOW_MS = 2000;

/** Element ids as stored (also safe inside an attribute selector). */
const SAFE_ID = /^[A-Za-z0-9_.~:@+-]{1,64}$/;

const KNOWN_TYPES: ReadonlySet<string> = new Set(ELEMENT_TYPES);

interface ActivityState {
  /** What the agent is doing now ("Writing"), while it works. */
  label: string | null;
  /** When the label last changed (epoch ms). */
  at: number;
}

/** What the agent is doing on the board. */
export const useAgentActivity = create<ActivityState>()(() => ({ label: null, at: 0 }));

/** The elements a change wrote (not deleted): `[id, type]` pairs in the order written. */
export function writtenElements(changes: Readonly<Record<string, unknown>>): Array<[string, ElementType]> {
  const written: Array<[string, ElementType]> = [];
  for (const [path, data] of Object.entries(changes)) {
    const id = /^elements\/([^/]+)$/.exec(path)?.[1];
    if (id === undefined || !SAFE_ID.test(id) || typeof data !== 'object' || data === null) continue;
    const type = (data as { type?: unknown }).type;
    if (typeof type === 'string' && KNOWN_TYPES.has(type)) written.push([id, type as ElementType]);
  }
  return written;
}

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Fades the given elements in, one after another. */
function playEntrance(ids: readonly string[]): void {
  if (reducedMotion() || typeof document === 'undefined') return;
  const delays = appearDelays(ids.length);
  ids.forEach((id, index) => {
    const delay = delays[index];
    if (delay === undefined) return;
    const element = document.querySelector<HTMLElement>(`[data-wb-id="${id}"]`);
    element?.animate(
      [
        { opacity: 0, scale: '0.96' },
        { opacity: 1, scale: '1' },
      ],
      { duration: APPEAR_DURATION_MS, delay, easing: 'cubic-bezier(0.2, 0, 0, 1)', fill: 'backwards' },
    );
  });
}

/** Starts following the agent's writes; returns a function that stops. */
export function startActivity(): () => void {
  const db = maybeSession()?.db;
  if (!db) return () => {};
  let lastSpoken = 0;
  /** Ids the agent wrote, with their type, in write order. */
  const wrote = new Map<string, { type: ElementType; at: number }>();
  /** Ids that appeared on the board. */
  const appeared = new Map<string, number>();
  let scheduled = false;

  const match = (): void => {
    scheduled = false;
    const now = Date.now();
    for (const [id, entry] of wrote) if (now - entry.at > MATCH_WINDOW_MS) wrote.delete(id);
    for (const [id, at] of appeared) if (now - at > MATCH_WINDOW_MS) appeared.delete(id);
    const created: Array<[string, ElementType]> = [];
    for (const [id, entry] of wrote) {
      if (!appeared.has(id)) continue;
      created.push([id, entry.type]);
      wrote.delete(id);
      appeared.delete(id);
    }
    if (created.length === 0) return;
    const label = elementActivity(created[created.length - 1]![1]);
    if (label) {
      if (label !== useAgentActivity.getState().label) useAgentActivity.setState({ label, at: now });
      if (now - lastSpoken >= ANNOUNCE_GAP_MS) {
        lastSpoken = now;
        announce(activityAnnouncement(label));
      }
    }
    // Let React draw the new elements before animating them.
    const ids = created.map(([id]) => id);
    requestAnimationFrame(() => playEntrance(ids));
  };
  const schedule = (): void => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(match);
  };

  const offDb = db.onChange((event) => {
    if (event.author !== 'agent') return;
    const now = Date.now();
    for (const [id, type] of writtenElements(event.changes)) if (!wrote.has(id)) wrote.set(id, { type, at: now });
    schedule();
  });
  const offBoard = useBoard.subscribe((state, previous) => {
    if (state.byId === previous.byId || previous.status !== 'ready') return;
    const now = Date.now();
    for (const id of state.byId.keys()) if (!previous.byId.has(id)) appeared.set(id, now);
    if (appeared.size > 0) schedule();
  });
  const offAgent = useAgent.subscribe((state, previous) => {
    if (previous.busy && !state.busy) useAgentActivity.setState({ label: null, at: Date.now() });
  });
  return () => {
    offDb();
    offBoard();
    offAgent();
    wrote.clear();
    appeared.clear();
  };
}
