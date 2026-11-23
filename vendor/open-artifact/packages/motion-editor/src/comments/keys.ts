import type { KeyRegistry, Shortcut } from '../keyboard/registry.ts';
import { shortcuts } from '../keyboard/registry.ts';
import { commentHere, commenting, filmComments, placing, setCommentMode, toggleRangeMark, useComments } from './comments.ts';
import * as words from './words.ts';

export const COMMENT_SHORTCUTS: readonly Shortcut[] = [
  {
    id: 'comments.mode',
    keys: [{ key: 'c' }],
    label: words.TOGGLE_COMMENT_MODE,
    when: () => useComments.getState().available && filmComments.canComment() && useComments.getState().draft === null,
    run: () => setCommentMode(!commenting()),
  },
  { id: 'comments.leave', keys: [{ key: 'Escape' }], label: words.LEAVE_COMMENT_MODE, when: placing, run: () => setCommentMode(false) },
  { id: 'comments.mark', keys: [{ key: 'r' }, { key: 'Enter', shift: true }], label: words.MARK_STRETCH, when: placing, run: toggleRangeMark },
  { id: 'comments.here', keys: [{ key: 'Enter' }], label: words.COMMENT_HERE, when: placing, run: commentHere },
];

/** Adds the comment keys; they are added after playback's, so they win while comment mode is on. */
export function registerCommentShortcuts(registry: KeyRegistry = shortcuts): () => void {
  const stops = COMMENT_SHORTCUTS.map((shortcut) => registry.register(shortcut));
  return () => {
    for (const stop of stops) stop();
  };
}
