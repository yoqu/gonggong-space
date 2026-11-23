/**
 * Collaboration glue for any editor: what the Shell draws for comments and
 * history (its Comment and History buttons), the Shell's commands for them,
 * which of the two panels is open on the right, and the keys of comment
 * mode (C toggles it, Esc closes a composer, then a card, then the mode).
 *
 * Editor-agnostic: the editor says
 * whether its comment surface is showing and how to comment on its
 * selection ({@link CollabAdapter}).
 */

import type { ChromeCommand, ChromeReport, CommentThread } from '@open-artifact/runtime';
import { openMessageCount } from './comments.ts';

/** What an editor tells the glue. */
export interface CollabAdapter {
  /** The surface comment mode works on is showing (the canvas, the slide…). */
  onSurface(): boolean;
  /** Brings that surface up (leaves a focused or outline view). */
  showSurface?(): void;
  /** Starts a thread on what is selected (the Shell's `comment_selection` action). */
  commentOnSelection?(): void;
  /** Route the comment shortcut through the host when it owns the entry point. */
  requestCommentMode?(on: boolean): boolean;
  /** The viewer cannot edit (comment mode then leaves Delete alone). */
  readOnly(): boolean;
  /** The Shell's page button for comments (default `false`: the page draws its own). */
  pageButton?: boolean;
}

/** A key press, as the editor's shortcut handler sees it. */
export interface CollabKey {
  key: string;
  code?: string | undefined;
  meta: boolean;
  shift: boolean;
  alt: boolean;
}





export type CollabAsideKind = 'history' | null;

/** Which collaboration panel is docked on the right. */
export function collabAside(_comments: { available: boolean; listOpen: boolean }, history: { available: boolean; open: boolean }): CollabAsideKind {
  return history.available && history.open ? 'history' : null;
}

/** A zustand store as the glue reads it (a bound store: callable as a hook). */
export interface CollabStore<S> {
  getState(): S;
  subscribe(listener: (state: S, previous: S) => void): () => void;
  <U>(selector: (state: S) => U): U;
}

/**
 * The comments the glue drives: a {@link CommentsController}, or an
 * editor's own comments store of the same shape (`available`, `on`,
 * `listOpen`, `threads`, `active`, `draft`…).
 */
export interface CollabComments {
  store: CollabStore<{
    available: boolean;
    on: boolean;
    listOpen: boolean;
    threads: CommentThread[];
    active: string | null;
    draft: unknown;
    setOn(on: boolean): void;
    setListOpen(open: boolean): void;
    setActive(id: string | null): void;
    setDraft(draft: null): void;
  }>;
  canComment(): boolean;
}

/** The version history the glue drives: a {@link HistoryController}, or an editor's own of the same shape. */
export interface CollabHistory {
  store: CollabStore<{ available: boolean; open: boolean; previewing: number | null }>;
  /** Opens or closes the panel (closing it ends a preview). */
  toggle(open?: boolean): void;
}

/** One editor's collaboration glue. */
export interface CollabController {
  /** What the Shell draws for comments and history. */
  chromeReport(): Pick<ChromeReport, 'comments' | 'history'>;
  /** Calls `report` whenever {@link chromeReport} may have changed. */
  subscribe(report: () => void): () => void;
  /** Runs a Shell command that belongs to comments or history; returns whether it did. */
  handleCommand(command: ChromeCommand): boolean;
  /** Opens or closes the comment list (closing the history panel). */
  toggleCommentList(open?: boolean): void;
  /** Opens or closes the history panel (closing the comment list). */
  toggleHistoryPanel(open?: boolean): void;
  /** The open panel (a React hook). */
  useAside(): CollabAsideKind;
  /** Keys of comment mode and of a history preview, ahead of the editor's shortcuts; returns whether the key was taken. */
  runShortcut(press: CollabKey): boolean;
}

/** Creates an editor's collaboration glue. */
export function createCollab({ comments, history, adapter }: { comments: CollabComments; history: CollabHistory; adapter: CollabAdapter }): CollabController {
  const toggleCommentList = (open?: boolean): void => {
    const state = comments.store.getState();
    const next = open ?? !state.listOpen;
    state.setListOpen(next);
    if (next && history.store.getState().open) history.toggle(false);
  };
  const toggleHistoryPanel = (open?: boolean): void => {
    const next = open ?? !history.store.getState().open;
    history.toggle(next);
    if (next) comments.store.getState().setListOpen(false);
  };

  return {
    chromeReport() {
      const c = comments.store.getState();
      const h = history.store.getState();
      return {
        ...(c.available ? { comments: { available: true, on: c.on, open: c.listOpen, count: openMessageCount(c.threads), pageButton: adapter.pageButton ?? false } } : {}),
        ...(h.available ? { history: true } : {}),
      };
    },
    subscribe(report) {
      const a = comments.store.subscribe(report);
      const b = history.store.subscribe((state, previous) => {
        if (state.available !== previous.available) report();
      });
      return () => {
        a();
        b();
      };
    },
    handleCommand(command) {
      switch (command.cmd) {
        case 'comments_mode': {
          const state = comments.store.getState();
          if (!state.available) return true;
          const on = command.on ?? !state.on;
          if (on && !adapter.onSurface()) adapter.showSurface?.();
          state.setOn(on);
          return true;
        }
        case 'comments_list':
          toggleCommentList(command.open);
          return true;
        case 'history':
          toggleHistoryPanel();
          return true;
        case 'action':
          if (command.id === 'comment_selection' && adapter.commentOnSelection) {
            adapter.commentOnSelection();
            return true;
          }
          return false;
        default:
          return false;
      }
    },
    toggleCommentList,
    toggleHistoryPanel,
    useAside() {
      const commentsAvailable = comments.store((s) => s.available);
      const listOpen = comments.store((s) => s.listOpen);
      const historyAvailable = history.store((s) => s.available);
      const historyOpen = history.store((s) => s.open);
      return collabAside({ available: commentsAvailable, listOpen }, { available: historyAvailable, open: historyOpen });
    },
    runShortcut(press) {
      // A past version is on screen: the editor under it takes no keys (Esc is the preview's).
      if (history.store.getState().previewing !== null) return true;
      const state = comments.store.getState();
      if (!state.available) return false;
      if (press.key === 'Escape') {
        if (state.draft !== null) state.setDraft(null);
        else if (state.active) state.setActive(null);
        else if (state.on) state.setOn(false);
        else return false;
        return true;
      }
      const letter = press.code?.startsWith('Key') ? press.code.slice(3).toLowerCase() : press.key.toLowerCase();
      if (letter === 'c' && !press.meta && !press.alt && !press.shift) {
        if (!comments.canComment() || !adapter.onSurface()) return false;
        if (adapter.requestCommentMode) return adapter.requestCommentMode(!state.on);
        state.setOn(!state.on);
        return true;
      }
      // Editing keys do nothing while comment mode is on (the surface is for placing comments).
      if (state.on && !press.meta && !adapter.readOnly() && (press.key === 'Delete' || press.key === 'Backspace')) return true;
      return false;
    },
  };
}
