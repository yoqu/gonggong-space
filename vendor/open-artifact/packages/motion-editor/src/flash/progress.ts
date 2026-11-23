/**
 * Whether a flash check will finish in time, judged from when each frame came. Pure.
 */

/** No judgment before this many frames came, or this much time went by (ms). */
export const EARLY_FRAMES = 15;
export const EARLY_MS = 2000;
/** The pace is judged over the last this many frames too, so a slow start is forgiven. */
export const RECENT_FRAMES = 30;
/** A check found behind waits its patience and this much more before it gives up (ms). */
export const RETRY_WAIT_MS = 1000;

/** on: on course to finish in time; behind: not, but for less than its patience; late: behind for longer. */
export type FlashProgress = 'on' | 'behind' | 'late';

/**
 * `times`: when each frame so far came, ms after the first; `total`: frames wanted; `budgetMs`: the time the check
 * has; `patienceMs`: how long it may be behind (0: judged on the average pace alone, never forgiven).
 */
export function flashProgress(times: readonly number[], total: number, budgetMs: number, patienceMs: number): FlashProgress {
  const behindAt = (count: number): boolean => {
    const spent = times[count - 1] ?? 0;
    if (!(count > EARLY_FRAMES || spent > EARLY_MS)) return false;
    if (patienceMs === 0) return (spent / count) * total > budgetMs;
    const recent = count > RECENT_FRAMES ? (spent - (times[count - 1 - RECENT_FRAMES] ?? 0)) / RECENT_FRAMES : Infinity;
    return Math.min(spent / count, recent) * (total - count) > budgetMs - spent;
  };
  let count = times.length;
  while (count > 0 && behindAt(count)) count--;
  if (count === times.length) return 'on';
  return (times[times.length - 1] ?? 0) - (times[count] ?? 0) >= patienceMs ? 'late' : 'behind';
}
