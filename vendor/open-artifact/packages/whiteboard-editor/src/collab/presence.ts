/**
 * Live presence over the room capability: publishes where this viewer
 * looks, points and selects, and keeps the peer stores current.
 *
 * Other collaboration modules publish their own keys (cursor chat, follow
 * me, shared requests, the view context) through {@link publishPresence},
 * so every key shares one throttled sender.
 */

import { followViewArea } from '@open-artifact/whiteboard-core';
import type { Peer } from '@open-artifact/runtime';
import { screenToBoard, type Point } from '../lib/camera.ts';
import { maybeSession } from '../services/session.ts';
import { useCamera } from '../state/camera.ts';
import { usePresence } from '../state/presence.ts';
import { useSelection } from '../state/selection.ts';
import { MAX_PEER_SELECTION, parsePeers, toBoardPeer, useCollabPeers } from './peers.ts';
import { createPresenceSender, type PresencePatch, type PresenceSender } from './presence-sender.ts';

let sender: PresenceSender | null = null;

/** Publishes presence keys (merged, throttled); a no-op without a room. */
export function publishPresence(patch: PresencePatch): void {
  sender?.send(patch);
}

/** Sends waiting presence keys at once (before a request reaches the agent). */
export function flushPresence(): void {
  sender?.flush();
}

/** True when this page shares a live room with others. */
export function hasRoom(): boolean {
  return Boolean(maybeSession()?.room);
}

function roundPoint(point: Point): Point {
  return { x: Math.round(point.x * 10) / 10, y: Math.round(point.y * 10) / 10 };
}

/** The keys describing where this page looks. */
function viewKeys(): PresencePatch {
  const { camera, width, height, insets } = useCamera.getState();
  return {
    camera: { x: Math.round(camera.x * 10) / 10, y: Math.round(camera.y * 10) / 10, zoom: Math.round(camera.zoom * 1000) / 1000 },
    viewport: { w: Math.round(width), h: Math.round(height) },
    view: followViewArea(camera, { w: width, h: height, top: insets.top, bottom: insets.bottom }),
  };
}

/** The board point under this viewer's pointer, if any. */
export function pointerOnBoard(): Point | null {
  const { pointer, camera } = useCamera.getState();
  return pointer ? screenToBoard(camera, pointer) : null;
}

/**
 * Starts presence: publishes this page's keys and follows the peer list.
 * Returns a function that stops (and clears this page's cursor).
 */
export function startPresence(): () => void {
  const session = maybeSession();
  const room = session?.room;
  if (!session || !room) return () => {};
  const own = createPresenceSender((patch) => room.presence(patch));
  sender = own;

  // This page's keys.
  own.send({ user: session.viewer.id, ...viewKeys(), selection: useSelection.getState().ids.slice(0, MAX_PEER_SELECTION), pointer: null });
  let lastPointer: string | null = null;
  const sendPointer = (): void => {
    const point = pointerOnBoard();
    const value = point ? roundPoint(point) : null;
    const key = JSON.stringify(value);
    if (key === lastPointer) return;
    lastPointer = key;
    own.send({ pointer: value });
  };
  const offCamera = useCamera.subscribe((state, previous) => {
    if (state.camera !== previous.camera || state.width !== previous.width || state.height !== previous.height || state.insets !== previous.insets) own.send(viewKeys());
    if (state.pointer !== previous.pointer || state.camera !== previous.camera) sendPointer();
  });
  const offSelection = useSelection.subscribe((state, previous) => {
    if (state.ids !== previous.ids) own.send({ selection: state.ids.slice(0, MAX_PEER_SELECTION) });
  });

  // The peer list.
  let stopped = false;
  const heard = (peers: readonly Peer[]): void => {
    if (stopped) return;
    const parsed = parsePeers(peers, session.peerId, Date.now(), useCollabPeers.getState().peers);
    useCollabPeers.setState({ peers: parsed });
    usePresence.getState().setPeers(new Map([...parsed].map(([id, peer]) => [id, toBoardPeer(peer)])));
  };
  void room
    .peers()
    .then(heard)
    .catch(() => {});
  const offPeers = room.onPeers(heard);

  // A hidden tab drops its cursor.
  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') {
      lastPointer = JSON.stringify(null);
      own.send({ pointer: null });
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  return () => {
    stopped = true;
    offCamera();
    offSelection();
    offPeers();
    document.removeEventListener('visibilitychange', onVisibility);
    own.send({ pointer: null, chat: null, chatAsk: null, leading: null, asks: null });
    own.flush();
    if (sender === own) sender = null;
    // Let the last patch go out before the sender stops for good.
    setTimeout(() => own.dispose(), 1000);
    useCollabPeers.setState({ peers: new Map() });
  };
}
