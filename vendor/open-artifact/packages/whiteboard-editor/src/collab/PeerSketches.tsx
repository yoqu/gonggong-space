/**
 * What other people are drawing that has no element yet, inside the
 * collaboration layer (board units): the pen stroke and the arrow they are
 * drawing, in the ink they will have, as this page draws its own. (Elements
 * a peer moves, resizes or turns are drawn by the element layer itself, see
 * `peer-hands.ts`.) A sketch fades a little once its gesture closed, until
 * its element arrives.
 */

import { memo, useMemo } from 'react';
import { ARROW_STROKE, type ColorScheme } from '@open-artifact/whiteboard-core';
import { elementInkColor } from '../export/look.ts';
import { arrowHeadPath } from '../elements/LineViews.tsx';
import { useColorScheme } from '../state/theme.ts';
import { usePeerGestures } from './live-gestures.ts';
import { handSketches, type PeerHand } from './peer-hands.ts';

const PeerSketch = memo(function PeerSketch({ hand, scheme }: { hand: PeerHand; scheme: ColorScheme }) {
  const sketches = useMemo(() => handSketches(hand.frame), [hand.frame]);
  if (sketches.length === 0) return null;
  return (
    <g className="wb-peer-sketch" data-ended={hand.endedAt !== undefined ? '' : undefined}>
      {sketches.map((sketch) => {
        const ink = elementInkColor(sketch, scheme);
        if (sketch.kind === 'ink') return <path key="ink" d={sketch.d} stroke={ink} strokeWidth={sketch.width} />;
        const tip = { x: sketch.x2, y: sketch.y2 };
        const from = { x: sketch.x1, y: sketch.y1 };
        return (
          <g key="draft" stroke={ink} strokeWidth={ARROW_STROKE.width}>
            <path d={`M ${from.x} ${from.y} L ${tip.x} ${tip.y}`} />
            {Math.hypot(tip.x - from.x, tip.y - from.y) > ARROW_STROKE.head ? <path d={arrowHeadPath(tip, from)} /> : null}
          </g>
        );
      })}
    </g>
  );
});

/** Every peer's pen stroke and arrow being drawn. */
export function PeerSketches() {
  const hands = usePeerGestures((state) => state.hands);
  const scheme = useColorScheme();
  if (hands.size === 0) return null;
  return (
    <>
      {[...hands.values()].map((hand) => (
        <PeerSketch key={hand.peer} hand={hand} scheme={scheme} />
      ))}
    </>
  );
}
