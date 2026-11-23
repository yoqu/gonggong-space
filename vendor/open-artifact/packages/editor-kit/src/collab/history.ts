/**
 * Version history for any editor: the `history` capability, the panel's
 * open state, a read-only preview of a past version, and restores (whole,
 * or some files of it).
 *
 * Editor-agnostic: what a preview
 * holds (`P`) and how it is read from a version is the editor's
 * {@link HistoryAdapter}. Restores go through the host, which writes the
 * files the way a page would; the editor's sync merges them in like any
 * other change.
 */

import type { HistoryCapability } from '@open-artifact/runtime';
import { create, type StoreApi, type UseBoundStore } from 'zustand';

/** What an editor tells history. `P` is its loaded preview of one version. */
export interface HistoryAdapter<P> {
  /** Shows a short message (a toast); default: nothing. */
  notify?(message: { title: string; description?: string }): void;
  /** Reads what the editor draws of version `n` (its files through `history.files`/`read`). */
  loadPreview(history: HistoryCapability, n: number): Promise<P>;
  /** What the document is called in messages (default `document`). */
  noun?: string;
}

/** The history store. */
export interface HistoryState<P> {
  available: boolean;
  open: boolean;
  /** The version previewed (`null`: the current files). */
  previewing: number | null;
  preview: P | null;
  loading: boolean;
  error: string | null;
  canRestore: boolean;
  setOpen(open: boolean): void;
}

/** One editor's history. */
export interface HistoryController<P> {
  readonly store: UseBoundStore<StoreApi<HistoryState<P>>>;
  start(capability: HistoryCapability | null): void;
  capability(): HistoryCapability | null;
  /** Opens or closes the panel. */
  toggle(open?: boolean): void;
  /** Shows version `n` read-only (`null`: back to the current files). */
  preview(n: number | null): Promise<void>;
  /** Restores the whole of version `n`. */
  restore(n: number): Promise<void>;
  /** Restores some artifact paths of version `n`; resolves to the paths that changed, or `null` when it failed. */
  restorePaths(n: number, paths: string[], what: string): Promise<string[] | null>;
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Creates an editor's history. */
export function createHistory<P>(adapter: HistoryAdapter<P>): HistoryController<P> {
  const noun = adapter.noun ?? 'document';
  const notify = (message: { title: string; description?: string }): void => adapter.notify?.(message);
  let capability: HistoryCapability | null = null;
  let request = 0;

  const store = create<HistoryState<P>>()((set) => ({
    available: false,
    open: false,
    previewing: null,
    preview: null,
    loading: false,
    error: null,
    canRestore: false,
    setOpen(open) {
      set(open ? { open } : { open, previewing: null, preview: null, error: null, loading: false });
    },
  }));

  const controller: HistoryController<P> = {
    store,
    start(found) {
      capability = found;
      if (!found) return;
      store.setState({ available: true });
      const refresh = (): void => {
        found.list().then(
          (listing) => store.setState({ canRestore: listing.canRestore }),
          () => undefined,
        );
      };
      refresh();
      found.onChange(refresh);
    },
    capability: () => capability,
    toggle(open) {
      const state = store.getState();
      if (!state.available) return;
      state.setOpen(open ?? !state.open);
    },
    async preview(n) {
      const id = ++request;
      if (n === null || !capability) {
        store.setState({ previewing: null, preview: null, loading: false, error: null });
        return;
      }
      store.setState({ previewing: n, loading: true, error: null });
      try {
        const preview = await adapter.loadPreview(capability, n);
        if (id === request) store.setState({ preview, loading: false });
      } catch (error) {
        if (id === request) store.setState({ loading: false, error: message(error) });
      }
    },
    async restore(n) {
      if (!capability) return;
      try {
        const result = await capability.restore(n);
        notify({ title: result.changed.length ? `Restored version ${n}` : `The ${noun} already matches version ${n}` });
        await controller.preview(null);
      } catch (error) {
        notify({ title: 'The version could not be restored', description: message(error) });
      }
    },
    async restorePaths(n, paths, what) {
      if (!capability) return null;
      try {
        return (await capability.restore(n, paths)).changed;
      } catch (error) {
        notify({ title: `${what} could not be restored`, description: message(error) });
        return null;
      }
    },
  };
  return controller;
}
