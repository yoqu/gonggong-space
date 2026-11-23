/**
 * The board's background grid: faint lines every 48 board units that double
 * their spacing as you zoom out, fading the in-between lines in and out.
 * Positioned imperatively from the camera store (no React render per frame).
 */

import { useEffect, useRef } from 'react';
import { gridPitchAtZoom, snapCameraOffset, type Camera } from '../lib/camera.ts';
import { useCamera } from '../state/camera.ts';

/** CSS property carrying the fade of the in-between grid lines (0–1). */
export const GRID_GOING_PROPERTY = '--wb-grid-going';

/** Positions the grid layer for a camera; `resized` also recomputes its tiling. */
export function positionGridLayer(layer: HTMLElement, camera: Camera, pixelRatio: number, resized: boolean): void {
  const { pitch, going } = gridPitchAtZoom(camera.zoom);
  const tile = going < 1 ? 2 * pitch : pitch;
  const wrap = (offset: number): number =>
    Math.round(((((snapCameraOffset(offset, camera.zoom, pixelRatio) - 0.5) % tile) + tile) % tile - tile) * pixelRatio + 0.000001) / pixelRatio;
  layer.style.transform = `translate(${wrap(camera.x)}px, ${wrap(camera.y)}px)`;
  if (!resized) return;
  const overflow = Math.ceil(tile) + 1;
  layer.style.inset = `0 ${-overflow}px ${-overflow}px 0`;
  layer.style.backgroundSize = `${tile}px ${tile}px` + (going < 1 ? `, ${tile}px ${tile}px, ${tile}px ${tile}px, ${tile}px ${tile}px` : `, ${tile}px ${tile}px, 0 0, 0 0`);
  layer.style.backgroundPosition = `0 0, 0 0, 0 ${pitch}px, ${pitch}px 0`;
  layer.style.setProperty(GRID_GOING_PROPERTY, String(going));
}

/** The grid layer. */
export function Grid() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const layer = ref.current;
    if (!layer) return;
    const ratio = (): number => window.devicePixelRatio || 1;
    positionGridLayer(layer, useCamera.getState().camera, ratio(), true);
    const unsubscribe = useCamera.subscribe((state, previous) => {
      if (state.camera === previous.camera) return;
      positionGridLayer(layer, state.camera, ratio(), state.camera.zoom !== previous.camera.zoom);
    });
    // Device pixel ratio changes (moving between displays) re-snap the grid.
    let query: MediaQueryList | null = null;
    const onRatio = (): void => {
      query?.removeEventListener('change', onRatio);
      query = matchMedia(`(resolution: ${ratio()}dppx)`);
      query.addEventListener('change', onRatio);
      positionGridLayer(layer, useCamera.getState().camera, ratio(), true);
    };
    onRatio();
    return () => {
      unsubscribe();
      query?.removeEventListener('change', onRatio);
    };
  }, []);
  return <div ref={ref} className="wb-grid" aria-hidden />;
}
