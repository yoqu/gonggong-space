/**
 * Live presence for any editor, over the `room` capability: who else has
 * the artifact open, where their pointer is and what the editor says they
 * are doing (selection, page, editing); and the agent, shown for a few
 * seconds after it writes.
 *
 * Editor-agnostic: the editor's
 * {@link PresenceAdapter} says what it publishes under its key and reads
 * peers' values back. Peers' values were written by their browsers: the
 * adapter's `parse` must check and clip them.
 */

import type { ArtifactCapability, Peer, RoomCapability } from '@open-artifact/runtime';
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { Point } from './pins.ts';

/** Peer colors (cursor, outline, avatar). */
export const PEER_COLORS = ['#e5484d', '#0091ff', '#30a46c', '#f76b15', '#8e4ec6', '#d6409f', '#12a594', '#ad7f58'];

/** The agent's color. */
export const AGENT_COLOR = '#6e56cf';

/** How long the agent shows after it wrote (ms). */
export const AGENT_SHOWN_MS = 8000;

/** Pointer updates go out at most this often (ms). */
const SEND_MS = 80;

/** Most entries kept of any list read from a peer. */
export const PRESENCE_LIST_MAX = 50;

/** A stable color for a peer id. */
export function peerColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return PEER_COLORS[Math.abs(hash) % PEER_COLORS.length]!;
}

/** Checked readers for peers' values. */
export const peerValue = {
  str: (value: unknown, max = 512): string | null => (typeof value === 'string' && value.length <= max ? value : null),
  num: (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null),
  strList: (value: unknown, max = PRESENCE_LIST_MAX): string[] =>
    Array.isArray(value) ? value.map((v) => peerValue.str(v)).filter((v): v is string => v !== null).slice(0, max) : [],
  point: (value: unknown): Point | null => {
    if (!value || typeof value !== 'object') return null;
    const v = value as Record<string, unknown>;
    const x = peerValue.num(v.x);
    const y = peerValue.num(v.y);
    return x !== null && y !== null ? { x, y } : null;
  },
};

/** A peer as an editor draws it. */
export interface PeerView<S> {
  id: string;
  name: string;
  kind: 'person' | 'agent';
  color: string;
  /** Pointer on the surface (world px), `null` when it is elsewhere. */
  cursor: Point | null;
  /** The editor's own state of this peer, `null` when it published none (or it was malformed). */
  state: S | null;
}

/**
 * What an editor tells presence. `S` is what it publishes besides the pointer.
 * The pointer goes out as `cursor` beside `S` (only when the editor gives
 * {@link PresenceAdapter.pointer}).
 */
export interface PresenceAdapter<S extends object> {
  /** The presence key (one per editor type, e.g. `design`, `slides`). */
  key: string;
  /** This page's state now. */
  snapshot(): S;
  /** Reads a peer's value of {@link key} (already an object); `null` when unusable. */
  parse(value: Record<string, unknown>): S | null;
  /** Calls `changed` whenever {@link snapshot} may have changed; returns an unsubscribe. */
  watch(changed: () => void): () => void;
  /**
   * The world point of a pointer event over the editor's surface; `null` when
   * it is elsewhere. Omitted: the editor shares no pointer, nothing listens
   * for one and the value goes out as {@link snapshot} alone (no `cursor`).
   */
  pointer?(event: PointerEvent): Point | null;
  /** Least time between two sends of this page's value, ms (default 80). */
  sendMs?: number;
  /** Hears the room's peers (raw, this page included) after the store took them; `self` is this page's peer id. */
  onPeers?(peers: readonly Peer[], self: string | null): void;
  /** Maps a changed artifact path to what the editor tracks (a project path), or `null` to ignore it. */
  wrotePath?(path: string): string | null;
}

/** The presence store. */
export interface PresenceState<S> {
  available: boolean;
  peers: PeerView<S>[];
  /** The agent wrote these paths recently (as `wrotePath` mapped them); `null` when it has not. */
  agentWrote: { at: number; paths: string[] } | null;
}

/** Peers other than this page, as drawn (people first, then agents). */
export function peerViews<S>(peers: readonly Peer[], self: string | null, key: string, parse: (value: Record<string, unknown>) => S | null): PeerView<S>[] {
  return peers
    .filter((p) => p.id !== self)
    .map((p) => {
      const raw = p.state?.[key];
      const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
      return {
        id: p.id,
        name: (p.name || (p.kind === 'agent' ? 'Agent' : 'Guest')).slice(0, 60),
        kind: p.kind,
        color: p.kind === 'agent' ? AGENT_COLOR : peerColor(p.id),
        cursor: value ? peerValue.point(value.cursor) : null,
        state: value ? parse(value) : null,
      };
    })
    .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'person' ? -1 : 1));
}

/** One editor's presence. */
export interface PresenceController<S> {
  readonly store: UseBoundStore<StoreApi<PresenceState<S>>>;
  /** Starts publishing and listening; returns a function that stops it. */
  start(input: { room: RoomCapability | null; artifact?: Pick<ArtifactCapability, 'onChange'> | null }): Promise<() => void>;
}

/** Creates an editor's presence. */
export function createPresence<S extends object>(adapter: PresenceAdapter<S>): PresenceController<S> {
  const store = create<PresenceState<S>>()(() => ({ available: false, peers: [], agentWrote: null }));

  async function start({ room, artifact }: { room: RoomCapability | null; artifact?: Pick<ArtifactCapability, 'onChange'> | null }): Promise<() => void> {
    const stops: (() => void)[] = [];

    // The agent's writes, whether or not there is a room.
    let agentTimer: ReturnType<typeof setTimeout> | null = null;
    if (artifact) {
      stops.push(
        artifact.onChange((event) => {
          if (event.author !== 'agent') return;
          const paths = Object.keys(event.changes)
            .map((path) => (adapter.wrotePath ? adapter.wrotePath(path) : path))
            .filter((p): p is string => p !== null);
          const previous = store.getState().agentWrote;
          const recent = previous && Date.now() - previous.at < AGENT_SHOWN_MS ? previous.paths : [];
          store.setState({ agentWrote: { at: Date.now(), paths: [...new Set([...recent, ...paths])].slice(0, PRESENCE_LIST_MAX) } });
          if (agentTimer) clearTimeout(agentTimer);
          agentTimer = setTimeout(() => store.setState({ agentWrote: null }), AGENT_SHOWN_MS);
        }),
      );
      stops.push(() => {
        if (agentTimer) clearTimeout(agentTimer);
      });
    }

    if (!room) return () => stops.forEach((stop) => stop());
    store.setState({ available: true });
    const self = await room.self().catch(() => null);

    // This page's key: its state at once, then throttled (the pointer too).
    const pointer = adapter.pointer?.bind(adapter);
    const sendMs = adapter.sendMs ?? SEND_MS;
    let cursor: Point | null = null;
    let last = '';
    let timer: ReturnType<typeof setTimeout> | null = null;
    const send = (): void => {
      timer = null;
      const value = pointer ? { ...adapter.snapshot(), cursor } : adapter.snapshot();
      const text = JSON.stringify(value);
      if (text === last) return;
      last = text;
      room.presence({ [adapter.key]: value }).catch(() => undefined);
    };
    const schedule = (): void => {
      if (!timer) timer = setTimeout(send, sendMs);
    };
    send();
    stops.push(adapter.watch(schedule));
    const onMove = (event: PointerEvent): void => {
      const world = pointer?.(event) ?? null;
      if (!world) {
        if (cursor) {
          cursor = null;
          schedule();
        }
        return;
      }
      cursor = { x: Math.round(world.x), y: Math.round(world.y) };
      schedule();
    };
    const onLeave = (): void => {
      cursor = null;
      schedule();
    };
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') onLeave();
    };
    if (pointer) {
      window.addEventListener('pointermove', onMove, { passive: true });
      document.addEventListener('pointerleave', onLeave);
      document.addEventListener('visibilitychange', onVisibility);
    }
    stops.push(() => {
      if (pointer) {
        window.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerleave', onLeave);
        document.removeEventListener('visibilitychange', onVisibility);
      }
      if (timer) clearTimeout(timer);
      room.presence({ [adapter.key]: null }).catch(() => undefined);
    });

    // The peer list.
    const heard = (peers: Peer[]): void => {
      store.setState({ peers: peerViews(peers, self, adapter.key, adapter.parse) });
      adapter.onPeers?.(peers, self);
    };
    room.peers().then(heard, () => undefined);
    stops.push(room.onPeers(heard));

    return () => stops.forEach((stop) => stop());
  }

  return { store, start };
}
