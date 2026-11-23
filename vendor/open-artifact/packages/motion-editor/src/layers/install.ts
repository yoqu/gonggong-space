/**
 * Installs the layers: the reading of the stage's layers, the selection over the picture, Esc or a press away from
 * the picture and the panel to let the pick go, and Cmd or Ctrl held to point at the innermost layer. The Properties
 * panel renders `<LayersSection />` itself.
 */

import { createElement } from 'react';
import { shortcuts } from '../keyboard/registry.ts';
import { registerStageOverlay } from '../player/overlays.ts';
import { deselectLayer, layersActive, startLayerReader } from './reader.ts';
import { OPEN_POPUP, pressLetsGo } from './press-away.ts';
import { cancelLive } from './retouch.ts';
import { SelectionOverlay, refreshHover } from './SelectionOverlay.tsx';
import { useLayers } from './store.ts';
import { DESELECT_LAYER } from './words.ts';

/** Under the comment layer, over the frames; the text editing overlay may lay itself over it. */
export const LAYERS_OVERLAY_ORDER = 20;

/** Esc lets the pick go where the focus is on nothing in particular, or in the layers. */
function escapeApplies(): boolean {
  if (useLayers.getState().pickedId === null || !layersActive()) return false;
  if (typeof document === 'undefined') return true;
  const focus = document.activeElement;
  return focus === null || focus === document.body || focus.closest('[data-layers-section], [data-video-layers]') !== null;
}

/** Lets the pick go on presses away from the picture and the panel in `view`; returns a function that stops. */
function watchPressesAway(view: Window): () => void {
  const onPointerDown = (event: PointerEvent): void => {
    if (useLayers.getState().pickedId === null) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!pressLetsGo({ button: event.button, target }, view.document.querySelector(OPEN_POPUP) !== null)) return;
    cancelLive();
    deselectLayer();
  };
  view.addEventListener('pointerdown', onPointerDown, true);
  return () => view.removeEventListener('pointerdown', onPointerDown, true);
}

export function installLayers(): () => void {
  const stops: Array<() => void> = [];
  stops.push(startLayerReader());
  stops.push(
    registerStageOverlay({
      id: 'layers',
      order: LAYERS_OVERLAY_ORDER,
      render: (context) => createElement(SelectionOverlay, { context }),
    }),
  );
  stops.push(
    shortcuts.register({
      id: 'layers-deselect',
      keys: [{ key: 'Escape' }],
      label: DESELECT_LAYER,
      everywhere: true,
      when: escapeApplies,
      run: () => {
        cancelLive();
        deselectLayer();
      },
    }),
  );
  if (typeof window !== 'undefined') {
    const deep = (event: KeyboardEvent): void => {
      if (event.key !== 'Meta' && event.key !== 'Control') return;
      const held = event.type === 'keydown';
      if (useLayers.getState().deep === held) return;
      useLayers.setState({ deep: held });
      refreshHover();
    };
    const away = (): void => {
      if (useLayers.getState().deep) useLayers.setState({ deep: false });
    };
    window.addEventListener('keydown', deep);
    window.addEventListener('keyup', deep);
    window.addEventListener('blur', away);
    stops.push(watchPressesAway(window));
    stops.push(() => {
      window.removeEventListener('keydown', deep);
      window.removeEventListener('keyup', deep);
      window.removeEventListener('blur', away);
    });
  }
  return () => {
    for (const stop of stops.reverse()) stop();
  };
}
