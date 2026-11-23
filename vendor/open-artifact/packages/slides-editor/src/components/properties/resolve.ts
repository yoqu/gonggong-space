/**
 * What the stage actually renders for the selected text: the computed font,
 * weight, size, spacing, color and alignment of each selected element. The
 * Text section shows these as placeholders while a value is inherited (from
 * the slide, a text style or the browser), so an empty field still says
 * what is in effect.
 */

import { useLayoutEffect, useState } from 'react';
import { pathKey, type NodePath } from '@open-artifact/slides-core';
import { useDeck } from '../../state/deck.ts';
import { useView } from '../../state/view.ts';
import { firstFamily, normalizeWeight } from '../../lib/fonts.ts';

/** The rendered text properties of one element. */
export interface ResolvedText {
  /** First family of the computed stack. */
  family: string | null;
  weight: number;
  italic: boolean;
  /** px. */
  size: number;
  /** A multiple of the size, or null for `normal`. */
  lineHeight: number | null;
  /** px. */
  letterSpacing: number;
  color: string;
  align: string;
}

/** The rendered element at `path` on the stage. */
export function stageElement(path: NodePath): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-open-artifact-stage] [data-open-artifact-path="${pathKey(path)}"]`);
}

const round = (n: number, places: number): number => Math.round(n * 10 ** places) / 10 ** places;

function read(el: HTMLElement): ResolvedText {
  const cs = getComputedStyle(el);
  const size = Number.parseFloat(cs.fontSize) || 16;
  const lh = Number.parseFloat(cs.lineHeight);
  const ls = Number.parseFloat(cs.letterSpacing);
  const align = cs.textAlign === 'start' ? 'left' : cs.textAlign === 'end' ? 'right' : cs.textAlign;
  return {
    family: firstFamily(cs.fontFamily),
    weight: normalizeWeight(Number(cs.fontWeight) || 400),
    italic: cs.fontStyle === 'italic' || cs.fontStyle.startsWith('oblique'),
    size: round(size, 1),
    lineHeight: Number.isFinite(lh) ? round(lh / size, 2) : null,
    letterSpacing: Number.isFinite(ls) ? round(ls, 1) : 0,
    color: cs.color,
    align,
  };
}

const same = (a: ResolvedText, b: ResolvedText): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * The rendered text properties shared by every element at `paths`, or null
 * while they differ or are not on stage. Re-read after every edit.
 */
export function useResolvedText(paths: readonly NodePath[]): ResolvedText | null {
  const revision = useDeck((s) => s.revision);
  const editing = useView((s) => s.textEdit !== null);
  const key = paths.map(pathKey).join('|');
  const [resolved, setResolved] = useState<ResolvedText | null>(null);
  useLayoutEffect(() => {
    const measure = (): void => {
      const all = paths.map(stageElement).map((el) => (el ? read(el) : null));
      const first = all[0];
      const next = first && all.every((r) => r && same(r, first)) ? first : null;
      setResolved((prev) => (prev && next && same(prev, next) ? prev : next));
    };
    measure();
    // Web fonts and the fit pass settle after the first frame.
    const frame = requestAnimationFrame(measure);
    const timer = window.setTimeout(measure, 250);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
    // `paths` is keyed by `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, revision, editing]);
  return resolved;
}
