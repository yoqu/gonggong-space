import { asPlayed, type AnchorClock } from '../anchors.ts';
import { clipCharacters } from '../json.ts';
import type { PlaySeconds } from '../units.ts';
import { randomDelimiterId, wrapUntrusted, type VideoAgentRequest } from './common.ts';

/** The file an export was making. */
export type ExportFormat = { kind: 'gif'; shortSide: number; delayCs: number } | { kind: 'video'; height: number; fps: number };

/** What went wrong in an export; its times are as played. */
export type ExportProblem =
  | {
      /** Frames that could not be drawn, each replaced by the one before. */
      kind: 'held';
      count: number;
      total: number;
      first?: { t: PlaySeconds; message: string };
      last?: PlaySeconds;
      /** The file was saved all the same. */
      saved: boolean;
    }
  | { kind: 'failed'; t: PlaySeconds; message: string };

export const MAX_EXPORT_ERROR_CHARS = 600;

export function describeExportFormat(format: ExportFormat): string {
  switch (format.kind) {
    case 'gif':
      return `a GIF (${format.shortSide} px, ${Math.round(1000 / format.delayCs) / 10} fps)`;
    case 'video':
      return `video (${format.height}p, ${format.fps} fps)`;
    default: {
      const never: never = format;
      return never;
    }
  }
}

const seconds = (t: number): string => `${t.toFixed(2)} s`;

/** Moments as played, said in the film's own seconds, with the played ones too when they differ. */
function filmTimes(clock: AnchorClock, ...played: PlaySeconds[]): string {
  const film = played.map((t) => seconds(clock === null ? t : clock.toFilm(t))).join(' and ');
  const asShown = played.map(seconds).join(' and ');
  return film === asShown ? film : film + asPlayed(asShown);
}

function problemText(problem: ExportProblem, format: ExportFormat, clock: AnchorClock): string {
  const file = describeExportFormat(format);
  switch (problem.kind) {
    case 'held': {
      const where =
        problem.first === undefined
          ? ''
          : problem.count === 1 || problem.last === undefined
            ? ` at ${filmTimes(clock, problem.first.t)}`
            : ` between ${filmTimes(clock, problem.first.t, problem.last)}`;
      return (
        `I exported this animation to ${file} and ${problem.count} of ${problem.total} frames${where} could not be drawn; the export repeated the previous frame for each.` +
        (problem.saved ? '' : ' The host then refused to save the file, so nothing was saved.') +
        ' Please fix the animation so that every frame can be drawn. It may play normally at those times, so take stills there to check. Then say so and I will export again.'
      );
    }
    case 'failed':
      return `I tried to export this animation to ${file} and the export stopped at ${filmTimes(clock, problem.t)}. Please fix the animation so it renders and exports cleanly, then say so and I will try again.`;
    default: {
      const never: never = problem;
      return never;
    }
  }
}

/** Ask the agent to fix what kept an export from drawing every frame, with the first error the player reported. */
export function exportProblemRequest(problem: ExportProblem, format: ExportFormat, clock: AnchorClock = null, id: string = randomDelimiterId()): VideoAgentRequest {
  const error = clipCharacters(problem.kind === 'held' ? (problem.first?.message ?? '') : problem.message, MAX_EXPORT_ERROR_CHARS);
  const text = problemText(problem, format, clock);
  return {
    title: 'Export problem',
    text: error === '' ? text : `${text}\n\nThe first error, as the player reported it:\n${wrapUntrusted('error text produced by the animation', error, id)}`,
    ...(error !== '' ? { context: { error } } : {}),
  };
}
