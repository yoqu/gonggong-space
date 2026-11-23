/**
 * What the agent learns of this viewer's screen: the view context in room presence (the mode, the playhead and its
 * scene, the records holding changes by hand). Published at most every {@link VIEW_CONTEXT_EVERY_MS}, and only
 * when it changed.
 */

import { recordsWithChanges } from '../engine/records.ts';
import { filmPending, filmSource } from '../host/live-film.ts';
import { maybeSession } from '../host/session.ts';
import { useFilm } from '../stores/film.ts';
import { usePlayback } from '../stores/playback.ts';
import { useUi } from '../stores/ui.ts';
import { videoViewContext, type ViewInputs } from './view-shape.ts';

export const VIEW_CONTEXT_EVERY_MS = 750;

function currentInputs(): ViewInputs {
  const { clock, records } = useFilm.getState();
  const { time, playing } = usePlayback.getState();
  const part = clock?.parts[clock.partAtPlay(time)];
  return {
    panel: useUi.getState().panel,
    time,
    playing,
    sceneKey: part?.key ?? null,
    dirty: filmPending() > 0,
    handEditRecords: recordsWithChanges(records),
  };
}

/** Starts publishing; the stop function clears what was published. */
export function startViewContext(): () => void {
  const room = maybeSession()?.room ?? null;
  if (room === null) return () => undefined;
  let published = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const publish = (): void => {
    timer = undefined;
    if (stopped) return;
    const context = videoViewContext(currentInputs());
    const json = JSON.stringify(context);
    if (json === published) return;
    published = json;
    room.presence({ viewContext: context }).catch(() => {
      published = '';
    });
  };
  const schedule = (): void => {
    if (timer === undefined) timer = setTimeout(publish, VIEW_CONTEXT_EVERY_MS);
  };
  const stops = [useFilm.subscribe(schedule), usePlayback.subscribe(schedule), useUi.subscribe(schedule), filmSource.subscribe(schedule)];
  schedule();
  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
    for (const stop of stops) stop();
    if (published !== '') room.presence({ viewContext: null }).catch(() => undefined);
  };
}
