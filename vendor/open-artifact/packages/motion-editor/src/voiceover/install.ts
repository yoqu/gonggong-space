/**
 * The voiceover's part of the page: lines heard from the sound player, the lane under the scene strip while there
 * are lines, the lines sent to the agent let go once its turn is done, and the flash checks' background warm-up.
 * Captions need nothing here: the stage draws them.
 */

import { createElement } from 'react';
import { filmEngine } from '../engine/engine-context.ts';
import { installFlash } from '../flash/install.ts';
import { useFilm } from '../stores/film.ts';
import { useWorking } from '../stores/working.ts';
import { registerTimelineLane } from '../timeline/lanes.ts';
import { OUT_HOLD_MS } from './lines.ts';
import { takeSoundInput } from './source.ts';
import { useVoiceover } from './store.ts';
import { LANE_HEIGHT, VoiceoverLane } from './VoiceoverLane.tsx';

const LANE_ORDER = 20;

function laneWhileLines(): () => void {
  let unregister: (() => void) | null = null;
  const follow = (): void => {
    const { lines } = useVoiceover.getState();
    const wanted = lines !== null && lines.length > 0;
    if (wanted && unregister === null) {
      unregister = registerTimelineLane({
        id: 'voiceover',
        order: LANE_ORDER,
        height: LANE_HEIGHT,
        render: (context) => createElement(VoiceoverLane, { context }),
      });
    } else if (!wanted && unregister !== null) {
      unregister();
      unregister = null;
    }
  };
  follow();
  const stop = useVoiceover.subscribe(follow);
  return () => {
    stop();
    unregister?.();
  };
}

/** Lines sent to the agent stay marked until its turn ends, or a minute on when it never started on them. */
function settleWhenAgentDone(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let started = false;
  const stopAsked = useVoiceover.subscribe((state, previous) => {
    if (state.asked === previous.asked) return;
    clearTimeout(timer);
    timer = undefined;
    started = useWorking.getState().activity === 'working';
    if (!state.asked) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (!started) useVoiceover.getState().settled();
    }, OUT_HOLD_MS);
  });
  const stopWorking = useWorking.subscribe((state, previous) => {
    if (state.activity === previous.activity || !useVoiceover.getState().asked) return;
    if (state.activity === 'working') started = true;
    else if (previous.activity === 'working') useVoiceover.getState().settled();
  });
  return () => {
    clearTimeout(timer);
    stopAsked();
    stopWorking();
  };
}

export function installVoiceover(): () => void {
  const engine = filmEngine();
  const stops: (() => void)[] = [
    engine?.onSoundLoad(takeSoundInput) ?? (() => undefined),
    // A film with no cut plays nothing, and says no lines.
    useFilm.subscribe((state, previous) => {
      if (state.hasScript !== previous.hasScript && !state.hasScript) useVoiceover.getState().setLines(null, false);
    }),
    laneWhileLines(),
    settleWhenAgentDone(),
    installFlash(),
  ];
  return () => {
    for (const stop of stops.reverse()) stop();
  };
}
