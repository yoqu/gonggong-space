import { createHistory } from '@open-artifact/editor-kit';
import { useCapability } from '@open-artifact/runtime';
import { createSourceDeck, DECK_PATH, DECK_STYLESHEET_PATH, deckFormatKind, parseDeckIndex, resolveOrder, slideIdFromPath } from '@open-artifact/slides-core';
import { isDirty, useDeck } from '../state/deck.ts';
import { flush } from './sync.ts';
import { toast } from '@open-artifact/ui';

/** Keep the historical index and stylesheet together. Slide files are read as the viewer selects them. */
export const slideHistory = createHistory({
  noun: 'presentation',
  notify: message => toast.add(message),
  async loadPreview(history, version) {
    const files = await history.files(version);
    const parsed = parseDeckIndex(await history.read(version, DECK_PATH));
    if (parsed.error) throw new Error(parsed.error);
    const index = parsed.index;
    const order = resolveOrder(index.order, Object.keys(files).flatMap(path => slideIdFromPath(path) ?? []));
    const css = files[DECK_STYLESHEET_PATH] ? await history.read(version, DECK_STYLESHEET_PATH) : undefined;
    const source = deckFormatKind(index) === 'source' ? createSourceDeck(css, index.size) : undefined;
    return { version, index, order, source, files };
  },
});

export async function startHistory(): Promise<void> {
  const history = await useCapability('history');
  slideHistory.start(history && {
    ...history,
    async restore(version, paths) {
      await flush();
      if (isDirty(useDeck.getState())) throw new Error('Save your pending slide edits before restoring this version.');
      return history.restore(version, paths);
    },
  });
}
