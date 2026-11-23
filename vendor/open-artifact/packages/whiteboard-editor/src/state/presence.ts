/**
 * Who else is on the board (from the room capability) and whom this tab
 * follows. Each peer publishes its camera, pointer and selection through
 * room presence; the collaboration service keeps this store current.
 */

import { create } from 'zustand';
import type { Camera, Point } from '../lib/camera.ts';

/** What a page publishes about itself. */
export interface PeerPresence {
  /** Where it looks (board coordinates). */
  camera?: Camera;
  /** Viewport size, to follow it faithfully. */
  viewport?: { w: number; h: number };
  /** Pointer in board coordinates, or absent when off the board. */
  pointer?: Point;
  /** Selected element ids. */
  selection?: string[];
  /** Cursor chat text being typed. */
  chat?: string;
  /** This peer asks everyone to follow it. */
  leading?: boolean;
}

/** Another viewer (or the agent) on the board. */
export interface BoardPeer {
  id: string;
  name: string;
  kind: 'person' | 'agent';
  presence: PeerPresence;
}

export interface PresenceState {
  /** Everyone else, by peer id. */
  peers: ReadonlyMap<string, BoardPeer>;
  /** The peer this tab follows (its camera drives ours). */
  following: string | null;
  /** This tab asks everyone to follow it. */
  leading: boolean;
  setPeers(peers: ReadonlyMap<string, BoardPeer>): void;
  follow(peerId: string | null): void;
  setLeading(on: boolean): void;
}

export const usePresence = create<PresenceState>()((set) => ({
  peers: new Map(),
  following: null,
  leading: false,
  setPeers(peers) {
    set((state) => ({ peers, following: state.following !== null && !peers.has(state.following) ? null : state.following }));
  },
  follow(peerId) {
    set({ following: peerId, ...(peerId !== null ? { leading: false } : {}) });
  },
  setLeading(on) {
    set({ leading: on, ...(on ? { following: null } : {}) });
  },
}));
