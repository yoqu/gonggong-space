/** The requests the page itself sends: go on, finalize, delete a scene, make it again in another shape, fix an error. */

import {
  REQUEST_LIMITS,
  clipRequestWords,
  continueRequest,
  deleteSceneRequest,
  finalizeRequest,
  shapeRequest,
  wrapUntrusted,
  type FilmShape,
  type VideoAgentRequest,
} from '@open-artifact/motion-core';
import type { StageProblem } from '../stores/film.ts';
import { useWorking } from '../stores/working.ts';
import { formatPlaybackTime } from '../transport/time-format.ts';
import { sendAgentRequest, type RequestOutcome } from './send.ts';
import { ERROR_LABEL, FIX_ERROR_TITLE, SAY_CONTINUE, SAY_FINALIZE, errorWhere, fixErrorText } from './words.ts';

/** Go on with the scenes still to make; `left`: their numbers, from 1. */
export async function askContinue(left: readonly number[]): Promise<RequestOutcome> {
  useWorking.getState().setAsked('continue');
  const outcome = await sendAgentRequest(continueRequest(left.map(String)), { say: SAY_CONTINUE });
  if (outcome !== 'sent') useWorking.getState().setAsked(null);
  return outcome;
}

export async function askFinalize(): Promise<RequestOutcome> {
  useWorking.getState().setAsked('finalize');
  const outcome = await sendAgentRequest(finalizeRequest(), { say: SAY_FINALIZE });
  if (outcome !== 'sent') useWorking.getState().setAsked(null);
  return outcome;
}

/** Take scene `scene` (from 1) out of a film of `count` scenes. */
export function askDeleteScene(scene: number, count: number): Promise<RequestOutcome> {
  return sendAgentRequest(deleteSceneRequest(scene, count));
}

export function askShape(shape: FilmShape): Promise<RequestOutcome> {
  return sendAgentRequest(shapeRequest(shape));
}

/** The error's words come from the film's code, so they go fenced as data. */
export function fixErrorRequest(problem: StageProblem): VideoAgentRequest {
  const at = problem.at === null ? null : formatPlaybackTime(problem.at);
  const message = clipRequestWords(problem.message, REQUEST_LIMITS.selection);
  return {
    title: FIX_ERROR_TITLE,
    text: `${fixErrorText(errorWhere(problem.phase), at)}\n\n${wrapUntrusted(ERROR_LABEL, message)}`,
    context: { phase: problem.phase, ...(problem.at !== null ? { at: Math.round(problem.at * 100) / 100 } : {}) },
  };
}

export function askFixError(problem: StageProblem): Promise<RequestOutcome> {
  return sendAgentRequest(fixErrorRequest(problem));
}
