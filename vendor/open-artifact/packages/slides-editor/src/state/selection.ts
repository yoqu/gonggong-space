/**
 * The selected elements of the slide on stage, as a hook for panels and
 * bars that show or change them.
 */

import { useMemo } from 'react';
import { comparePaths, nodeAt, type NodePath, type Slide, type SlideNode } from '@open-artifact/slides-core';
import { useDeck } from './deck.ts';
import { useView } from './view.ts';

/** What is selected on stage. */
export interface SelectedNodes {
  slideId: string | null;
  slide: Slide | null;
  /** The slide's entry is held or the deck is read-only. */
  readOnly: boolean;
  /** Selected paths that still exist, in document order. */
  paths: NodePath[];
  /** The nodes at `paths`. */
  nodes: SlideNode[];
}

/** The selection on stage, kept current with the slide. */
export function useSelectedNodes(): SelectedNodes {
  const slideId = useView((s) => s.current);
  const selection = useView((s) => s.selection);
  const entry = useDeck((s) => (slideId ? s.slides[slideId] : undefined));
  const deckReadOnly = useDeck((s) => s.readOnly);
  return useMemo(() => {
    const slide = entry?.slide ?? null;
    const paths = slide ? selection.filter((p) => nodeAt(slide, p) !== undefined).sort(comparePaths) : [];
    return {
      slideId,
      slide,
      readOnly: deckReadOnly || Boolean(entry?.held),
      paths,
      nodes: slide ? paths.map((p) => nodeAt(slide, p)!) : [],
    };
  }, [slideId, selection, entry, deckReadOnly]);
}
