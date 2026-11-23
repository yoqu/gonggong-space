import type { FilmSeconds, NarrationLine, PlaySeconds } from '@open-artifact/motion-core';
import type { NarrationLimits, PlayedNarrationLine } from '../protocol.ts';

export interface ReadNarration {
  lines: NarrationLine[];
  duck: number | null;
  captions: false | { style?: string };
}

export interface CaptionCue {
  from: PlaySeconds;
  to: PlaySeconds;
  text: string;
}

const LONGEST_CUE = 76;

const fields = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;

/**
 * The cut's narration, held to the host's limits: the page applies the same, so a line dropped here is named and
 * not captioned.
 */
export function readNarration(narration: unknown, duration: number, limits: NarrationLimits): ReadNarration | null {
  const given = fields(narration);
  if (!given || !Array.isArray(given['lines'])) return null;
  const all: unknown[] = given['lines'];
  if (all.length > limits.maxLines) console.error('narration has ' + all.length + ' lines; only the first ' + limits.maxLines + ' are used');
  const lines: NarrationLine[] = [];
  all.slice(0, limits.maxLines).forEach((entry, i) => {
    const line = fields(entry);
    const at = line?.['at'];
    const dur = line?.['dur'];
    const text = line?.['text'];
    const audio = line?.['audio'];
    if (
      typeof at !== 'number' ||
      typeof dur !== 'number' ||
      !(at >= 0 && at < duration) ||
      !(dur > 0 && dur <= limits.maxLineSeconds) ||
      typeof text !== 'string' ||
      typeof audio !== 'string' ||
      !audio
    ) {
      console.error(
        'narration line ' +
          (i + 1) +
          ' is left out. It needs { at, text, audio, dur }: a start in seconds inside the film, the words, the name of an audio asset, and that audio’s length in seconds (' +
          limits.maxLineSeconds +
          ' at most); at and dur as numbers',
      );
      return;
    }
    lines.push({ at: at as FilmSeconds, text, audio, dur });
  });
  const captions = given['captions'];
  const style = fields(captions)?.['style'];
  return {
    lines,
    duck: typeof given['duck'] === 'number' ? given['duck'] : null,
    captions: captions === false ? false : typeof style === 'string' ? { style } : {},
  };
}

/** A line over LONGEST_CUE characters shows in parts of about equal length, split at spaces, each for its share of the line's time. */
export function captionCues(lines: readonly PlayedNarrationLine[]): CaptionCue[] {
  const out: CaptionCue[] = [];
  for (const line of lines) {
    const words = line.text.trim().split(/\s+/);
    const total = words.join(' ').length;
    if (!total) continue;
    const aim = total / Math.ceil(total / LONGEST_CUE);
    let part = '';
    let done = 0;
    words.forEach((word, i) => {
      part += (part ? ' ' : '') + word;
      const next = words[i + 1];
      if (next !== undefined && part.length + (next.length + 1) / 2 < aim) return;
      out.push({
        from: (line.at + (line.dur * done) / total) as PlaySeconds,
        to: (line.at + line.dur * Math.min(1, (done + part.length + 1) / total)) as PlaySeconds,
        text: part,
      });
      done += part.length + 1;
      part = '';
    });
  }
  return out;
}

export interface CaptionLayer {
  draw(t: PlaySeconds, stage: HTMLElement): void;
}

/** `shortSide`, the stage's shorter side, sizes the type. What draw shows depends only on t. */
export function captionLayer(lines: readonly PlayedNarrationLine[], style: string | undefined, shortSide: number, sans: string): CaptionLayer {
  const cues = captionCues(lines);
  const box = document.createElement('div');
  const words = document.createElement('span');
  box.className = 'film-caption';
  box.dir = 'auto';
  box.style.cssText =
    'position:absolute;left:10%;right:10%;bottom:7%;text-align:center;text-wrap:balance;pointer-events:none;z-index:2147483647;font:600 ' +
    Math.round(shortSide * 0.042) +
    'px/1.62 ' +
    sans;
  // Cloned per row, so each row's background hugs its own words.
  words.style.cssText =
    'padding:.2em .6em;border-radius:.3em;background:rgba(0,0,0,.7);color:#fff;-webkit-box-decoration-break:clone;box-decoration-break:clone' +
    (style ? ';' + style : '');
  box.appendChild(words);
  return {
    draw(t, stage) {
      let cue: CaptionCue | null = null;
      for (const each of cues) if (t >= each.from && t < each.to) cue = each;
      // Last in the stage, so it stays above what the cut adds.
      if (stage.lastChild !== box) stage.appendChild(box);
      box.style.visibility = cue ? 'visible' : 'hidden';
      if (cue && words.textContent !== cue.text) words.textContent = cue.text;
    },
  };
}
