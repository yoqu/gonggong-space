/**
 * Has the stage report its text nodes, with their places, while the picture holds still and text can be changed:
 * paused, loaded, writable, and not in comment mode. The stage forgets the watch when it loads a film, so each
 * load (a new `meta`) asks again.
 */

import type { StageToHost } from '@open-artifact/motion-stage';
import { useComments } from '../comments/comments.ts';
import { filmEngine } from '../engine/engine-context.ts';
import { useFilm } from '../stores/film.ts';
import { usePlayback } from '../stores/playback.ts';
import { useWorking } from '../stores/working.ts';
import { shownText } from './text-model.ts';
import { useText } from './text-store.ts';

const wanted = (): boolean =>
  useFilm.getState().stage === 'ready' && !usePlayback.getState().playing && useWorking.getState().readOnlyReason === null && !useComments.getState().on;

export function startTextWatch(): () => void {
  let on = false;
  const tell = (again: boolean): void => {
    const want = wanted();
    if (want === on && !again) return;
    on = want;
    filmEngine()?.send({ type: 'watch', on, places: true });
    if (!on) useText.setState({ nodes: [] });
  };
  const hear = (message: StageToHost): void => {
    if (message.type === 'texts' && on) useText.setState({ nodes: message.nodes.map(shownText) });
  };
  let stopHearing = filmEngine()?.onStageMessage(hear) ?? null;
  const stops = [
    useFilm.subscribe((state, before) => {
      if (state.meta !== before.meta) {
        if (state.meta !== null) useText.setState({ shown: state.records.retyped?.lines ?? [] });
        // The engine may have been set after this started.
        stopHearing ??= filmEngine()?.onStageMessage(hear) ?? null;
        tell(true);
      } else if (state.stage !== before.stage) tell(false);
      if (state.records !== before.records) useText.setState({ typed: null });
    }),
    usePlayback.subscribe((state, before) => {
      if (state.playing !== before.playing) tell(false);
    }),
    useWorking.subscribe((state, before) => {
      if (state.readOnlyReason !== before.readOnlyReason) tell(false);
    }),
    useComments.subscribe((state, before) => {
      if (state.on !== before.on) tell(false);
    }),
  ];
  tell(true);
  return () => {
    for (const stop of stops) stop();
    stopHearing?.();
    if (on) filmEngine()?.send({ type: 'watch', on: false, places: true });
    useText.setState({ nodes: [], typed: null, held: null, order: null, near: null, asked: null });
  };
}
