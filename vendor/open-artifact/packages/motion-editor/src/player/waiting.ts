/** What the player shows over (or instead of) the picture, and what the working bar says. Pure. */

import { WORKING_SETTINGS, type SceneBuildSummary } from '@open-artifact/motion-core';
import type { StagePhase, StageProblem } from '../stores/film.ts';
import type { AgentActivity, AskedRequest, SyncState } from '../stores/working.ts';
import * as words from './words.ts';

export type FilmView =
  | { kind: 'connecting' }
  | { kind: 'unavailable' }
  /** No cut yet and the agent is on it. */
  | { kind: 'starting' }
  /** No cut yet and nobody is on it. */
  | { kind: 'empty' }
  | { kind: 'loading' }
  | { kind: 'error'; problem: StageProblem }
  | { kind: 'playing' };

export interface FilmViewInputs {
  sync: SyncState;
  hasScript: boolean;
  stage: StagePhase;
  problem: StageProblem | null;
  activity: AgentActivity;
}

export function filmView(inputs: FilmViewInputs): FilmView {
  if (inputs.sync === 'connecting') return { kind: 'connecting' };
  if (inputs.sync === 'unavailable' && !inputs.hasScript) return { kind: 'unavailable' };
  if (!inputs.hasScript) return inputs.activity === 'working' ? { kind: 'starting' } : { kind: 'empty' };
  if (inputs.problem !== null) return { kind: 'error', problem: inputs.problem };
  if (inputs.stage === 'ready') return { kind: 'playing' };
  return { kind: 'loading' };
}

export interface StoppedInputs {
  /** Scenes still to make. */
  missing: number;
  activity: AgentActivity;
  /** When the film last changed (or the page opened), ms since the epoch. */
  lastWriteAt: number;
  now: number;
  readOnly: boolean;
  /** The agent waits on the person's answer: quiet, but not stopped. */
  waitsOnYou?: boolean;
}

/** Scenes are missing, the agent is not known to be idle or to wait on the person, and nothing has been written for a while. */
export function seemsStopped(inputs: StoppedInputs): boolean {
  if (inputs.readOnly || inputs.missing === 0 || inputs.activity === 'idle' || inputs.waitsOnYou === true) return false;
  return inputs.now - inputs.lastWriteAt >= WORKING_SETTINGS.unsaidAfterS * 1000;
}

export interface WorkingBarInputs {
  summary: SceneBuildSummary;
  asked: AskedRequest | null;
  /** The agent waits on the person (it asked them something). */
  waitsOnYou: boolean;
}

export interface WorkingBarView {
  rough: boolean;
  says: string | null;
  pips: SceneBuildSummary['pips'];
  /** The button that asks the agent to go on, while it is not working. */
  button: AskedRequest | null;
}

export function workingBarView(inputs: WorkingBarInputs): WorkingBarView | null {
  const { summary, asked, waitsOnYou } = inputs;
  const closing = !summary.closing ? null : summary.button === 'continue' ? words.NOT_FINISHED : asked === 'continue' ? words.FINISHING_UP : null;
  const counted =
    summary.count !== null
      ? summary.count.what === 'making'
        ? words.scenesMade(summary.count.n, summary.count.of)
        : words.scenesFinalized(summary.count.n, summary.count.of)
      : summary.left.length === 0
        ? closing
        : words.scenesMissing(summary.left.length);
  const says = waitsOnYou ? words.WAITING_FOR_YOU : counted;
  const button = asked ?? summary.button;
  if (!summary.rough && says === null && button === null) return null;
  return { rough: summary.rough, says, pips: summary.pips, button };
}
