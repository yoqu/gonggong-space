import { useMemo } from 'react';
import { create } from 'zustand';
import { TWEAKS_SETTINGS, fieldlessTextBoxes, type EditableWord, type RetypedLine, type ShownText, type TextBox } from '@open-artifact/motion-core';
import { useFilm } from '../stores/film.ts';
import { filmScan, inSteadyOrder, wordList } from './text-model.ts';

export interface TextState {
  /** The stage's text nodes while it is watched (paused), else none. */
  nodes: readonly ShownText[];
  /** The retyped lines the stage on show was loaded with. */
  shown: readonly RetypedLine[];
  /** Lines this page just wrote, ahead of the decoded film; `null` once it caught up. */
  typed: readonly RetypedLine[] | null;
  /** The line whose field has focus, as it was then, and the list's order then. */
  held: EditableWord | null;
  order: readonly string[] | null;
  /** The line under the pointer on the picture or in the panel. */
  near: string | null;
  /** A word clicked on the picture: its field takes focus (`seq` tells two clicks on one word apart). */
  asked: { id: string; seq: number } | null;
}

export const useText = create<TextState>()(() => ({ nodes: [], shown: [], typed: null, held: null, order: null, near: null, asked: null }));

const NO_LINES: readonly RetypedLine[] = [];

/** The lines as typed: this page's latest write, else the film's record. */
export function useTypedLines(): readonly RetypedLine[] {
  const typed = useText((s) => s.typed);
  const recorded = useFilm((s) => s.records.retyped?.lines ?? NO_LINES);
  return typed ?? recorded;
}

/** The lines listed under Text and laid over the picture, and the boxes of words the code gives no field. */
export function useEditableWords(): { words: EditableWord[]; fieldless: TextBox[] } {
  const film = useFilm((s) => s.film);
  const scenes = useFilm((s) => s.scenes);
  const nodes = useText((s) => s.nodes);
  const shown = useText((s) => s.shown);
  const held = useText((s) => s.held);
  const order = useText((s) => s.order);
  const typed = useTypedLines();
  return useMemo(() => {
    const sites = filmScan(film)?.sites ?? [];
    const words = wordList({ nodes, keptLine: held?.line ?? null, sites, shown, typed, elsewhere: TWEAKS_SETTINGS.elsewhere && scenes !== null });
    return { words: inSteadyOrder(words, order, held), fieldless: fieldlessTextBoxes({ nodes, sites, shown, typed }) };
  }, [film, scenes, nodes, shown, typed, held, order]);
}

/** Asks the panel to focus the field of the line `id`. */
export function askForWord(id: string): void {
  useText.setState((state) => ({ asked: { id, seq: (state.asked?.seq ?? 0) + 1 } }));
}
