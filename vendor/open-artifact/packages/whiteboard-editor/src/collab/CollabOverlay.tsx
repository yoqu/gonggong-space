/**
 * Collaboration drawings in screen units, above the board: the labels of
 * the agent's claims, other people's cursors (and edge marks), comment
 * pins and cards, the corner grip of an area being asked or commented
 * about, the idea mark and this viewer's cursor chat line.
 *
 * The root never takes pointer events itself; only the controls in it do
 * (each carries `data-wb-chrome`, so the board starts no gesture on them).
 */

import { CLAIM_FADE_MS } from '@open-artifact/whiteboard-core';
import { boardToScreen } from '../lib/camera.ts';
import { useCamera } from '../state/camera.ts';
import { AreaGrips } from './AreaGrip.tsx';
import { CommentPins } from './CommentPins.tsx';
import { CursorChatBox } from './CursorChatBox.tsx';
import { useClaimViews, useFading } from './hooks.ts';
import { IdeaMark } from './IdeaMark.tsx';
import { PeerCursors } from './PeerCursors.tsx';

/** The labels of the agent's claims: what it is doing there, and for whom. */
function ClaimLabels() {
  const claims = useFading(useClaimViews(), CLAIM_FADE_MS);
  const camera = useCamera((state) => state.camera);
  return (
    <>
      {claims.map((claim) => {
        const at = boardToScreen(camera, { x: claim.frame.x, y: claim.frame.y });
        return (
          <div
            key={claim.key}
            className="wb-claim-label"
            data-leaving={claim.leaving ? '' : undefined}
            style={{ transform: `translate(${at.x}px, ${at.y - 26}px)`, ['--wb-peer' as string]: claim.color }}
            aria-hidden="true"
          >
            <span className="wb-shimmer">{claim.label}…</span>
            {claim.name ? <span className="wb-claim-for">for {claim.name}</span> : null}
          </div>
        );
      })}
    </>
  );
}

/** Collaboration drawings in screen units (place inside the board's overlay). */
export function CollabOverlay() {
  return (
    <div className="wb-collab-overlay">
      <ClaimLabels />
      <PeerCursors />
      <AreaGrips />
      <CommentPins />
      <IdeaMark />
      <CursorChatBox />
    </div>
  );
}
