/**
 * Other people on the board, in screen units: their cursors with names and
 * cursor-chat bubbles, and marks on the screen edge for cursors outside
 * this view (a click brings the view to them).
 *
 * Names and chat come from peers: rendered as text only.
 */

import { useMemo } from 'react';
import { boardToScreen, type Point } from '../lib/camera.ts';
import { panToPoint } from '../services/viewport.ts';
import { useCamera } from '../state/camera.ts';
import { announce } from './announce.ts';
import { CHAT_ASK_HOLD_MS } from './cursor-chat.ts';
import { useNow } from './hooks.ts';
import { useCollabPeers, type CollabPeer } from './peers.ts';

/** A cursor that has not moved for this long is dimmed (ms). */
export const CURSOR_DIM_MS = 60_000;

/** A cursor that has not moved for this long is hidden (ms). */
export const CURSOR_HIDE_MS = 15 * 60_000;

/** A chat line that has not changed for this long is no longer shown (ms). */
const CHAT_STALE_MS = 60_000;

/** Most characters of a name on an edge mark. */
const EDGE_NAME_CHARS = 8;

/** Distance of edge marks from the view's edge (px). */
const EDGE_INSET = 14;

/** A short name for an edge mark. */
export function shortName(name: string, max = EDGE_NAME_CHARS): string {
  const chars = [...name.trim()];
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max - 1).join('')}…`;
}

/** Where an off-screen point's edge mark sits: clamped into the view's inner box. */
export function edgePoint(point: Point, width: number, height: number, top: number, bottom: number): Point {
  return {
    x: Math.min(width - EDGE_INSET, Math.max(EDGE_INSET, point.x)),
    y: Math.min(height - bottom - EDGE_INSET, Math.max(top + EDGE_INSET, point.y)),
  };
}

function CursorArrow({ color }: { color: string }) {
  return (
    <svg className="wb-cursor-arrow" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path d="M2 1.5 L15.5 8.2 L9.3 9.6 L6.4 15.8 Z" fill={color} stroke="white" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

function chatShown(peer: CollabPeer, now: number): boolean {
  if (!peer.chat) return false;
  return now - peer.chat.at < (peer.chat.asking ? CHAT_ASK_HOLD_MS : CHAT_STALE_MS);
}

/** Other people's cursors and their edge marks. */
export function PeerCursors() {
  const peers = useCollabPeers((state) => state.peers);
  const camera = useCamera((state) => state.camera);
  const width = useCamera((state) => state.width);
  const height = useCamera((state) => state.height);
  const insets = useCamera((state) => state.insets);
  const now = useNow(5000);

  const placed = useMemo(
    () =>
      [...peers.values()].flatMap((peer) => {
        if (!peer.pointer || now - peer.movedAt > CURSOR_HIDE_MS) return [];
        const at = boardToScreen(camera, peer.pointer);
        const inside = at.x >= 0 && at.y >= 0 && at.x <= width && at.y <= height;
        return [{ peer, at, inside, dim: now - peer.movedAt > CURSOR_DIM_MS }];
      }),
    [peers, camera, width, height, now],
  );
  const outside = placed.filter((entry) => !entry.inside);

  return (
    <>
      {placed
        .filter((entry) => entry.inside)
        .map(({ peer, at, dim }) => (
          <div
            key={peer.id}
            className="wb-cursor"
            data-dim={dim ? '' : undefined}
            style={{ transform: `translate(${at.x}px, ${at.y}px)`, ['--wb-peer' as string]: peer.color }}
          >
            <CursorArrow color={peer.color} />
            {chatShown(peer, now) ? (
              <div className="wb-cursor-chat" data-asking={peer.chat!.asking ? '' : undefined}>
                {peer.chat!.asking ? <span className="wb-cursor-chat-tag">@Agent</span> : null}
                <span className="wb-cursor-chat-text" dir="auto">{peer.chat!.text}</span>
                <span className="wb-cursor-chat-name" dir="auto">{peer.name}</span>
              </div>
            ) : (
              <span className="wb-cursor-name" dir="auto">{peer.name}</span>
            )}
          </div>
        ))}
      {outside.length > 0 ? (
        <div role="group" aria-label="Cursors outside your view" className="wb-edge-marks" data-wb-chrome="">
          {outside.map(({ peer, at }) => {
            const mark = edgePoint(at, width, height, insets.top, insets.bottom);
            return (
              <button
                key={peer.id}
                type="button"
                className="wb-edge-mark"
                aria-label={`Go to ${peer.name}`}
                title={`Go to ${peer.name}`}
                style={{ transform: `translate(${mark.x}px, ${mark.y}px)`, ['--wb-peer' as string]: peer.color }}
                onClick={() => {
                  if (!peer.pointer) return;
                  panToPoint(peer.pointer);
                  announce(`Your view moved to ${peer.name}.`);
                }}
              >
                {shortName(peer.name)}
              </button>
            );
          })}
        </div>
      ) : null}
    </>
  );
}
