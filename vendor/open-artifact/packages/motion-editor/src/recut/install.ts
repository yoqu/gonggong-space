import { createElement } from 'react';
import { toast } from '@open-artifact/ui';
import { useFilm } from '../stores/film.ts';
import { agentName } from '../stores/working.ts';
import { setSceneEdge } from '../timeline/lanes.ts';
import { SceneEdge } from './SceneEdge.tsx';
import { startRecutUpkeep } from './upkeep.ts';
import { overLimit } from './words.ts';

/** The timeline's scene-edge drag, the record's upkeep, and a toast when lengths set by hand would run the film past its cap. */
export function installRecut(): () => void {
  const stopEdge = setSceneEdge((span, context) => createElement(SceneEdge, { span, context }));
  const stopUpkeep = startRecutUpkeep();
  // The clock is gone while the stage reloads; only a change between two known clocks counts.
  let over = useFilm.getState().clock?.overLimit ?? null;
  const stopLimit = useFilm.subscribe((state) => {
    if (state.clock === null) return;
    if (state.clock.overLimit && over === false) toast.add({ title: overLimit(agentName()) });
    over = state.clock.overLimit;
  });
  return () => {
    stopUpkeep();
    stopLimit();
    stopEdge();
  };
}
