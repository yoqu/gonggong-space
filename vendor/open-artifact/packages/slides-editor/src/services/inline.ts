/**
 * The inline view's connection: the deck loads read only and follows changes
 * on disk; the slide on screen is reported to the Shell, and a slide link the
 * framing page navigates to is followed. Nothing else starts: no presence,
 * comments, history or saving.
 */

import { slideTitle } from '@open-artifact/slides-core';
import { deckOrder, useDeck } from '../state/deck.ts';
import { useInlineView } from '../state/inline.ts';
import { inlineSlides } from '../lib/inline-view.ts';
import { slideFromHash, slideHash } from './location.ts';
import { maybeSession, startSession } from './session.ts';
import { loadDeck } from './sync.ts';

/** The slides the inline view pages through, in order. */
export function viewedSlides(): string[] {
  const state = useDeck.getState();
  return inlineSlides(deckOrder(state), (id) => Boolean(state.slides[id]?.slide.hidden));
}

/** The title of a slide, for the pager's announcement. */
export function viewedTitle(id: string): string | undefined {
  const slide = useDeck.getState().slides[id]?.slide;
  return slide ? slideTitle(slide) : undefined;
}

/** Connects and loads the deck read only, then shows its first slide. */
export async function startInlineView(): Promise<void> {
  try {
    await startSession();
  } catch (error) {
    useDeck.getState().fail(error instanceof Error ? error.message : String(error));
    return;
  }
  await loadDeck({ readOnly: true });
  const deck = useDeck.getState();
  if (deck.status !== 'ready') return;
  document.title = deck.title || 'Slides';
  const view = useInlineView.getState();
  view.show(viewedSlides()[0] ?? null);

  const shell = maybeSession()?.shell;
  if (!shell) return;
  // Changes on disk arrive through the deck's sync: the Shell need not reload the page.
  shell.onFilesChanged(() => true);
  shell.onCommand((command) => {
    if (command.cmd !== 'goto_slide') return;
    const id = slideFromHash(command.hash);
    if (id && viewedSlides().includes(id)) useInlineView.getState().show(id);
  });
  const report = (id: string | null): void => {
    if (id) shell.currentSlide(slideHash(id));
  };
  report(useInlineView.getState().current);
  useInlineView.subscribe((state, previous) => {
    if (state.current !== previous.current) report(state.current);
  });
}
