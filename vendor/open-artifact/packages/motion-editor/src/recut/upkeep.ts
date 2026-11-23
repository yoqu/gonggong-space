/**
 * Keeps `recut.json` in step with the film. When the agent gives a scene another length of its own, the length set
 * by hand stops counting and a toast says so; once `scenes.json` and the film the stage plays agree, entries that no
 * longer apply are dropped from the record (not an undo step).
 */

import { toast } from '@open-artifact/ui';
import { RECUT_MODULE, moduleDocumentPath, parseRecutRecord, pruneRecutText, recordVersion, recutMatchesScenes } from '@open-artifact/motion-core';
import { writeFilmDocument } from '../host/live-film.ts';
import { maybeSession } from '../host/session.ts';
import { useFilm } from '../stores/film.ts';
import { agentName } from '../stores/working.ts';
import { readRecord, recordText } from '../tweaks/record-documents.ts';
import { handLengths, lapsedHandLengths, recutParts, type HandLength } from './lapsed.ts';
import { lengthLapsed } from './words.ts';

export function startRecutUpkeep(): () => void {
  let before: Map<string, HandLength> | null = null;
  const look = (): void => {
    const { clock, scenes } = useFilm.getState();
    const text = recordText(RECUT_MODULE);
    if (clock === null || maybeSession()?.canEdit !== true || recordVersion(text, 'scenes') === 'later') return;
    const record = readRecord(RECUT_MODULE, parseRecutRecord);
    const now = handLengths(record, clock.parts);
    if (before !== null) for (const label of lapsedHandLengths(before, now, record, clock.parts)) toast.add({ title: lengthLapsed(agentName(), label) });
    before = now;
    const parts = recutParts(clock.parts);
    if (!recutMatchesScenes(scenes?.scenes ?? null, parts)) return;
    const pruned = pruneRecutText(text, parts);
    if (pruned !== text) writeFilmDocument(moduleDocumentPath(RECUT_MODULE), pruned === null ? null : { kind: 'json', text: pruned });
  };
  const stop = useFilm.subscribe((state, previous) => {
    if (state.clock !== previous.clock || state.scenes !== previous.scenes || state.records.recut !== previous.records.recut) look();
  });
  look();
  return stop;
}
