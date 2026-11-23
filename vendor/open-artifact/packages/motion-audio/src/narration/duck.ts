import { playSeconds } from '@open-artifact/motion-core';
import type { PlaySeconds } from '@open-artifact/motion-core';

/** A point of the score's level under narration: gain `v` at play time `t`, straight lines between points. */
export interface DuckPoint {
  readonly t: PlaySeconds;
  readonly v: number;
}

/** The score starts going down this long before a line. */
export const DUCK_ATTACK_SECONDS = 0.25;
/** And comes back up over this long after it. */
export const DUCK_RELEASE_SECONDS = 0.5;

/**
 * The score's level under narration: down to `duckDb` over the attack before each line, held while it speaks, back up
 * over the release after. Lines close enough that one's attack meets the last one's release stay ducked between them.
 */
export function duckEnvelope(lines: ReadonlyArray<{ readonly at: PlaySeconds; readonly dur: number }>, duckDb: number): DuckPoint[] {
  const low = Math.pow(10, duckDb / 20);
  const points: DuckPoint[] = [];
  let end = -Infinity;
  for (const line of [...lines].sort((first, second) => first.at - second.at)) {
    if (line.at - DUCK_ATTACK_SECONDS <= end + DUCK_RELEASE_SECONDS) points.length -= 2;
    else points.push({ t: playSeconds(line.at - DUCK_ATTACK_SECONDS), v: 1 }, { t: line.at, v: low });
    end = Math.max(end, line.at + line.dur);
    points.push({ t: playSeconds(end), v: low }, { t: playSeconds(end + DUCK_RELEASE_SECONDS), v: 1 });
  }
  return points;
}

/** The envelope's level at `time`: before its first point that point's level, after its last the last one's. */
export function sampleEnvelope(points: readonly DuckPoint[], time: number): number {
  let previous: DuckPoint | null = null;
  for (const point of points) {
    if (time < point.t) {
      return previous === null ? point.v : previous.v + ((point.v - previous.v) * (time - previous.t)) / (point.t - previous.t);
    }
    previous = point;
  }
  return previous?.v ?? 1;
}
