/**
 * Keeps `retyped.json` in step with the film: lines nothing in the film reads any more are dropped once the film has
 * been quiet a while, and lines an agent's turn stopped showing are offered back (a notice that asks the agent to
 * put the typed words back).
 */

import {
  RETYPED_MODULE,
  WORKING_SETTINGS,
  endedTextRequest,
  filmRecordTexts,
  moduleDocumentPath,
  pruneRetypedLines,
  serializeRetypedRecord,
  type EndedRetypedLine,
} from '@open-artifact/motion-core';
import { sendAgentRequest } from '../agent/send.ts';
import { filmPending, writeFilmDocument } from '../host/live-film.ts';
import { maybeSession } from '../host/session.ts';
import { useFilm } from '../stores/film.ts';
import { useUi } from '../stores/ui.ts';
import { agentName, useWorking } from '../stores/working.ts';
import { EndedLinesWatch, filmTextKey } from './ended-lines.ts';
import { askToPutBack, endedLinesNotice } from './words.ts';

export const ENDED_NOTICE_ID = 'ended-text';
const PRUNE_WAIT_MS = WORKING_SETTINGS.unsaidAfterS * 1000;

function offerEnded(lines: readonly EndedRetypedLine[]): void {
  const said = endedLinesNotice(agentName(), lines.length, lines[0]?.v ?? '');
  const canAsk = useWorking.getState().canAsk;
  useUi.getState().addNotice({
    id: ENDED_NOTICE_ID,
    tone: 'info',
    text: said,
    ...(canAsk
      ? {
          action: {
            label: askToPutBack(agentName()),
            run: () => {
              useUi.getState().dismissNotice(ENDED_NOTICE_ID);
              void sendAgentRequest(endedTextRequest(lines.map((line) => ({ now: line.now, old: line.old, typed: line.v }))));
            },
          },
        }
      : {}),
  });
}

/** The pruned record's text when pruning drops a line, `undefined` when it drops none. */
function prunedText(): { key: string; text: string | null } | undefined {
  const { film, records } = useFilm.getState();
  if (film === null || records.retyped === null || records.retyped.lines.length === 0) return undefined;
  const pruned = pruneRetypedLines(records.retyped, filmRecordTexts(film, RETYPED_MODULE));
  return pruned === records.retyped ? undefined : { key: filmTextKey(film), text: serializeRetypedRecord(pruned) };
}

const mayPrune = (): boolean =>
  maybeSession()?.canEdit === true &&
  useWorking.getState().activity !== 'working' &&
  filmPending() === 0 &&
  document.visibilityState === 'visible' &&
  navigator.onLine !== false;

export function startRetypedUpkeep(pruneWaitMs = PRUNE_WAIT_MS): () => void {
  const watch = new EndedLinesWatch();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedulePrune = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (pruneWaitMs <= 0 || prunedText() === undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      const pruned = prunedText();
      if (pruned === undefined) return;
      if (!mayPrune()) return schedulePrune();
      writeFilmDocument(moduleDocumentPath(RETYPED_MODULE), pruned.text === null ? null : { kind: 'json', text: pruned.text });
    }, pruneWaitMs);
  };
  const look = (): void => {
    const { film, records } = useFilm.getState();
    const ended = watch.film(film === null ? null : { film, lines: records.retyped?.lines ?? [] }, Date.now());
    if (ended.length > 0) offerEnded(ended);
  };
  const stopFilm = useFilm.subscribe((state, before) => {
    if (state.film === before.film) return;
    look();
    schedulePrune();
  });
  const stopWorking = useWorking.subscribe((state, before) => {
    if (state.activity === before.activity) return;
    const working = state.activity === 'working';
    watch.activity(working, Date.now());
    if (working) useUi.getState().dismissNotice(ENDED_NOTICE_ID);
    look();
    schedulePrune();
  });
  watch.activity(useWorking.getState().activity === 'working', Date.now());
  look();
  schedulePrune();
  return () => {
    if (timer !== undefined) clearTimeout(timer);
    stopFilm();
    stopWorking();
  };
}
