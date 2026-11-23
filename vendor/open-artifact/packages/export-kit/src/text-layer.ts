/**
 * The PDF text layer, pure part: words measured on a rendered page
 * (dom/measure.ts) joined into the lines they sit on. A PDF draws each line
 * as an invisible, selectable run over the page's picture, so text can be
 * searched and copied.
 *
 * Coordinates are whatever the words were measured in (slide px, document
 * px); placing lines on a PDF page is up to each editor.
 */

/** One word as drawn. */
export interface Word {
  text: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** Font size, px. */
  size: number;
  /** A space follows it in the source. */
  space: boolean;
}

/** A line of words. */
export interface TextLine {
  text: string;
  /** Left edge. */
  x: number;
  /** Top of the line box (its first word's top). */
  top: number;
  /** Bottom of the line box (its lowest word's bottom). */
  bottom: number;
  /** Baseline, from the top. */
  baseline: number;
  /** Font size (the largest of its words). */
  size: number;
  /** Drawn width. */
  width: number;
}

/** A link's clickable area. */
export interface LinkArea {
  href: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Joins words in reading order into the lines they sit on. A word continues
 * the current line when its top is within half its font size of the line's
 * top and it starts at most 0.3 em before, and less than 2.5 em after, the
 * line's right edge; a space goes between when the source has one or the
 * gap is wider than 0.15 em. Empty words are skipped.
 */
export function groupLines(words: Iterable<Word>): TextLine[] {
  const lines: TextLine[] = [];
  let current: (TextLine & { right: number; space: boolean }) | null = null;
  const flush = (): void => {
    if (current) lines.push({ text: current.text, x: current.x, top: current.top, bottom: current.bottom, baseline: current.baseline, size: current.size, width: current.right - current.x });
    current = null;
  };
  for (const word of words) {
    if (!word.text) continue;
    const line = current as (TextLine & { right: number; space: boolean }) | null;
    if (line && Math.abs(word.top - line.top) < word.size * 0.5 && word.left >= line.right - word.size * 0.3 && word.left - line.right < word.size * 2.5) {
      const gap = word.left - line.right > word.size * 0.15;
      line.text += (line.space || gap ? ' ' : '') + word.text;
      line.right = Math.max(line.right, word.right);
      line.bottom = Math.max(line.bottom, word.bottom);
      line.space = word.space;
      line.size = Math.max(line.size, word.size);
      continue;
    }
    flush();
    const baseline = word.bottom - (word.bottom - word.top) * 0.2;
    current = { text: word.text, x: word.left, top: word.top, bottom: word.bottom, baseline, size: word.size, width: 0, right: word.right, space: word.space };
  }
  flush();
  return lines;
}

/** True for a web link a PDF keeps: http, https or mailto. */
export function isWebLink(href: string): boolean {
  return /^(https?:|mailto:)/i.test(href);
}
