/**
 * Flash checks ahead of time: while the Tweaks panel is open and the film is paused, the scene at the playhead is
 * checked in the background once the playhead rests, so shortening it answers at once. Playing calls it off.
 */

import { SCENE_SETTINGS } from '@open-artifact/motion-core';
import { useFilm } from '../stores/film.ts';
import { usePlayback } from '../stores/playback.ts';
import { useUi } from '../stores/ui.ts';
import { disposeFlashStage, warmSceneCheck } from './index.ts';

/** The playhead rests this long before its scene is checked (ms). */
export const WARM_REST_MS = 400;

const awake = (): boolean => useUi.getState().panel === 'tweaks' && !usePlayback.getState().playing && useFilm.getState().stage === 'ready';

export function installFlash(): () => void {
  if (!SCENE_SETTINGS.flashCheck) return () => undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const consider = (): void => {
    clearTimeout(timer);
    timer = undefined;
    if (!awake()) return;
    timer = setTimeout(() => {
      timer = undefined;
      const clock = useFilm.getState().clock;
      if (!awake() || clock === null) return;
      const index = clock.partAtPlay(usePlayback.getState().time);
      // Only scenes are shortened by hand; chapters are not.
      if (clock.parts[index]?.key != null) warmSceneCheck(index);
    }, WARM_REST_MS);
  };
  const stops = [
    useUi.subscribe((state, previous) => {
      if (state.panel !== previous.panel) consider();
    }),
    usePlayback.subscribe((state, previous) => {
      if (state.playing !== previous.playing || (!state.playing && state.time !== previous.time)) consider();
    }),
    useFilm.subscribe((state, previous) => {
      if (state.stage !== previous.stage || state.clock !== previous.clock) consider();
    }),
  ];
  consider();
  return () => {
    clearTimeout(timer);
    for (const stop of stops) stop();
    disposeFlashStage();
  };
}
