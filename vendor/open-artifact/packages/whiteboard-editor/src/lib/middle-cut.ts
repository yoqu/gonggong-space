/**
 * Short forms of long file names. No DOM.
 */

/** Longest extension (dot included) kept whole by {@link middleCut}. */
const LONGEST_EXTENSION = 10;

/**
 * Cuts `name` to `max` characters in the middle, so its start and its
 * extension both stay readable: `quarterly-pl…-v2.txt`. Names that fit come
 * back as they are.
 */
export function middleCut(name: string, max: number): string {
  const chars = [...name];
  if (chars.length <= max) return name;
  const room = Math.max(1, max - 1);
  const dot = chars.lastIndexOf('.');
  const extension = dot > 0 && chars.length - dot <= LONGEST_EXTENSION ? chars.length - dot : 0;
  const tail = Math.min(room - 1, Math.max(extension, Math.ceil(room / 3)));
  if (tail <= 0) return `${chars.slice(0, room).join('')}…`;
  return `${chars.slice(0, room - tail).join('')}…${chars.slice(-tail).join('')}`;
}
