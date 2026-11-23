/**
 * Following and "Follow me".
 *
 * Following a peer eases this page's camera toward the board area they see
 * (their published `view`, clear of their chrome) on every frame, until the
 * person moves the view themselves, presses Escape or the peer leaves.
 *
 * "Follow me" publishes a `leading` serial; other pages follow a new serial
 * on their own (a few times a minute at most, so nobody is dragged around
 * by a stream of requests) and stop when the leader stops.
 */

import { cameraFittingArea, easeCameraToward } from '@open-artifact/whiteboard-core';
import { toast } from '@open-artifact/ui';
import { clampZoom } from '../lib/camera.ts';
import { maybeSession } from '../services/session.ts';
import { useCamera, zoomRange } from '../state/camera.ts';
import { usePresence } from '../state/presence.ts';
import { announce } from './announce.ts';
import { allowAutoFollow, LEADING_REBROADCAST_MS, peerViewArea } from './follow-rules.ts';
import { useCollabPeers } from './peers.ts';
import { publishPresence } from './presence.ts';

export { allowAutoFollow, AUTO_FOLLOW_WINDOW_MS, LEADING_REBROADCAST_MS, MAX_AUTO_FOLLOWS, peerViewArea } from './follow-rules.ts';

/** True when a camera write came from the follow loop, not the person. */
let driving = false;

/** Starts following and "Follow me"; returns a function that stops. */
export function startFollow(): () => void {
  const session = maybeSession();
  if (!session?.room) return () => {};
  // Only editors ask everyone to follow them (commenters and viewers follow).
  const canLead = session.canEdit;
  const stops: Array<() => void> = [];

  // ---- following: ease toward the peer's view every frame ----
  let frame = 0;
  let last = 0;
  const step = (time: number): void => {
    frame = 0;
    const id = usePresence.getState().following;
    if (id === null) return;
    const peer = useCollabPeers.getState().peers.get(id);
    const area = peer ? peerViewArea(peer) : undefined;
    const state = useCamera.getState();
    if (area) {
      const { min, max } = zoomRange(state);
      const viewport = { w: state.width, h: state.height, top: state.insets.top, bottom: state.insets.bottom };
      const target = cameraFittingArea(area, viewport, (zoom) => clampZoom(zoom, min, max));
      const next = easeCameraToward(state.camera, target, last === 0 ? 16 : Math.min(100, time - last), { w: state.width, h: state.height });
      driving = true;
      try {
        state.setCamera(next);
      } finally {
        driving = false;
      }
    }
    last = time;
    frame = requestAnimationFrame(step);
  };
  const run = (): void => {
    if (frame === 0) {
      last = 0;
      frame = requestAnimationFrame(step);
    }
  };
  stops.push(() => {
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = 0;
  });

  // Who is followed changes: announce it and start or stop the loop.
  let autoFollowed: string | null = null;
  stops.push(
    usePresence.subscribe((state, previous) => {
      if (state.following === previous.following) return;
      if (state.following !== autoFollowed) autoFollowed = null;
      if (state.following !== null) {
        const name = useCollabPeers.getState().peers.get(state.following)?.name ?? 'someone';
        announce(`Following ${name}`);
        run();
      } else if (previous.following !== null) {
        announce('Stopped following');
      }
    }),
  );

  // Moving the view yourself stops following.
  stops.push(
    useCamera.subscribe((state, previous) => {
      if (!driving && state.camera !== previous.camera && state.width === previous.width && state.height === previous.height && usePresence.getState().following !== null) {
        usePresence.getState().follow(null);
      }
    }),
  );
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.defaultPrevented || usePresence.getState().following === null) return;
    usePresence.getState().follow(null);
  };
  window.addEventListener('keydown', onKey);
  stops.push(() => window.removeEventListener('keydown', onKey));

  // ---- leading: "Follow me" ----
  let serial = 0;
  let rebroadcast: ReturnType<typeof setInterval> | undefined;
  const lead = (on: boolean): void => {
    if (rebroadcast !== undefined) clearInterval(rebroadcast);
    rebroadcast = undefined;
    if (!on) {
      publishPresence({ leading: null });
      return;
    }
    serial = Date.now();
    publishPresence({ leading: serial });
    rebroadcast = setInterval(() => publishPresence({ leading: serial }), LEADING_REBROADCAST_MS);
  };
  stops.push(
    usePresence.subscribe((state, previous) => {
      if (state.leading === previous.leading) return;
      if (state.leading && !canLead) {
        toast.add({ title: 'Only editors can ask others to follow' });
        usePresence.getState().setLeading(false);
        return;
      }
      lead(state.leading);
      if (state.leading && useCollabPeers.getState().peers.size === 0) toast.add({ title: 'Nobody else here can follow right now' });
      announce(state.leading ? 'You asked everyone to follow you' : 'Stopped asking others to follow');
    }),
  );
  stops.push(() => {
    if (rebroadcast !== undefined) clearInterval(rebroadcast);
    if (usePresence.getState().leading) publishPresence({ leading: null });
  });

  // ---- others' "Follow me": follow new serials, unfollow when they stop ----
  const seen = new Map<string, number>();
  let autoTimes: number[] = [];
  stops.push(
    useCollabPeers.subscribe((state) => {
      for (const [id, peer] of state.peers) {
        const known = seen.get(id);
        if (peer.leading === undefined) {
          seen.delete(id);
          if (known !== undefined && autoFollowed === id && usePresence.getState().following === id) {
            autoFollowed = null;
            usePresence.getState().follow(null);
          }
          continue;
        }
        if (known === peer.leading) continue;
        seen.set(id, peer.leading);
        if (usePresence.getState().leading || usePresence.getState().following === id) continue;
        const decision = allowAutoFollow(autoTimes, Date.now());
        autoTimes = decision.times;
        if (!decision.allowed) continue;
        usePresence.getState().follow(id);
        autoFollowed = id;
      }
      for (const id of [...seen.keys()]) if (!state.peers.has(id)) seen.delete(id);
    }),
  );

  if (usePresence.getState().following !== null) run();
  return () => {
    for (const stop of stops.reverse()) stop();
  };
}
