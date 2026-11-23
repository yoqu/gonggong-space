/**
 * React hooks over the deck's outline: the slide order and its section
 * groups, recomputed only when they actually change.
 */

import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { reconcileSections, sectionGroups, sectionsOf, type SectionGroup } from '@open-artifact/slides-core';
import { useComments, openCounts } from '../services/comments.ts';
import { usePresence, type PeerView } from '../services/agent.ts';
import { deckOrder, useDeck } from './deck.ts';

/** The slide ids in deck order. */
export function useOrder(): string[] {
  return useDeck(useShallow((s) => deckOrder(s)));
}

/** The outline rows: sections and their slides. */
export function useOutline(): { order: string[]; groups: SectionGroup[] } {
  const order = useOrder();
  const sections = useDeck((s) => s.index.sections);
  const groups = useMemo(() => sectionGroups(reconcileSections(sectionsOf({ sections }), order), order), [sections, order]);
  return { order, groups };
}

/** Unresolved comment counts by slide id. */
export function useCommentCounts(): Map<string, number> {
  const threads = useComments((s) => s.threads);
  return useMemo(() => openCounts(threads), [threads]);
}

/** Peers by the slide they look at. */
export function usePeersBySlide(): Map<string, PeerView[]> {
  const peers = usePresence((s) => s.peers);
  return useMemo(() => {
    const out = new Map<string, PeerView[]>();
    for (const peer of peers) {
      const id = peer.state?.slideId;
      if (id) out.set(id, [...(out.get(id) ?? []), peer]);
    }
    return out;
  }, [peers]);
}
