/**
 * The link card: the small card a board link shows while the pointer
 * rests on it (or the caret rests in it while typing). Per viewer; the
 * link's DOM node and the timers live in `services/link-card.ts`.
 */

import { create } from 'zustand';
import type { ElementId } from '@open-artifact/whiteboard-core';
import type { LinkBlock, ScreenBox } from '../lib/link-card.ts';

/** The card on show. */
export interface LinkCardView {
  /** The address shown: what opens, or the stored address when nothing does. */
  href: string;
  /** What opening it opens; `undefined` when the board does not open it. */
  target: string | undefined;
  /** Why it does not open. */
  blocked: LinkBlock | undefined;
  /** The link's box on screen, viewport pixels. */
  anchor: ScreenBox;
  /** A link on the board, or one in the text being typed. */
  origin: 'board' | 'editor';
  /** The element holding the link. */
  id: ElementId | null;
  /** The link can be edited here (a link in words the viewer may edit). */
  editable: boolean;
  /** Changes each time a card is shown, so a new card starts fresh. */
  serial: number;
}

interface LinkCardState {
  card: LinkCardView | null;
}

/** The card on show, if any. */
export const useLinkCard = create<LinkCardState>()(() => ({ card: null }));
