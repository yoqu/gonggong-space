/**
 * Draws the next-item offer (see `next-offer.ts`) in the camera layer: the
 * offered note or shape as a faint dashed outline at the arrow's free end,
 * with a short hint (“Click or Return”, “Tap to add”) when it is wide
 * enough on screen. Its rules run while it shows.
 */

import { useEffect } from 'react';
import { blockColorHex, roundedPolygonPathData, shapeFillPaint, type NextItem } from '@open-artifact/whiteboard-core';
import { paperTextColor } from '../export/look.ts';
import { useCamera } from '../state/camera.ts';
import { useColorScheme } from '../state/theme.ts';
import type { ViewStyle } from '../elements/style.ts';
import { coarsePointer, enterKeyLabel, useNextOffer, watchNextOffer } from './next-offer.ts';

/** Smallest hit area of the offer, screen pixels (a small item stays easy to click). */
export const OFFER_MIN_HIT_PX = 40;
/** Narrowest offer (screen pixels) that shows its hint, by pointer. */
export const OFFER_HINT_MIN_WIDTH = { mouse: 106, touch: 80 } as const;

/** The offer on show, if any. */
export function NextItemOffer() {
  const offer = useNextOffer((state) => state.offer);
  useEffect(() => (offer ? watchNextOffer(offer) : undefined), [offer]);
  return offer ? <OfferView next={offer.next} /> : null;
}

/** The faint item. */
function OfferView({ next }: { next: NextItem }) {
  const zoom = useCamera((state) => state.camera.zoom);
  const scheme = useColorScheme();
  const touch = coarsePointer();
  const hitInset = Math.min(0, (Math.min(next.w, next.h) - OFFER_MIN_HIT_PX / zoom) / 2);
  const style: ViewStyle = {
    left: next.x,
    top: next.y,
    width: next.w,
    height: next.h,
    '--wb-offer-px': `${1 / zoom}px`,
    '--wb-paper-text': paperTextColor(next, scheme),
    ...(next.type === 'note' ? { transform: `rotate(${next.tilt}deg)` } : {}),
  };
  const hint = next.w * zoom >= OFFER_HINT_MIN_WIDTH[touch ? 'touch' : 'mouse'];
  return (
    <div className="wb-offer" data-wb-offer="" aria-hidden="true" style={style}>
      <i style={{ inset: hitInset }} />
      <svg width={next.w} height={next.h} viewBox={`0 0 ${next.w} ${next.h}`}>
        {next.type === 'note' ? (
          <path d={`M0 0H${next.w}V${next.h}H0Z`} fill={blockColorHex(next.color)} />
        ) : (
          <path d={roundedPolygonPathData(next.kind, next.w, next.h, true)} fill={shapeFillPaint(next)} />
        )}
      </svg>
      {hint ? <span style={{ scale: String(1 / zoom) }}>{touch ? 'Tap to add' : `Click or ${enterKeyLabel()}`}</span> : null}
    </div>
  );
}
